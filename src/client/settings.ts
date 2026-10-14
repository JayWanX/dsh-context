/** The plugin's user-settings binding (browser half): the Host-served `dsh-context` namespace carries per-user
 * display preferences, degrading to the schema defaults wherever that surface is absent or read-only. */

import type { DefaultDeltaBase, DefaultFileSort, DefaultGranularity, DefaultDurationCurve, DefaultPlacement, DefaultToolSort, DefaultTrendMode, FleetTab, InsightsEntry, SettingsField } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

export type { DefaultDeltaBase, DefaultFileSort, DefaultToolSort, SettingsField } from '../shared/types'
export { DEFAULT_SETTINGS } from '../shared/types'

/** The bound settings form (`ctx.configForms.get`), as consumed. */
export interface SettingsScopeLike {
  getSnapshot(): { status: string; value: unknown; writable: boolean }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

/** The `ctx.configForms` service face, as consumed; the bound form satisfies {@link SettingsScopeLike}
 *  (same snapshot/subscribe/set shape). */
export interface ConfigFormsFace {
  get(namespace: string): SettingsScopeLike
  whileServed(namespaces: readonly string[], register: () => () => void): () => void
}

export interface SettingsState {
  /** Scope sync: loading until the first Host section, unavailable when unserved. */
  status: 'loading' | 'ready' | 'unavailable'
  placement: DefaultPlacement
  granularity: DefaultGranularity
  mode: DefaultTrendMode
  deltaBase: DefaultDeltaBase
  toolSort: DefaultToolSort
  fileSort: DefaultFileSort
  insightsEntry: InsightsEntry
  durationCurve: DefaultDurationCurve
  fleetTab: FleetTab
  promptPrefix: string
  promptSuffix: string
  writable: boolean
}

export interface ContextSettings {
  /** Observable snapshot store, bound onto card props as `useContextSettings`. */
  store: { subscribe(listener: () => void): () => void; getSnapshot(): SettingsState }
  defaultPlacement(): DefaultPlacement
  defaultGranularity(): DefaultGranularity
  defaultTrendMode(): DefaultTrendMode
  defaultDeltaBase(): DefaultDeltaBase
  defaultToolSort(): DefaultToolSort
  defaultFileSort(): DefaultFileSort
  insightsEntry(): InsightsEntry
  defaultDurationCurve(): DefaultDurationCurve
  fleetTab(): FleetTab
  attach(scope: SettingsScopeLike): () => void
  /** Persist one preference choice (local echo, then the fenced scope write). */
  set(field: SettingsField, value: string): void
  /** Restore one field to its shipped default — the same declaration the Host schema defaults from. */
  reset(field: SettingsField): void
  /** Restore every field to its shipped default. One local echo, then the per-field scope writes. */
  resetAll(): void
}

type Prefs = {
  placement?: DefaultPlacement
  granularity?: DefaultGranularity
  mode?: DefaultTrendMode
  deltaBase?: DefaultDeltaBase
  toolSort?: DefaultToolSort
  fileSort?: DefaultFileSort
  insightsEntry?: InsightsEntry
  durationCurve?: DefaultDurationCurve
  fleetTab?: FleetTab
  promptPrefix?: string
  promptSuffix?: string
}

function prefsOf(value: unknown): Prefs {
  if (value === null || typeof value !== 'object') return {}
  const v = value as Record<string, unknown>
  return {
    ...(v.defaultPlacement === 'all' || v.defaultPlacement === 'tab' || v.defaultPlacement === 'sidebar' ? { placement: v.defaultPlacement } : {}),
    ...(v.defaultGranularity === 'step' || v.defaultGranularity === 'turn' ? { granularity: v.defaultGranularity } : {}),
    ...(v.defaultTrendMode === 'total' || v.defaultTrendMode === 'delta' ? { mode: v.defaultTrendMode } : {}),
    ...(v.defaultDeltaBase === 'step' || v.defaultDeltaBase === 'turn' ? { deltaBase: v.defaultDeltaBase } : {}),
    ...(v.defaultToolSort === 'size' || v.defaultToolSort === 'count' || v.defaultToolSort === 'name' ? { toolSort: v.defaultToolSort } : {}),
    ...(v.defaultFileSort === 'count' || v.defaultFileSort === 'latest' || v.defaultFileSort === 'path' ? { fileSort: v.defaultFileSort } : {}),
    ...(v.insightsEntry === 'show' || v.insightsEntry === 'hide' ? { insightsEntry: v.insightsEntry } : {}),
    ...(v.defaultDurationCurve === 'show' || v.defaultDurationCurve === 'hide' ? { durationCurve: v.defaultDurationCurve } : {}),
    ...(v.fleetTab === 'show' || v.fleetTab === 'hide' ? { fleetTab: v.fleetTab } : {}),
    ...(typeof v.promptPrefix === 'string' ? { promptPrefix: v.promptPrefix } : {}),
    ...(typeof v.promptSuffix === 'string' ? { promptSuffix: v.promptSuffix } : {}),
  }
}

/** {@link DEFAULT_SETTINGS} under the store's own field names (the scope keys say `default*`, the store
 *  drops the prefix): the cold state and the reset action both read it, so neither can name a value twice. */
const DEFAULT_STATE: Omit<SettingsState, 'status' | 'writable'> = {
  placement: DEFAULT_SETTINGS.defaultPlacement,
  granularity: DEFAULT_SETTINGS.defaultGranularity,
  mode: DEFAULT_SETTINGS.defaultTrendMode,
  deltaBase: DEFAULT_SETTINGS.defaultDeltaBase,
  toolSort: DEFAULT_SETTINGS.defaultToolSort,
  fileSort: DEFAULT_SETTINGS.defaultFileSort,
  insightsEntry: DEFAULT_SETTINGS.insightsEntry,
  durationCurve: DEFAULT_SETTINGS.defaultDurationCurve,
  fleetTab: DEFAULT_SETTINGS.fleetTab,
  promptPrefix: DEFAULT_SETTINGS.promptPrefix,
  promptSuffix: DEFAULT_SETTINGS.promptSuffix,
}

/** The store field each scope field lands in — the one mapping the in-flight overlay is keyed by. */
type PreferenceStateKey = Exclude<keyof SettingsState, 'status' | 'writable'>

const STATE_KEY: Record<SettingsField, PreferenceStateKey> = {
  defaultPlacement: 'placement',
  defaultGranularity: 'granularity',
  defaultTrendMode: 'mode',
  defaultDeltaBase: 'deltaBase',
  defaultToolSort: 'toolSort',
  defaultFileSort: 'fileSort',
  insightsEntry: 'insightsEntry',
  defaultDurationCurve: 'durationCurve',
  fleetTab: 'fleetTab',
  promptPrefix: 'promptPrefix',
  promptSuffix: 'promptSuffix',
}

/** The stored value of one scope field, in the store's own naming. */
function defaultValueOf(field: SettingsField): string {
  return String(DEFAULT_SETTINGS[field])
}

/** Every preference field, in declaration order — the key set a blanket reset walks. */
const ALL_FIELDS = Object.keys(DEFAULT_SETTINGS) as SettingsField[]

export function createContextSettings(): ContextSettings {
  let state: SettingsState = { status: 'loading', ...DEFAULT_STATE, writable: false }
  let scope: SettingsScopeLike | undefined
  const listeners = new Set<() => void>()
  /** Fields with a write still in flight, carrying the value that write will land.
   *
   *  A blanket reset puts eleven of them up at once, and the Host pushes the scope after EVERY write. Without
   *  this overlay each of those pushes would re-read a section where only the writes so far have landed, so it
   *  would stamp the not-yet-written fields back to their old values — the card visibly bounced between the
   *  two states, and a single refused write left it stranded part-way. `sync` lays the overlay over the served
   *  truth, so an in-flight field only yields to the scope once the scope actually carries the value (or the
   *  write settles and the entry is dropped).
   *
   *  Typed as {@link Prefs} rather than a string map: that shape is already keyed by the STORE's field names
   *  and already carries each field's narrow union, so merging it needs no cast. */
  const inFlight = new Map<PreferenceStateKey, Prefs[keyof Prefs]>()
  /** Every field is a scalar, so a shallow compare is the store's identity check — and a new preference
   *  joins it without editing a growing chain of `&&`s. */
  const unchanged = (a: SettingsState, b: SettingsState): boolean =>
    (Object.keys(b) as (keyof SettingsState)[]).every(key => a[key] === b[key])
  const publish = (next: SettingsState): void => {
    if (unchanged(state, next)) return
    state = next
    for (const listener of listeners) listener()
  }
  const sync = (bound: SettingsScopeLike): { placement?: DefaultPlacement; insightsEntry?: InsightsEntry; fleetTab?: FleetTab } => {
    const snap = bound.getSnapshot()
    // Bounded catch (the compatibility.md parser gate): a value that throws on property access
    // keeps the current state instead of throwing into the mirror's fan-out.
    let prefs: Prefs = {}
    let raw: Record<string, unknown> | undefined
    try {
      prefs = prefsOf(snap.value)
      raw = snap.value !== null && typeof snap.value === 'object' ? snap.value as Record<string, unknown> : undefined
    } catch { /* hostile value */ }
    // Fail open: a config problem must never leave an entry hidden. A value the plugin cannot understand
    // degrades to the field's default; a section without the field (older Host half) keeps the current state.
    const served: SettingsState = {
      status: snap.status === 'ready' || snap.status === 'unavailable' ? snap.status : 'loading',
      placement: prefs.placement ?? (raw?.defaultPlacement === undefined ? state.placement : DEFAULT_STATE.placement),
      granularity: prefs.granularity ?? state.granularity,
      mode: prefs.mode ?? state.mode,
      deltaBase: prefs.deltaBase ?? state.deltaBase,
      toolSort: prefs.toolSort ?? state.toolSort,
      fileSort: prefs.fileSort ?? state.fileSort,
      insightsEntry: prefs.insightsEntry ?? (raw?.insightsEntry === undefined ? state.insightsEntry : DEFAULT_STATE.insightsEntry),
      durationCurve: prefs.durationCurve ?? (raw?.defaultDurationCurve === undefined ? state.durationCurve : DEFAULT_STATE.durationCurve),
      fleetTab: prefs.fleetTab ?? (raw?.fleetTab === undefined ? state.fleetTab : DEFAULT_STATE.fleetTab),
      promptPrefix: prefs.promptPrefix ?? (raw?.promptPrefix === undefined ? state.promptPrefix : DEFAULT_STATE.promptPrefix),
      promptSuffix: prefs.promptSuffix ?? (raw?.promptSuffix === undefined ? state.promptSuffix : DEFAULT_STATE.promptSuffix),
      writable: snap.writable,
    }
    // The in-flight overlay wins over the served value until the SCOPE proves the write landed: a field retires
    // the moment a push carries the value this store wrote, not when the write's promise settles. Promise
    // settlement is the wrong signal — a Host may acknowledge before it pushes, and retiring on it would let
    // the next push stamp that field back to its stale value and then flip it forward again (one field
    // blinking through two states inside a single reset). Retiring on the EVIDENCE means a field is only ever
    // released to the served truth once the served truth already is the value we wanted.
    const merged: SettingsState = { ...served }
    for (const [key, value] of [...inFlight]) {
      if (served[key] === value) {
        // The scope carries it: this write is done, and the served value is already what we would have set.
        inFlight.delete(key)
      } else {
        Object.assign(merged, { [key]: value })
      }
    }
    publish(merged)
    retireOrphans(bound)
    return { placement: prefs.placement, insightsEntry: prefs.insightsEntry, fleetTab: prefs.fleetTab }
  }

  /** A settled write whose confirming push never arrives (the Host de-dupes equal values, or coalesces under
   *  load) would otherwise leave its overlay parked forever, pinning the field to a value the scope no longer
   *  holds — the row would refuse to follow any later external change. Once every write has settled, an
   *  overlay that has outlived that whole window has no push coming, so release it and let the served truth
   *  stand. A blanket reset parks eleven overlays at once; this is what eventually lets the stragglers go. */
  let outstandingWrites = 0
  let retireScheduled = false
  function retireOrphans(bound: SettingsScopeLike): void {
    if (outstandingWrites > 0 || inFlight.size === 0 || retireScheduled) return
    retireScheduled = true
    // One macrotask: every push the Host owes us for the writes in hand has had its turn by now.
    setTimeout(() => {
      retireScheduled = false
      if (outstandingWrites > 0 || inFlight.size === 0) return
      inFlight.clear()
      sync(bound)
    }, 0)
  }
  return {
    store: {
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      getSnapshot: () => state,
    },
    defaultPlacement: () => state.placement,
    defaultGranularity: () => state.granularity,
    defaultTrendMode: () => state.mode,
    defaultDeltaBase: () => state.deltaBase,
    defaultToolSort: () => state.toolSort,
    defaultFileSort: () => state.fileSort,
    insightsEntry: () => state.insightsEntry,
    defaultDurationCurve: () => state.durationCurve,
    fleetTab: () => state.fleetTab,
    attach(bound) {
      // A rebind (a new scope, or a re-attach after disposal) invalidates every parked overlay: the values
      // they were waiting to be confirmed against belong to the scope being replaced.
      inFlight.clear()
      outstandingWrites = 0
      scope = bound
      sync(bound)
      const unsubscribe = bound.subscribe(() => { sync(bound) })
      return () => {
        unsubscribe()
        // A set() after disposal must not write into a dead form.
        if (scope === bound) scope = undefined
      }
    },
    set: write,
    reset(field) {
      // A reset IS a write of the shipped default: it goes through the same local echo, the same fenced
      // scope write and the same refused-write rollback as any other choice.
      write(field, defaultValueOf(field))
    },
    resetAll() {
      // One publish, not eleven: a blanket reset must land as a single state change so no subscriber
      // ever sees a half-reset card (and the row reset buttons' visibility settles in one pass).
      // Every field is also parked in the in-flight overlay FIRST, so the Host push that follows each
      // individual write cannot stamp the still-unwritten fields back to their old values.
      publish({ ...state, ...DEFAULT_STATE })
      const bound = scope
      if (bound === undefined) return
      for (const field of ALL_FIELDS) write(field, defaultValueOf(field))
    },
  }

  /** One write, fenced by the in-flight overlay: the optimistic echo lands and the scope is told. The overlay
   *  entry is retired by `sync` the first time a push carries this value (evidence, not promise settlement —
   *  see `sync`), and forced off on refusal. A settled-but-unconfirmed write stays parked: releasing it early
   *  is what made a field blink through old-then-new mid-reset, and a later push (or another user action)
   *  retires it as soon as the scope agrees. */
  function write(field: SettingsField, value: string): void {
    const key = STATE_KEY[field]
    // Park the PARSED value, never the raw argument: an option id the plugin does not recognise is
    // dropped by `prefsOf` (so the echo is a no-op), and the overlay must not resurrect it either.
    const parsed = prefsOf({ [field]: value })
    if (Object.keys(parsed).length === 0) return
    inFlight.set(key, parsed[key])
    publish({ ...state, ...parsed })
    const bound = scope
    if (bound === undefined) {
      inFlight.delete(key)
      return
    }
    outstandingWrites += 1
    void bound.set(field, value).then(
      // Settled: let a push confirm it. `sync` drops the entry once the scope carries this value; if the
      // Host acknowledged without pushing, the next push (any field's) still retires it.
      () => { outstandingWrites -= 1; sync(bound) },
      () => {
        // Refused: retire the overlay FIRST, or it stamps the refused value straight back over the truth
        // the rollback is trying to recover.
        outstandingWrites -= 1
        inFlight.delete(key)
        const truth = sync(bound)
        // A gate whose write was refused must not stay hidden on an unpersisted echo: it degrades to the
        // default, while a scope that DOES carry a readable value keeps that truth (the sync above already did).
        const refused: Partial<SettingsState> = {}
        if (field === 'defaultPlacement' && truth.placement === undefined) refused.placement = DEFAULT_STATE.placement
        else if (field === 'insightsEntry' && truth.insightsEntry === undefined) refused.insightsEntry = DEFAULT_STATE.insightsEntry
        else if (field === 'fleetTab' && truth.fleetTab === undefined) refused.fleetTab = DEFAULT_STATE.fleetTab
        if (Object.keys(refused).length > 0) publish({ ...state, ...refused })
      },
    )
  }
}
