#!/usr/bin/env node
// Build this checkout and link it into a DSH profile for local development.
//
// A `github:` install of this repository trips pnpm's `allowBuilds` gate: the
// package's `main`/`types` point at `lib/`, which is gitignored, so a git
// install has no `lib/` and pnpm must run `prepare` (`husky && tsdown`) to
// build it — a build script pnpm refuses to run for a git dependency unless it
// is allowlisted. `link:` sidesteps the registry (and the build gate) entirely:
// pnpm resolves the dependency to this checkout and never runs `prepare` for a
// local link. The `lib/` it imports is the one we build here.
//
// Unlike dsh-memory this repository is a single package — there is no
// `plugins/` directory of sibling packages to junction and unregister, so the
// whole monorepo machinery collapses to: build the checkout, then record a
// `link:` spec for this package (and a bundle layer) in the profile manifest.
//
// "Sync" is the honest verb: it makes the profile match this checkout, by
// rebuilding what changed and relinking what is stale. Running it with no
// arguments always builds, then links — one command covers both a first install
// and every later update. Named steps run alone:
//
//   node scripts/sync-local-profile.mjs              # build, then link if needed
//   node scripts/sync-local-profile.mjs --build      # build only
//   node scripts/sync-local-profile.mjs --link       # link only, skip the build
//   node scripts/sync-local-profile.mjs --dry-run    # report, change nothing
//   node scripts/sync-local-profile.mjs --profile headless
//
// After a successful run, restart DSH so the profile's pnpm pass materialises
// the `link:` (pnpm rewrites the spec into a symlink in the profile's
// node_modules) and the Host loads the freshly built `lib/`.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const flags = new Set()
let profileName = 'desktop'
let dshOverride
const arguments_ = process.argv.slice(2)
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index]
  // `--install` is kept as an alias for `--link`: the step links the package
  // into a profile and never touches a registry.
  if (argument === '--build' || argument === '--link' || argument === '--dry-run') flags.add(argument)
  else if (argument === '--install') flags.add('--link')
  else if (argument === '--profile' || argument === '--dsh') {
    const value = arguments_[index + 1]
    if (!value) throw new Error(`${argument} expects a value`)
    if (argument === '--profile') profileName = value
    else dshOverride = value
    index += 1
  } else throw new Error(`Unknown option: ${argument}`)
}

const dryRun = flags.has('--dry-run')
const namedStepOnly = flags.has('--build') || flags.has('--link')
const runBuild = flags.has('--build') || !namedStepOnly
const runLink = flags.has('--link') || !namedStepOnly

const dshHome = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)

function run(command, args, { cwd, label }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${label} failed with exit code ${code}`))
    })
  })
}

// On Windows `pnpm` on PATH is a `.cmd`/`.ps1` shim, and `spawn` with
// `shell: false` can launch neither (it searches only for an extensionless
// executable, and Windows rejects a batch file in that position). Resolve the
// real binary next to the shim so the same call works on every platform.
function resolvePnpm() {
  if (process.platform !== 'win32') return 'pnpm'
  const shim = join(dirname(process.execPath), 'pnpm.cmd')
  if (existsSync(shim)) {
    const match = readFileSync(shim, 'utf8').match(/"(%dp0%\\[^"]+\.exe)"/i)
    if (match) {
      // %dp0% expands to a directory that already ends in a separator, so the
      // remainder still begins with one; resolve() would read that as an
      // absolute path and anchor the result at the drive root.
      const rest = match[1].replace(/%dp0%/i, '').replace(/^[\\/]+/, '')
      const binary = resolve(dirname(shim), rest)
      if (existsSync(binary)) return binary
    }
  }
  return 'pnpm.cmd'
}

const pnpmBin = resolvePnpm()

function pnpm(args, options) {
  return run(pnpmBin, args, options)
}

// `dsh` may not be on PATH — a desktop install keeps it under the application
// directory, which can be anywhere the user chose. Probe PATH first, then the
// common install roots, so no path is ever hardcoded; --dsh overrides all of
// them when the layout is unusual.
function resolveDsh() {
  if (dshOverride !== undefined) return dshOverride
  const candidates = ['dsh']
  const roots = [
    process.env.DSH_HOME && join(process.env.DSH_HOME, 'dsh-runtimes'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'DeepSeek Harness'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness'),
    ...['C:', 'D:'].map(drive => join(`${drive}\\`, 'Applications', 'DeepSeek Harness')),
  ].filter(Boolean)
  for (const root of roots) candidates.push(join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  candidates.push(join(dirname(process.execPath), 'dsh.cmd'))
  // PATH is the intended route; search it first, and accept only candidates
  // that are real files, because existsSync('dsh') is false for a bare command
  // name and would short-circuit the search with a name spawn() cannot resolve.
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const name of ['dsh.cmd', 'dsh.exe', 'dsh']) {
      const candidate = join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return candidates.find(candidate => existsSync(candidate)) ?? 'dsh'
}

// Unlike the pnpm shim, a desktop `dsh.cmd` forwards to the Electron binary
// with ELECTRON_RUN_AS_NODE set, so rewriting it by hand would have to
// reproduce that environment. Spawn it through the platform shell instead.
function dsh(args, options) {
  const command = resolveDsh()
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'call', command, ...args], options)
  }
  return run(command, args, options)
}

// The checkout is a single package: the profile registers it as one installed
// plugin and nothing more. There are no sibling packages to junction or
// unregister, so the "registered directory" is simply the checkout root.
const registeredDirectory = () => root

// Read the package's own declared name rather than deriving it from the
// directory: the mapping is a convention, not a rule the manifest enforces.
function packageName(directory) {
  const manifest = join(directory, 'package.json')
  if (!existsSync(manifest)) return undefined
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).name
  } catch {
    return undefined
  }
}

// pnpm rewrites every `link:` spec into a forward-slash absolute path when it
// records one, so compare on that normalised form rather than on the string we
// passed in.
function normalizeSpec(directory) {
  return `link:${resolve(directory).replace(/\\/g, '/')}`
}

function readProfileDependencies() {
  const manifest = join(profileDir, 'package.json')
  if (!existsSync(manifest)) return {}
  try {
    return JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {}
  } catch {
    return {}
  }
}

// Make the profile name this checkout as one installed plugin and nothing more.
//
// The Host enumerates the profile's package.json DEPENDENCIES, reads each one's
// cordis.patch.yml to derive its rows, and appends every dependency declaring
// `dsh.bundle` to `dsh.profile.bundles`. So this package must be in
// `dependencies` (its patch is what renders every component as a switchable
// child) and in `dsh.profile.bundles` (so the Host loads it). A `link:` spec is
// what keeps it pointing at this checkout instead of the registry — and avoids
// the `allowBuilds` gate a `github:` install would hit, because pnpm never runs
// `prepare` for a local link.
function registerProfile() {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
  const changed = []
  const directory = registeredDirectory()
  const name = packageName(directory)
  if (name === undefined) throw new Error(`No package name for ${directory}`)

  manifest.dependencies = manifest.dependencies ?? {}
  const spec = normalizeSpec(directory)
  if (manifest.dependencies[name] !== spec) {
    manifest.dependencies[name] = spec
    changed.push(`dependency ${name}`)
  }

  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  if (!Array.isArray(manifest.dsh.profile.bundles)) manifest.dsh.profile.bundles = []
  const bundles = manifest.dsh.profile.bundles
  if (!bundles.includes(name)) {
    bundles.push(name)
    changed.push(`bundle ${name}`)
  }

  if (changed.length > 0) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return changed
}

// The package must be present in `dependencies` as a `link:` to this checkout.
function missingLinks() {
  const recorded = readProfileDependencies()
  const directory = registeredDirectory()
  const name = packageName(directory)
  if (name === undefined) return []
  return recorded[name] === normalizeSpec(directory) ? [] : [directory]
}

const step = message => console.log(dryRun ? `[dry-run] ${message}` : `==> ${message}`)

if (runBuild) {
  if (!existsSync(join(root, 'node_modules'))) {
    step('installing dependencies')
    if (!dryRun) await pnpm(['install', '--frozen-lockfile'], { cwd: root, label: 'pnpm install' })
  }
  step('building the package (tsdown -> lib/)')
  if (!dryRun) await pnpm(['run', 'build'], { cwd: root, label: 'pnpm run build' })
} else {
  step('skipping the build (--link)')
}

if (runLink) {
  if (!existsSync(profileDir)) {
    throw new Error(`No profile at ${profileDir}. Start DSH once to create it, or pass --profile <name>.`)
  }
  const missing = missingLinks()
  if (missing.length === 0) {
    step(`profile "${profileName}" already links ${packageName(registeredDirectory())}`)
  } else {
    step(`linking ${packageName(registeredDirectory())} into profile "${profileName}"`)
    console.log(`    profile: ${profileDir}`)
  }
  if (!dryRun) {
    const changed = registerProfile()
    if (changed.length > 0) console.log(`    registered ${changed.join(', ')}`)
  }
  step(`profile "${profileName}" links ${packageName(registeredDirectory())}`)
} else {
  step('skipping the profile sync (--build)')
}

console.log('')
if (runLink) {
  console.log('Restart DSH to load it. The loader caches imported modules, so a')
  console.log('rebuild alone is not enough — a restart lets the profile pnpm pass')
  console.log('materialise the link: and the Host import the freshly built lib/.')
}
