import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { makePluginConfigCard } from '../../../src/client/components/settingsCard'
import type { SettingsState } from '../../../src/client/settings'
import { DEFAULT_SETTINGS } from '../../../src/client/settings'
import { DICT_EN } from '../../../src/client/i18n'
import { blur, click, focus, keydown, makeKit, mount, query, queryAll, text, typeText } from '../helpers/kit'

const kit = makeKit()
const PluginConfigCard = makePluginConfigCard(kit)

function hookFor(state: SettingsState) {
  return <T,>(sel: (s: SettingsState) => T): T => sel(state)
}

function stateOf(partial: Partial<SettingsState> = {}): SettingsState {
  return { status: 'ready', placement: 'all', granularity: 'step', mode: 'total', deltaBase: 'step', toolSort: 'count', fileSort: 'count', insightsEntry: 'show', durationCurve: 'show', fleetTab: 'show', promptPrefix: '', promptSuffix: '', writable: true, ...partial }
}

/** Menu items portaled into document.body while a select is open. */
function menuItems(): HTMLElement[] {
  return queryAll(document.body, '[role="menu"] [role="menuitem"]')
}

/** The three on/off gates, in row order: the insights entry, the Fleet tab, the trend duration curve. */
function switches(container: ParentNode): HTMLButtonElement[] {
  return queryAll<HTMLButtonElement>(container, '[role="switch"]')
}

/** Every store field beside the scope name DEFAULT_SETTINGS files it under, and a value that is NOT the
 *  default. Walking this proves the blanket reset's dirty test covers every field the card renders. */
const CHANGED_BY_STATE_KEY: readonly (readonly [keyof SettingsState, unknown])[] = [
  ['placement', 'tab'],
  ['insightsEntry', 'hide'],
  ['fleetTab', 'hide'],
  ['granularity', 'turn'],
  ['mode', 'delta'],
  ['durationCurve', 'hide'],
  ['deltaBase', 'turn'],
  ['toolSort', 'name'],
  ['fileSort', 'path'],
  ['promptPrefix', 'Be terse.'],
  ['promptSuffix', 'Sign as Atlas.'],
]

describe('PluginConfigCard (the Plugins-page seat)', () => {
  test('renders nothing without a settings hook or when the namespace is unavailable', async () => {
    const m1 = await mount(h(PluginConfigCard, {}))
    assert.equal(m1.container.childElementCount, 0)
    await m1.unmount()

    const m2 = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf({ status: 'unavailable' })) }))
    assert.equal(m2.container.childElementCount, 0)
    await m2.unmount()
  })

  test('renders the six selects, three switches and the two prompt text rows across three titled groups — no card chrome', async () => {
    const m = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf({ status: 'loading', writable: false })) }))
    assert.equal(m.container.querySelector('.lc-settings-card'), null, 'no settings-section chrome')
    assert.ok(query(m.container, '.lc-settings-prefs'))
    const groups = queryAll(m.container, '.lc-settings-group')
    assert.equal(groups.length, 3)
    assert.deepEqual(groups.map(g => g.getAttribute('aria-label')), [
      DICT_EN['settings.group.entry'],
      DICT_EN['settings.group.view'],
      DICT_EN['settings.group.prompt'],
    ])
    // Six of the nine former two-option menus; the three on/off gates moved to Switches.
    const selects = queryAll<HTMLButtonElement>(m.container, '.lc-settings-select')
    assert.equal(selects.length, 6)
    assert.ok(selects.every(s => s.disabled), 'loading is not ready: the rows are disabled')
    const toggles = switches(m.container)
    assert.equal(toggles.length, 3)
    assert.ok(toggles.every(t => t.disabled && t.getAttribute('aria-checked') === 'true'), 'loading is not ready; all three gates default to shown')
    const textareas = queryAll<HTMLTextAreaElement>(m.container, '.lc-settings-textarea')
    assert.equal(textareas.length, 2)
    assert.ok(textareas.every(t => t.disabled), 'loading is not ready: the text rows are disabled')
    assert.ok(text(groups[2]).includes(DICT_EN['settings.promptHint']), 'the prompt hint lives inside the prompt group')
    // Every row carries its description: the title column is a two-line stack, not a bare label.
    assert.equal(queryAll(m.container, '.lc-settings-row-desc').length, 11)
    assert.equal(m.container.querySelector('[role="status"]'), null, 'no read-only notice while loading')
    await m.unmount()
  })

  test('ready+writable: enabled selects pick through the real portaled Menu', async () => {
    const calls: [string, string][] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf()),
      set: (field, value) => { calls.push([field, value]) },
    }))
    const selects = queryAll<HTMLButtonElement>(m.container, '.lc-settings-select')
    assert.ok(selects.every(s => !s.disabled))
    assert.equal(m.container.querySelector('[role="status"]'), null, 'writable: no read-only notice')
    assert.ok(text(m.container).includes(DICT_EN['settings.placement']))
    assert.ok(text(m.container).includes(DICT_EN['settings.placementDesc']))
    assert.ok(text(selects[0]).includes(DICT_EN['placement.all']))
    await click(selects[0])
    assert.equal(selects[0].getAttribute('aria-expanded'), 'true')
    const placementItems = menuItems()
    assert.equal(placementItems.length, 3)
    assert.deepEqual(placementItems.map(i => text(i)), [
      DICT_EN['placement.all'],
      DICT_EN['placement.tab'],
      DICT_EN['placement.sidebar'],
    ])
    await click(placementItems[2]) // 'Sidebar'
    assert.deepEqual(calls, [['defaultPlacement', 'sidebar']])
    assert.equal(selects[0].getAttribute('aria-expanded'), 'false')
    assert.equal(document.body.querySelector('[role="menu"]'), null)

    assert.ok(text(selects[1]).includes(DICT_EN['gran.step']))
    assert.ok(text(selects[2]).includes(DICT_EN['gran.total']))
    // The delta-baseline row leads the two sort rows, reusing the browser/toolbar option labels.
    assert.ok(text(selects[3]).includes(DICT_EN['browser.base.step']))
    assert.ok(text(selects[4]).includes(DICT_EN['tool.sort.count']))
    assert.ok(text(selects[5]).includes(DICT_EN['files.sort.count']))

    await click(selects[1])
    const items = menuItems()
    assert.deepEqual(items.map(i => text(i)), [DICT_EN['gran.step'], DICT_EN['gran.turn']])
    await click(items[1]) // 'Turn'
    assert.deepEqual(calls, [['defaultPlacement', 'sidebar'], ['defaultGranularity', 'turn']])

    await click(selects[2])
    const modeItems = menuItems()
    assert.deepEqual(modeItems.map(i => text(i)), [DICT_EN['gran.total'], DICT_EN['gran.delta']])
    await click(modeItems[1]) // 'Delta'
    assert.deepEqual(calls, [
      ['defaultPlacement', 'sidebar'],
      ['defaultGranularity', 'turn'],
      ['defaultTrendMode', 'delta'],
    ])

    await click(selects[3])
    const baseItems = menuItems()
    assert.deepEqual(baseItems.map(i => text(i)), [DICT_EN['browser.base.step'], DICT_EN['browser.base.turn']])
    await click(baseItems[1]) // 'prev turn'
    assert.deepEqual(calls, [
      ['defaultPlacement', 'sidebar'],
      ['defaultGranularity', 'turn'],
      ['defaultTrendMode', 'delta'],
      ['defaultDeltaBase', 'turn'],
    ])

    await click(selects[4])
    const toolItems = menuItems()
    assert.deepEqual(toolItems.map(i => text(i)), [
      DICT_EN['tool.sort.size'],
      DICT_EN['tool.sort.count'],
      DICT_EN['tool.sort.name'],
    ])
    await click(toolItems[2]) // 'By name'
    assert.deepEqual(calls, [
      ['defaultPlacement', 'sidebar'],
      ['defaultGranularity', 'turn'],
      ['defaultTrendMode', 'delta'],
      ['defaultDeltaBase', 'turn'],
      ['defaultToolSort', 'name'],
    ])

    await click(selects[5])
    const sortItems = menuItems()
    assert.deepEqual(sortItems.map(i => text(i)), [
      DICT_EN['files.sort.count'],
      DICT_EN['files.sort.latest'],
      DICT_EN['files.sort.path'],
    ])
    await click(sortItems[2]) // 'By path'
    assert.deepEqual(calls, [
      ['defaultPlacement', 'sidebar'],
      ['defaultGranularity', 'turn'],
      ['defaultTrendMode', 'delta'],
      ['defaultDeltaBase', 'turn'],
      ['defaultToolSort', 'name'],
      ['defaultFileSort', 'path'],
    ])
    assert.equal(document.body.querySelector('[role="menu"]'), null)

    await click(selects[0])
    assert.equal(selects[0].getAttribute('aria-expanded'), 'true')
    await click(selects[0])
    assert.equal(selects[0].getAttribute('aria-expanded'), 'false')
    assert.equal(document.body.querySelector('[role="menu"]'), null)
    await m.unmount()
  })

  test('the three on/off gates are switches: a click writes show/hide and the served value drives the thumb', async () => {
    const calls: [string, string][] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf()),
      set: (field, value) => { calls.push([field, value]) },
    }))
    const toggles = switches(m.container)
    // Row order: the insights entry and the Fleet tab lead the entry group; the duration curve leads the view one.
    assert.equal(toggles[0].getAttribute('aria-label'), DICT_EN['settings.insightsEntry'])
    assert.equal(toggles[1].getAttribute('aria-label'), DICT_EN['settings.fleetTab'])
    assert.equal(toggles[2].getAttribute('aria-label'), DICT_EN['settings.durationCurve'])
    assert.ok(toggles.every(t => t.getAttribute('aria-checked') === 'true'))

    await click(toggles[0])
    assert.deepEqual(calls, [['insightsEntry', 'hide']])
    await click(toggles[1])
    assert.deepEqual(calls, [['insightsEntry', 'hide'], ['fleetTab', 'hide']])
    await click(toggles[2])
    assert.deepEqual(calls, [
      ['insightsEntry', 'hide'],
      ['fleetTab', 'hide'],
      ['defaultDurationCurve', 'hide'],
    ])
    await m.unmount()

    // The thumb follows the served value, so a host push (or the optimistic echo) moves it without a remount.
    const served = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf({ insightsEntry: 'hide', fleetTab: 'hide', durationCurve: 'hide' })) }))
    assert.ok(switches(served.container).every(t => t.getAttribute('aria-checked') === 'false'))
    await served.unmount()

    // …and the same switches write 'show' from that off state: the on branch of each show/hide ternary.
    const on: [string, string][] = []
    const fromOff = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ insightsEntry: 'hide', fleetTab: 'hide', durationCurve: 'hide' })),
      set: (field, value) => { on.push([field, value]) },
    }))
    const offToggles = switches(fromOff.container)
    await click(offToggles[0])
    await click(offToggles[1])
    await click(offToggles[2])
    assert.deepEqual(on, [
      ['insightsEntry', 'show'],
      ['fleetTab', 'show'],
      ['defaultDurationCurve', 'show'],
    ])
    await fromOff.unmount()
  })

  test('the per-row reset appears only on a changed row and restores that one field', async () => {
    const calls: [string, string][] = []
    const resets: string[] = []
    // Only two rows differ from the shipped defaults.
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ placement: 'sidebar', toolSort: 'name' })),
      set: (field, value) => { calls.push([field, value]) },
      reset: (field) => { resets.push(field) },
    }))
    const resetButtons = queryAll<HTMLButtonElement>(m.container, '.lc-settings-reset')
    assert.equal(resetButtons.length, 2, 'only the two changed rows carry a reset')
    // The button sits in the row it undoes: placement leads the card, toolSort is the fifth select.
    assert.ok(resetButtons[0].closest('.lc-settings-row')?.querySelector('.lc-settings-row-title')?.textContent?.includes(DICT_EN['settings.placement']))
    assert.ok(resetButtons[1].closest('.lc-settings-row')?.querySelector('.lc-settings-row-title')?.textContent?.includes(DICT_EN['settings.toolSort']))
    assert.equal(resetButtons[0].textContent, DICT_EN['settings.reset'])

    await click(resetButtons[0])
    assert.deepEqual(resets, ['defaultPlacement'], 'a reset names its own field, never a blanket write')
    assert.deepEqual(calls, [], 'reset does not double-write through set')
    await m.unmount()

    // Back at every default: no button is left anywhere.
    const clean = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf()), reset: (field) => { resets.push(field) } }))
    assert.equal(queryAll(clean.container, '.lc-settings-reset').length, 0)
    await clean.unmount()
  })

  test('a changed text row offers a reset too', async () => {
    const resets: string[] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ promptPrefix: 'Be terse.' })),
      reset: (field) => { resets.push(field) },
    }))
    const buttons = queryAll<HTMLButtonElement>(m.container, '.lc-settings-reset')
    assert.equal(buttons.length, 1)
    await click(buttons[0])
    assert.deepEqual(resets, ['promptPrefix'])
    await m.unmount()
  })

  test('a reset button on a read-only card is disabled', async () => {
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ writable: false, placement: 'sidebar' })),
      reset: () => { throw new Error('a disabled reset must not fire') },
    }))
    assert.ok(queryAll<HTMLButtonElement>(m.container, '.lc-settings-reset').every(b => b.disabled))
    await m.unmount()
  })

  test('a missing reset never throws: the button is inert', async () => {
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ placement: 'sidebar' })),
    }))
    await click(query<HTMLButtonElement>(m.container, '.lc-settings-reset'))
    await m.unmount()
  })

  test('the blanket reset is disabled while every row holds its default and enabled once any one differs', async () => {
    const fresh = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf()), resetAll: () => {} }))
    const idle = query<HTMLButtonElement>(fresh.container, '.lc-settings-reset-all')
    assert.equal(idle.textContent, DICT_EN['settings.resetAll'])
    assert.ok(idle.disabled, 'a fresh install has nothing to reset')
    await fresh.unmount()

    // Each field in turn must light the button: the dirty test walks one table, and a field missing
    // from it would leave the control dead exactly when the user wants it.
    for (const [key, value] of CHANGED_BY_STATE_KEY) {
      const m = await mount(h(PluginConfigCard, {
        useContextSettings: hookFor(stateOf({ [key]: value })),
        resetAll: () => {},
      }))
      assert.ok(!query<HTMLButtonElement>(m.container, '.lc-settings-reset-all').disabled, `a changed ${key} lights the blanket reset`)
      await m.unmount()
    }

    // The table and DEFAULT_SETTINGS must not drift: a new preference has to appear in both.
    assert.equal(CHANGED_BY_STATE_KEY.length, Object.keys(DEFAULT_SETTINGS).length)
  })

  test('the blanket reset fires resetAll once and is inert without the prop', async () => {
    const calls: number[] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ placement: 'sidebar', toolSort: 'name' })),
      resetAll: () => { calls.push(1) },
    }))
    const button = query<HTMLButtonElement>(m.container, '.lc-settings-reset-all')
    await click(button)
    assert.deepEqual(calls, [1], 'one blanket reset, not eleven row resets')
    await m.unmount()

    // No prop: the control still renders (it is the card's only page-level action) but does nothing.
    const bare = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf({ placement: 'sidebar' })) }))
    await click(query<HTMLButtonElement>(bare.container, '.lc-settings-reset-all'))
    await bare.unmount()
  })

  test('the blanket reset is disabled on a read-only card even when rows differ', async () => {
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ writable: false, placement: 'sidebar' })),
      resetAll: () => { throw new Error('a disabled blanket reset must not fire') },
    }))
    assert.ok(query<HTMLButtonElement>(m.container, '.lc-settings-reset-all').disabled)
    await m.unmount()
  })

  test('Menu onClose (Escape) closes an open select without picking', async () => {
    const calls: [string, string][] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf()),
      set: (field, value) => { calls.push([field, value]) },
    }))
    const select = query(m.container, '.lc-settings-select')
    await click(select)
    assert.equal(select.getAttribute('aria-expanded'), 'true')
    assert.equal(menuItems().length, 3, 'the placement row leads with three options')
    await keydown('Escape', document.body)
    assert.equal(select.getAttribute('aria-expanded'), 'false')
    assert.equal(document.body.querySelector('[role="menu"]'), null)
    assert.deepEqual(calls, [])
    await m.unmount()
  })

  test('ready+readonly: disabled controls and the read-only note', async () => {
    const m = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf({ writable: false })) }))
    const note = query(m.container, '.lc-settings-note')
    assert.equal(note.getAttribute('role'), 'status')
    assert.equal(text(note), DICT_EN['settings.readOnly'])
    assert.ok(queryAll<HTMLButtonElement>(m.container, '.lc-settings-select').every(s => s.disabled))
    assert.ok(switches(m.container).every(t => t.disabled))
    assert.ok(queryAll<HTMLTextAreaElement>(m.container, '.lc-settings-textarea').every(t => t.disabled))
    await m.unmount()
  })

  test('prompt text rows: typing stays local, the blur commits, an unmount without a blur commits too', async () => {
    const calls: [string, string][] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf()),
      set: (field, value) => { calls.push([field, value]) },
    }))
    const textareas = queryAll<HTMLTextAreaElement>(m.container, '.lc-settings-textarea')
    assert.ok(textareas.every(t => !t.disabled))
    assert.equal(textareas[0].placeholder, DICT_EN['settings.promptPlaceholder'])

    await focus(textareas[0])
    await typeText(textareas[0], 'Be terse.')
    assert.equal(textareas[0].value, 'Be terse.')
    assert.deepEqual(calls, [], 'typing does not write the wire')

    await blur(textareas[0])
    assert.deepEqual(calls, [['promptPrefix', 'Be terse.']], 'the blur commits the draft')

    await blur(textareas[1])
    assert.deepEqual(calls, [['promptPrefix', 'Be terse.']], 'blurring an untouched row commits nothing')

    await focus(textareas[1])
    await typeText(textareas[1], 'Sign as Atlas.')
    await m.unmount()
    assert.deepEqual(calls, [['promptPrefix', 'Be terse.'], ['promptSuffix', 'Sign as Atlas.']], 'the unmount commits a pending draft')
  })

  test('prompt text rows: a committed draft is not re-committed; an idle row follows the served value; a focused row is never clobbered', async () => {
    const calls: [string, string][] = []
    const m = await mount(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ promptPrefix: 'served' })),
      set: (field, value) => { calls.push([field, value]) },
    }))
    const prefix = query<HTMLTextAreaElement>(m.container, '.lc-settings-textarea')
    assert.equal(prefix.value, 'served')

    await focus(prefix)
    await typeText(prefix, 'served!')
    // A host push lands while the row is being edited.
    await m.update(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ promptPrefix: 'pushed' })),
      set: (field, value) => { calls.push([field, value]) },
    }))
    assert.equal(query<HTMLTextAreaElement>(m.container, '.lc-settings-textarea').value, 'served!', 'the in-progress draft survives the push')
    await blur(query(m.container, '.lc-settings-textarea'))
    assert.deepEqual(calls, [['promptPrefix', 'served!']])

    // Idle again: the next push is followed.
    await m.update(h(PluginConfigCard, {
      useContextSettings: hookFor(stateOf({ promptPrefix: 'pushed' })),
      set: (field, value) => { calls.push([field, value]) },
    }))
    assert.equal(query<HTMLTextAreaElement>(m.container, '.lc-settings-textarea').value, 'pushed')
    await m.unmount()
    assert.deepEqual(calls, [['promptPrefix', 'served!']], 'no re-commit of an already served value')
  })

  test('a value matching no option falls back to the raw id; a missing set never throws', async () => {
    const m = await mount(h(PluginConfigCard, { useContextSettings: hookFor(stateOf({ placement: 'weird' as never })) }))
    const selects = queryAll(m.container, '.lc-settings-select')
    assert.ok(text(selects[0]).includes('weird'))
    // props.set undefined: picking still closes the menu, no throw.
    await click(selects[0])
    await click(menuItems()[1])
    assert.equal(document.body.querySelector('[role="menu"]'), null)
    // Same for a switch: a missing set must not throw either.
    await click(switches(m.container)[0])
    assert.equal(document.body.querySelector('[role="menu"]'), null)
    await m.unmount()
  })
})