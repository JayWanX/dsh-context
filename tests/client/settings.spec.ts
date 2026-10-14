// Settings binding (src/client/settings.ts): the local-echo store over the harness configForms section.

import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { createContextSettings, DEFAULT_SETTINGS, type SettingsField, type SettingsScopeLike, type SettingsState } from '../../src/client/settings'

/** A faithful in-memory settings form (the harness configForms.get contract:
 * getSnapshot/subscribe/set), not a mock of plugin code. */
class TestSettingsScope implements SettingsScopeLike {
  private snapshot: { status: string; value: unknown; writable: boolean }
  private readonly listeners = new Set<() => void>()
  readonly sets: { field: string; value: unknown }[] = []

  constructor(snapshot: { status: string; value: unknown; writable: boolean }) {
    this.snapshot = snapshot
  }

  getSnapshot(): { status: string; value: unknown; writable: boolean } {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** When true the write rejects, like a transport failure on the wire call. */
  failSet = false

  set(field: string, value: unknown): Promise<void> {
    this.sets.push({ field, value })
    return this.failSet ? Promise.reject(new Error('write failed')) : Promise.resolve()
  }

  /** Push a new snapshot, like the Host delivering a section update. */
  emit(snapshot: { status: string; value: unknown; writable: boolean }): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

/** The scope field name says `default*` where the store drops the prefix — the one mapping the card and this
 *  suite both need. */
const STATE_KEY: Record<SettingsField, keyof SettingsState> = {
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

const stateKeyOf = (field: SettingsField): keyof SettingsState => STATE_KEY[field]

/**
 * A Host that actually LANDS each write and pushes the section afterwards — the real behaviour
 * `TestSettingsScope` deliberately skips. Writes are serialised and each one pushes a snapshot in which
 * ONLY the writes so far are visible, which is exactly what made a blanket reset bounce: every push stamped
 * the not-yet-written fields back to their old values.
 */
class SerialHostScope implements SettingsScopeLike {
  private snapshot: { status: string; value: unknown; writable: boolean }
  private readonly listeners = new Set<() => void>()
  readonly sets: { field: string; value: unknown }[] = []
  /** Acknowledge each write before pushing it, like a Host that resolves its queue first. */
  ackBeforePush = true

  constructor(initial: Record<string, unknown>) {
    this.snapshot = { status: 'ready', value: { ...initial }, writable: true }
  }

  getSnapshot(): { status: string; value: unknown; writable: boolean } {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(field: string, value: unknown): Promise<void> {
    this.sets.push({ field, value })
    const push = () => {
      this.snapshot = { ...this.snapshot, value: { ...(this.snapshot.value as Record<string, unknown>), [field]: value } }
      for (const listener of this.listeners) listener()
    }
    if (!this.ackBeforePush) {
      push()
      return Promise.resolve()
    }
    return Promise.resolve().then(push)
  }
}

describe('createContextSettings defaults', () => {
  test('starts loading with schema defaults and not writable', () => {
    const s = createContextSettings()
    assert.deepEqual(s.store.getSnapshot(), {
      status: 'loading',
      placement: 'all',
      granularity: 'step',
      mode: 'total',
      deltaBase: 'step',
      toolSort: 'count',
      fileSort: 'count',
      insightsEntry: 'show',
      durationCurve: 'show',
      fleetTab: 'show',
      promptPrefix: '',
      promptSuffix: '',
      writable: false,
    })
    assert.equal(s.defaultPlacement(), 'all')
    assert.equal(s.defaultGranularity(), 'step')
    assert.equal(s.defaultTrendMode(), 'total')
    assert.equal(s.defaultDeltaBase(), 'step')
    assert.equal(s.defaultToolSort(), 'count')
    assert.equal(s.defaultFileSort(), 'count')
    assert.equal(s.insightsEntry(), 'show')
    assert.equal(s.defaultDurationCurve(), 'show')
    assert.equal(s.fleetTab(), 'show')
  })
})

describe('store', () => {
  test('subscribers are notified on change and unsubscribe stops', () => {
    const s = createContextSettings()
    let calls = 0
    const unsubscribe = s.store.subscribe(() => { calls++ })
    s.set('defaultTrendMode', 'delta')
    assert.equal(calls, 1)
    assert.equal(s.store.getSnapshot().mode, 'delta')
    unsubscribe()
    s.set('defaultTrendMode', 'total')
    assert.equal(calls, 1)
  })
})

describe('set', () => {
  test('without attach it echoes locally and never throws', () => {
    const s = createContextSettings()
    s.set('defaultGranularity', 'turn')
    assert.equal(s.defaultGranularity(), 'turn')
    s.set('defaultPlacement', 'sidebar')
    assert.equal(s.defaultPlacement(), 'sidebar')
    s.set('defaultDeltaBase', 'turn')
    assert.equal(s.defaultDeltaBase(), 'turn')
    s.set('promptPrefix', 'Be terse.')
    assert.equal(s.store.getSnapshot().promptPrefix, 'Be terse.')
  })

  test('an unchanged value does not notify listeners', () => {
    const s = createContextSettings()
    let calls = 0
    s.store.subscribe(() => { calls++ })
    s.set('defaultGranularity', 'step')
    assert.equal(calls, 0)
  })

  test('an invalid value is dropped without notifying', () => {
    const s = createContextSettings()
    let calls = 0
    s.store.subscribe(() => { calls++ })
    s.set('defaultGranularity', 'bogus')
    assert.equal(s.defaultGranularity(), 'step')
    assert.equal(calls, 0)
  })

  test('with attach it echoes locally and writes through the scope', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    s.attach(scope)
    s.set('defaultTrendMode', 'delta')
    assert.equal(s.defaultTrendMode(), 'delta')
    assert.deepEqual(scope.sets, [{ field: 'defaultTrendMode', value: 'delta' }])
  })

  test('a rejected scope write settles handled and rolls the echo back to the scope truth', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultTrendMode: 'total' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('defaultTrendMode', 'delta')
    assert.equal(s.defaultTrendMode(), 'delta', 'the optimistic echo lands first')
    // Let the rejection settle: the catch re-syncs from the scope's snapshot.
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.defaultTrendMode(), 'total', 'the echo rolls back to the scope truth')
  })

  test('a rejected write keeps a preference the scope does not carry', async () => {
    // The scope's snapshot lacks the field entirely (older Host half): the
    // rollback sync keeps the in-session choice rather than dropping it.
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('defaultFileSort', 'path')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.defaultFileSort(), 'path')
  })

  test('a rejected placement write degrades to all when the scope carries no valid value', async () => {
    // Fail open: the unpersisted echo must not keep hiding an entry until
    // the next reload — with nothing valid in the scope's truth, fall back to `all`.
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('defaultPlacement', 'sidebar')
    assert.equal(s.defaultPlacement(), 'sidebar', 'the optimistic echo lands first')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.defaultPlacement(), 'all', 'the echo degrades instead of staying unpersisted')
  })

  test('a rejected placement write rolls back to the scope\'s valid truth', async () => {
    // The scope truth itself is a valid placement: the rollback restores it, no forced degrade.
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('defaultPlacement', 'tab')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.defaultPlacement(), 'sidebar')
  })

  test('a rejected insights-entry write degrades to show when the scope carries no valid value', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('insightsEntry', 'hide')
    assert.equal(s.insightsEntry(), 'hide', 'the optimistic echo lands first')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.insightsEntry(), 'show', 'the echo degrades instead of staying unpersisted')
  })

  test('a rejected insights-entry write rolls back to the scope\'s valid truth', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { insightsEntry: 'hide' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('insightsEntry', 'show')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.insightsEntry(), 'hide')
  })

  test('a rejected fleet-tab write degrades to show when the scope carries no valid value', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('fleetTab', 'hide')
    assert.equal(s.fleetTab(), 'hide', 'the optimistic echo lands first')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.fleetTab(), 'show', 'an unpersisted hide must not keep the tab away')
  })

  test('a rejected fleet-tab write rolls back to the scope\'s valid truth', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { fleetTab: 'hide' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('fleetTab', 'show')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.fleetTab(), 'hide')
  })

  test('a rejected prompt write rolls back to the scope truth', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { promptPrefix: 'kept' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.set('promptPrefix', 'draft')
    assert.equal(s.store.getSnapshot().promptPrefix, 'draft', 'the optimistic echo lands first')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.store.getSnapshot().promptPrefix, 'kept', 'the echo rolls back to the scope truth')
  })
})

describe('reset', () => {
  test('without attach it restores the shipped default locally and never throws', () => {
    const s = createContextSettings()
    s.set('defaultPlacement', 'sidebar')
    assert.equal(s.store.getSnapshot().placement, 'sidebar')
    s.reset('defaultPlacement')
    assert.equal(s.store.getSnapshot().placement, 'all', 'DEFAULT_SETTINGS.defaultPlacement')
    // Every field, including the two free-text ones, resolves its own default.
    s.set('promptSuffix', 'Sign as Atlas.')
    s.reset('promptSuffix')
    assert.equal(s.store.getSnapshot().promptSuffix, '')
    s.set('insightsEntry', 'hide')
    s.reset('insightsEntry')
    assert.equal(s.store.getSnapshot().insightsEntry, 'show')
  })

  test('with attach it restores the default through the scope, like any other write', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    s.attach(scope)
    assert.equal(s.store.getSnapshot().placement, 'sidebar')
    s.reset('defaultPlacement')
    assert.equal(s.store.getSnapshot().placement, 'all', 'the local echo lands first')
    assert.deepEqual(scope.sets, [{ field: 'defaultPlacement', value: 'all' }])
  })

  test('a rejected reset rolls back to the scope truth, exactly like a rejected set', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.reset('defaultPlacement')
    assert.equal(s.store.getSnapshot().placement, 'all', 'the optimistic echo lands first')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.store.getSnapshot().placement, 'sidebar', 'the echo rolls back to the scope truth')
  })

  test('the cold state and a reset agree with the shared DEFAULT_SETTINGS declaration', () => {
    const s = createContextSettings()
    const cold = s.store.getSnapshot()
    for (const field of Object.keys(DEFAULT_SETTINGS) as SettingsField[]) {
      s.set(field, 'a-value-the-parser-rejects')
      s.reset(field)
    }
    // Every scalar is back where a fresh store starts: the reset path cannot disagree with the cold path.
    assert.deepEqual(s.store.getSnapshot(), cold)
  })
})

describe('resetAll', () => {
  test('without attach it restores every field locally, in ONE publish', () => {
    const s = createContextSettings()
    let notifications = 0
    s.store.subscribe(() => { notifications++ })
    for (const field of Object.keys(DEFAULT_SETTINGS) as SettingsField[]) s.set(field, 'a-value-the-parser-rejects')
    notifications = 0
    s.resetAll()
    assert.equal(notifications, 1, 'a blanket reset is a single state change, not eleven')
    const state = s.store.getSnapshot()
    for (const [field, value] of Object.entries(DEFAULT_SETTINGS) as [SettingsField, string][]) {
      assert.equal(state[stateKeyOf(field)], value, `${field} is back to its default`)
    }
  })

  test('with attach it writes every field through the scope, once each', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({
      status: 'ready',
      value: { defaultPlacement: 'sidebar', defaultToolSort: 'name', promptPrefix: 'Be terse.' },
      writable: true,
    })
    s.attach(scope)
    s.resetAll()
    assert.deepEqual(
      scope.sets.map(w => `${w.field}=${w.value}`),
      Object.entries(DEFAULT_SETTINGS).map(([f, v]) => `${f}=${v}`),
      'one write per field, each carrying that field\'s own default',
    )
  })

  test('a blanket reset never bounces: no push may stamp a field back to its old value', async () => {
    // The regression this whole overlay exists for. A Host that pushes after every write shows a section
    // where only the writes so far have landed; before the overlay, each of those eleven pushes overwrote
    // the still-unwritten fields with their pre-reset values, so the card visibly fell back mid-reset and
    // then jumped forward again at the end.
    const edited: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(DEFAULT_SETTINGS)) {
      edited[field] = value === '' ? 'edited' : (value === 'all' ? 'tab' : (value === 'step' ? 'turn' : 'changed'))
    }
    const s = createContextSettings()
    const host = new SerialHostScope(edited)
    s.attach(host)
    assert.notDeepEqual(s.store.getSnapshot().placement, DEFAULT_SETTINGS.defaultPlacement, 'the starting state really is edited')

    // Record every distinct state the store passes through while the reset drains.
    const seen: SettingsState[] = []
    const stop = s.store.subscribe(() => { seen.push(s.store.getSnapshot()) })
    s.resetAll()
    for (let i = 0; i < 50; i++) await new Promise(resolve => setTimeout(resolve, 0))
    stop()

    // Every field must be at its default in EVERY state the store passed through — not merely at the end.
    // (With the overlay there is typically only ONE published state: the reset lands as a single change.
    // Before it, each of the Host's eleven pushes republished a half-reset state and this loop caught it.)
    assert.ok(seen.length >= 1, 'the reset published at least its optimistic state')
    for (const [i, state] of seen.entries()) {
      for (const [field, value] of Object.entries(DEFAULT_SETTINGS) as [SettingsField, string][]) {
        assert.equal(state[stateKeyOf(field)], value, `state #${i}: ${field} bounced away from its default`)
      }
    }
    // And it settles on the defaults.
    assert.deepEqual(
      { ...s.store.getSnapshot() },
      { status: 'ready', writable: true, placement: DEFAULT_SETTINGS.defaultPlacement, granularity: DEFAULT_SETTINGS.defaultGranularity, mode: DEFAULT_SETTINGS.defaultTrendMode, deltaBase: DEFAULT_SETTINGS.defaultDeltaBase, toolSort: DEFAULT_SETTINGS.defaultToolSort, fileSort: DEFAULT_SETTINGS.defaultFileSort, insightsEntry: DEFAULT_SETTINGS.insightsEntry, durationCurve: DEFAULT_SETTINGS.defaultDurationCurve, fleetTab: DEFAULT_SETTINGS.fleetTab, promptPrefix: DEFAULT_SETTINGS.promptPrefix, promptSuffix: DEFAULT_SETTINGS.promptSuffix },
    )
  })

  test('an orphaned overlay is released: a settled write whose push never arrives must not pin the field', async () => {
    // A Host that acknowledges the write but never pushes the value back (it de-duped an equal value). Without
    // the release, the overlay would hold this field forever and the row would ignore any later change.
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    s.attach(scope)
    s.set('defaultPlacement', 'tab')
    await new Promise(resolve => setTimeout(resolve, 0))
    // The scope still reports the pre-write value and never will again.
    assert.equal(s.store.getSnapshot().placement, 'tab', 'the optimistic echo stands while the write is unconfirmed')
    // An unrelated external change to the SAME field must eventually win, or the row is frozen.
    scope.emit({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.store.getSnapshot().placement, 'sidebar', 'the served truth takes over once the write is retired')
  })

  test('rapid re-writes of one field do not let a stale push retire the newest overlay', async () => {
    const s = createContextSettings()
    const host = new SerialHostScope({ defaultPlacement: 'all' })
    s.attach(host)
    host.set('defaultPlacement', 'sidebar')
    // Two writes back to back: the first push carries the FIRST value, which must not retire the second's
    // overlay — otherwise the row flips sidebar → tab → sidebar instead of settling on tab.
    s.set('defaultPlacement', 'sidebar')
    s.set('defaultPlacement', 'tab')
    for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.store.getSnapshot().placement, 'tab', 'the newest choice is the one that stands')
  })

  test('a refused blanket write rolls that field back to the scope truth, like any other write', async () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    s.attach(scope)
    scope.failSet = true
    s.resetAll()
    assert.equal(s.store.getSnapshot().placement, 'all', 'the bulk echo lands first')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(s.store.getSnapshot().placement, 'sidebar', 'the refused field recovers to the scope truth')
  })
})

describe('attach', () => {
  test('syncs a ready snapshot with parsed preferences', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({
      status: 'ready',
      value: {
        defaultPlacement: 'sidebar',
        defaultGranularity: 'turn',
        defaultTrendMode: 'delta',
        defaultDeltaBase: 'turn',
        defaultToolSort: 'name',
        defaultFileSort: 'path',
        insightsEntry: 'hide',
        defaultDurationCurve: 'hide',
        fleetTab: 'hide',
        promptPrefix: 'Be terse.',
        promptSuffix: 'Sign as Atlas.',
      },
      writable: true,
    })
    s.attach(scope)
    assert.deepEqual(s.store.getSnapshot(), {
      status: 'ready',
      placement: 'sidebar',
      granularity: 'turn',
      mode: 'delta',
      deltaBase: 'turn',
      toolSort: 'name',
      fileSort: 'path',
      insightsEntry: 'hide',
      durationCurve: 'hide',
      fleetTab: 'hide',
      promptPrefix: 'Be terse.',
      promptSuffix: 'Sign as Atlas.',
      writable: true,
    })
  })

  test('an unavailable snapshot keeps parsed preferences', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'unavailable', value: {}, writable: false })
    s.attach(scope)
    assert.equal(s.store.getSnapshot().status, 'unavailable')
  })

  test('any other snapshot status reads as loading', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'pending', value: {}, writable: false })
    s.attach(scope)
    assert.equal(s.store.getSnapshot().status, 'loading')
  })

  test('null/non-object section values keep the defaults', () => {
    for (const value of [null, 42]) {
      const s = createContextSettings()
      s.attach(new TestSettingsScope({ status: 'ready', value, writable: false }))
      assert.deepEqual(s.store.getSnapshot(), {
        status: 'ready',
        placement: 'all',
        granularity: 'step',
        mode: 'total',
        deltaBase: 'step',
        toolSort: 'count',
        fileSort: 'count',
        insightsEntry: 'show',
        durationCurve: 'show',
        fleetTab: 'show',
        promptPrefix: '',
        promptSuffix: '',
        writable: false,
      })
    }
  })

  test('invalid preference values keep the defaults', () => {
    const s = createContextSettings()
    s.attach(new TestSettingsScope({
      status: 'ready',
      value: { defaultPlacement: 'window', defaultGranularity: 'bogus', defaultTrendMode: 7, defaultDeltaBase: 'bogus', defaultToolSort: 'alpha', defaultFileSort: 'alpha', insightsEntry: 42, defaultDurationCurve: 'always', fleetTab: 7, promptPrefix: 9, promptSuffix: {} },
      writable: false,
    }))
    assert.equal(s.defaultPlacement(), 'all')
    assert.equal(s.defaultGranularity(), 'step')
    assert.equal(s.defaultTrendMode(), 'total')
    assert.equal(s.defaultDeltaBase(), 'step')
    assert.equal(s.defaultToolSort(), 'count')
    assert.equal(s.defaultFileSort(), 'count')
    assert.equal(s.insightsEntry(), 'show')
    assert.equal(s.defaultDurationCurve(), 'show')
    assert.equal(s.fleetTab(), 'show')
    assert.equal(s.store.getSnapshot().promptPrefix, '', 'a non-string prompt value degrades to the empty default')
    assert.equal(s.store.getSnapshot().promptSuffix, '')
  })

  test('an invalid scope placement degrades to all instead of keeping the current one', () => {
    // Fail open on the read path too: a value the plugin cannot understand must not strand a previously chosen placement.
    const s = createContextSettings()
    s.set('defaultPlacement', 'tab')
    assert.equal(s.defaultPlacement(), 'tab')
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultPlacement: 42 }, writable: false })
    s.attach(scope)
    assert.equal(s.defaultPlacement(), 'all')
  })

  test('an invalid scope insights entry degrades to show instead of keeping the current one', () => {
    // Fail open on the read path too: a config problem must not leave the panel's entry hidden.
    const s = createContextSettings()
    s.set('insightsEntry', 'hide')
    assert.equal(s.insightsEntry(), 'hide')
    const scope = new TestSettingsScope({ status: 'ready', value: { insightsEntry: 'visible' }, writable: false })
    s.attach(scope)
    assert.equal(s.insightsEntry(), 'show')
  })

  test('an invalid scope duration-curve value degrades to show instead of keeping the current one', () => {
    const s = createContextSettings()
    s.set('defaultDurationCurve', 'hide')
    assert.equal(s.defaultDurationCurve(), 'hide')
    const scope = new TestSettingsScope({ status: 'ready', value: { defaultDurationCurve: 'always' }, writable: false })
    s.attach(scope)
    assert.equal(s.defaultDurationCurve(), 'show')
  })

  test('explicit schema-default values are accepted', () => {
    const s = createContextSettings()
    s.attach(new TestSettingsScope({
      status: 'ready',
      value: { defaultPlacement: 'all', defaultGranularity: 'step', defaultTrendMode: 'total', defaultDeltaBase: 'step', defaultToolSort: 'count', defaultFileSort: 'count', insightsEntry: 'show' },
      writable: false,
    }))
    assert.equal(s.defaultPlacement(), 'all')
    assert.equal(s.defaultGranularity(), 'step')
    assert.equal(s.defaultTrendMode(), 'total')
    assert.equal(s.defaultDeltaBase(), 'step')
    assert.equal(s.defaultToolSort(), 'count')
    assert.equal(s.defaultFileSort(), 'count')
    assert.equal(s.insightsEntry(), 'show')
  })

  test('missing fields keep the current state', () => {
    const s = createContextSettings()
    s.set('defaultPlacement', 'tab')
    s.set('defaultToolSort', 'size')
    s.set('insightsEntry', 'hide')
    s.set('defaultDurationCurve', 'hide')
    s.set('promptPrefix', 'drafted')
    s.attach(new TestSettingsScope({ status: 'ready', value: { defaultFileSort: 'latest' }, writable: false }))
    assert.equal(s.defaultPlacement(), 'tab', 'the in-session choice survives a section without the field')
    assert.equal(s.defaultGranularity(), 'step')
    assert.equal(s.defaultTrendMode(), 'total')
    assert.equal(s.defaultToolSort(), 'size', 'the in-session tool sort survives a section without the field')
    assert.equal(s.defaultFileSort(), 'latest')
    assert.equal(s.insightsEntry(), 'hide', 'the in-session entry choice survives a section without the field')
    assert.equal(s.defaultDurationCurve(), 'hide', 'the in-session curve choice survives a section without the field')
    assert.equal(s.store.getSnapshot().promptPrefix, 'drafted', 'the in-session prompt text survives a section without the field')
  })

  test('scope updates republish to subscribers', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    s.attach(scope)
    let calls = 0
    s.store.subscribe(() => { calls++ })
    scope.emit({ status: 'ready', value: { defaultGranularity: 'turn' }, writable: true })
    assert.equal(calls, 1)
    assert.equal(s.defaultGranularity(), 'turn')
    scope.emit({ status: 'ready', value: { defaultGranularity: 'turn', defaultTrendMode: 'delta' }, writable: true })
    assert.equal(calls, 2)
    assert.equal(s.defaultTrendMode(), 'delta')
    scope.emit({ status: 'ready', value: { defaultFileSort: 'path' }, writable: true })
    assert.equal(calls, 3)
    assert.equal(s.defaultFileSort(), 'path')
    scope.emit({ status: 'ready', value: { defaultPlacement: 'sidebar' }, writable: true })
    assert.equal(calls, 4)
    assert.equal(s.defaultPlacement(), 'sidebar')
    scope.emit({ status: 'ready', value: { defaultToolSort: 'name' }, writable: true })
    assert.equal(calls, 5)
    assert.equal(s.defaultToolSort(), 'name')
    scope.emit({ status: 'ready', value: { defaultDeltaBase: 'turn' }, writable: true })
    assert.equal(calls, 6)
    assert.equal(s.defaultDeltaBase(), 'turn')
    scope.emit({ status: 'ready', value: { defaultFileSort: 'path' }, writable: false })
    assert.equal(calls, 7)
    assert.equal(s.store.getSnapshot().writable, false)
    scope.emit({ status: 'ready', value: { insightsEntry: 'hide' }, writable: false })
    assert.equal(calls, 8)
    assert.equal(s.insightsEntry(), 'hide')
  })

  test('an identical scope snapshot does not notify listeners', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({
      status: 'ready',
      value: { defaultGranularity: 'turn', defaultFileSort: 'latest' },
      writable: true,
    })
    s.attach(scope)
    let calls = 0
    s.store.subscribe(() => { calls++ })
    scope.emit({ status: 'ready', value: { defaultGranularity: 'turn', defaultFileSort: 'latest' }, writable: true })
    assert.equal(calls, 0)
  })

  test('the returned disposer detaches the scope subscription', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    const detach = s.attach(scope)
    detach()
    let calls = 0
    s.store.subscribe(() => { calls++ })
    scope.emit({ status: 'ready', value: { defaultGranularity: 'turn' }, writable: true })
    assert.equal(calls, 0)
    assert.equal(s.defaultGranularity(), 'step')
  })

  test('a set after the disposer runs never reaches the dead scope', () => {
    const s = createContextSettings()
    const scope = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    const detach = s.attach(scope)
    detach()
    s.set('defaultTrendMode', 'delta')
    assert.deepEqual(scope.sets, [])
  })

  test('disposing a superseded attach keeps the newer scope bound', () => {
    const s = createContextSettings()
    const first = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    const second = new TestSettingsScope({ status: 'ready', value: {}, writable: true })
    const detachFirst = s.attach(first)
    s.attach(second)
    detachFirst()
    s.set('defaultTrendMode', 'delta')
    assert.deepEqual(first.sets, [])
    assert.deepEqual(second.sets, [{ field: 'defaultTrendMode', value: 'delta' }])
  })

  test('a snapshot value that throws on property access keeps the current state', () => {
    const s = createContextSettings()
    const hostile = new Proxy({}, { get() { throw new Error('hostile') } })
    s.attach(new TestSettingsScope({ status: 'ready', value: hostile, writable: true }))
    assert.deepEqual(s.store.getSnapshot(), {
      status: 'ready',
      placement: 'all',
      granularity: 'step',
      mode: 'total',
      deltaBase: 'step',
      toolSort: 'count',
      fileSort: 'count',
      insightsEntry: 'show',
      durationCurve: 'show',
      fleetTab: 'show',
      promptPrefix: '',
      promptSuffix: '',
      writable: true,
    })
  })
})
