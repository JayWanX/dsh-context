/** The dsh-context preference card, keyed on the Host-served `dsh-context` namespace: while that namespace is
 *  unavailable (a deployment without the Host half, or a remote browser) the card renders nothing.
 *
 *  The row family mirrors dsh-streamfold's plugin card: a two-line text column (title + 12px description) beside a
 *  fixed 132px control column, groups as settings-card panels, and the three on/off gates as Switches rather than
 *  two-option menus. */

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Menu, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDown } from '../primitives'
import { DEFAULT_SETTINGS } from '../settings'
import type { SettingsField, SettingsState } from '../settings'
import type { ViewKit } from '../viewkit'

interface SettingsCardProps {
  useContextSettings?: <T>(selector: (state: SettingsState) => T) => T
  set?: (field: SettingsField, value: string) => void
  reset?: (field: SettingsField) => void
  resetAll?: () => void
}

type Translate = ViewKit['t']

interface PrefRowProps {
  title: string
  desc: string
  /** Rendered in the text column under the description, so the reset rides the label it undoes. */
  trailing?: ReactNode
  children: ReactNode
}

/** One preference row: the text column folds the title over its description; the control rides a fixed-width
 *  column (`--lc-settings-control-width`, 132px — the same value dsh-streamfold uses). */
function PrefRow(props: PrefRowProps): ReactElement {
  return (
    <div className="lc-settings-row">
      <div className="lc-settings-row-main">
        <div className="lc-settings-row-title">{props.title}</div>
        <div className="lc-settings-row-desc">{props.desc}</div>
        {props.trailing ?? null}
      </div>
      <div className="lc-settings-row-control">{props.children}</div>
    </div>
  )
}

/** One field's "back to default" affordance: a quiet text button that appears ONLY while the row differs from
 *  its shipped default, so the card never shows eleven buttons and the eye is drawn to the changed rows. */
function ResetButton(props: { t: Translate; disabled: boolean; onReset: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="lc-settings-reset"
      disabled={props.disabled}
      title={props.t('settings.resetHint')}
      onClick={props.onReset}
    >
      {props.t('settings.reset')}
    </button>
  )
}

interface SelectRowProps {
  title: string
  desc: string
  value: string
  options: ReadonlyArray<{ id: string; label: string }>
  disabled: boolean
  onPick: (id: string) => void
  /** The per-row reset button, or undefined while the row already holds its default. */
  reset?: ReactNode
}

/** One dropdown preference row: the harness {@link Menu} (its own portal + keyboard walk) behind a
 *  fill-family trigger button, matching dsh-streamfold's selector. */
function SelectRow(props: SelectRowProps): ReactElement {
  const [open, setOpen] = useState(false)
  const active = props.options.find(o => o.id === props.value)?.label ?? props.value
  return (
    <PrefRow
      title={props.title}
      desc={props.desc}
      trailing={props.reset}
    >
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={props.options}
        selectedId={props.value}
        onSelect={(id) => { setOpen(false); props.onPick(id) }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className="lc-settings-select"
            disabled={props.disabled}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(v => !v) }}
          >
            <span className="lc-settings-select-label">{active}</span>
            <IconChevronDown size={14} className="lc-settings-select-chevron" />
          </button>
        )}
      />
    </PrefRow>
  )
}

/** One on/off gate: a {@link PrefRow} whose control column carries the harness Switch (its own 36×20 recipe). */
function ToggleRow(props: { title: string; desc: string; on: boolean; disabled: boolean; onPick: (show: boolean) => void; reset?: ReactNode }): ReactElement {
  return (
    <PrefRow title={props.title} desc={props.desc} trailing={props.reset}>
      <Switch
        checked={props.on}
        disabled={props.disabled}
        label={props.title}
        onChange={props.onPick}
      />
    </PrefRow>
  )
}

interface PromptTextRowProps {
  label: string
  placeholder: string
  desc: string
  value: string
  disabled: boolean
  reset?: ReactNode
  onCommit: (text: string) => void
}

/** One free-text preference row: the control column folds under the text column (a 132px-wide textarea is
 *  unreadable), and a local draft commits on blur (and on an unmount without a prior blur), so typing never
 *  writes the wire per keystroke. */
function PromptTextRow(props: PromptTextRowProps): ReactElement {
  const [draft, setDraft] = useState(props.value)
  const [focused, setFocused] = useState(false)
  const latest = useRef({ draft: props.value, value: props.value, commit: props.onCommit })
  latest.current = { draft, value: props.value, commit: props.onCommit }
  // Follow the served value only while the row is idle: a host push (or the
  // optimistic echo) must never clobber in-progress typing.
  if (!focused && draft !== props.value) setDraft(props.value)
  useEffect(() => () => {
    const { draft: text, value, commit } = latest.current
    if (text !== value) commit(text)
  }, [])
  const rows = Math.min(8, Math.max(2, draft.split('\n').length))
  return (
    <div className="lc-settings-row lc-settings-textrow">
      <div className="lc-settings-row-main">
        <div className="lc-settings-row-title">{props.label}</div>
        <div className="lc-settings-row-desc">{props.desc}</div>
        {props.reset ?? null}
      </div>
      <div className="lc-settings-row-control lc-settings-textrow-control">
        <textarea
          className="lc-settings-textarea"
          rows={rows}
          placeholder={props.placeholder}
          disabled={props.disabled}
          value={draft}
          onFocus={() => { setFocused(true) }}
          onBlur={() => {
            setFocused(false)
            if (draft !== props.value) props.onCommit(draft)
          }}
          onChange={(event) => { setDraft(event.target.value) }}
        />
      </div>
    </div>
  )
}

/** One titled preference group: the harness projects no group chrome into the
 *  `plugins.bundle.config` slot, so the card draws its own — a settings-card panel whose head
 *  is a small letter-spaced caption over the rows. */
function Group(props: { title: string; note?: string; children: ReactNode }): ReactElement {
  return (
    <div className="lc-settings-group" role="group" aria-label={props.title}>
      <div className="lc-settings-group-title">{props.title}</div>
      {props.note === undefined ? null : <p className="lc-settings-group-note">{props.note}</p>}
      {props.children}
    </div>
  )
}

/** Each preference field beside the reader that pulls it out of the store: the one declaration the blanket
 *  reset's "is anything changed?" test walks, so a new preference cannot join the card and be forgotten
 *  there. Every entry is checked against {@link DEFAULT_SETTINGS} under the field's own scope name. */
const PreferenceValues: readonly (readonly [SettingsField, (state: SettingsState) => string])[] = [
  ['defaultPlacement', s => s.placement],
  ['insightsEntry', s => s.insightsEntry],
  ['fleetTab', s => s.fleetTab],
  ['defaultGranularity', s => s.granularity],
  ['defaultTrendMode', s => s.mode],
  ['defaultDurationCurve', s => s.durationCurve],
  ['defaultDeltaBase', s => s.deltaBase],
  ['defaultToolSort', s => s.toolSort],
  ['defaultFileSort', s => s.fileSort],
  ['promptPrefix', s => s.promptPrefix],
  ['promptSuffix', s => s.promptSuffix],
]

function PreferenceRows(props: { t: Translate; state: SettingsState; set?: SettingsCardProps['set']; reset?: SettingsCardProps['reset'] }): ReactElement {
  const { t, state, set, reset } = props
  const disabled = state.status !== 'ready' || !state.writable
  const showHide = (field: SettingsField, value: 'show' | 'hide'): void => { set?.(field, value) }
  /** The per-row reset button, or undefined while the row already holds its shipped default. */
  const resetFor = (field: SettingsField, current: string): ReactNode =>
    current === String(DEFAULT_SETTINGS[field]) ? undefined : (
      <ResetButton t={t} disabled={disabled} onReset={() => { reset?.(field) }} />
    )
  return (
    <>
      <Group title={t('settings.group.entry')}>
        <SelectRow
          title={t('settings.placement')}
          desc={t('settings.placementDesc')}
          value={state.placement}
          disabled={disabled}
          options={[
            { id: 'all', label: t('placement.all') },
            { id: 'tab', label: t('placement.tab') },
            { id: 'sidebar', label: t('placement.sidebar') },
          ]}
          onPick={(id) => { set?.('defaultPlacement', id) }}
          reset={resetFor('defaultPlacement', state.placement)}
        />
        <ToggleRow
          title={t('settings.insightsEntry')}
          desc={t('settings.insightsEntryDesc')}
          on={state.insightsEntry === 'show'}
          disabled={disabled}
          onPick={(show) => { showHide('insightsEntry', show ? 'show' : 'hide') }}
          reset={resetFor('insightsEntry', state.insightsEntry)}
        />
        <ToggleRow
          title={t('settings.fleetTab')}
          desc={t('settings.fleetTabDesc')}
          on={state.fleetTab === 'show'}
          disabled={disabled}
          onPick={(show) => { showHide('fleetTab', show ? 'show' : 'hide') }}
          reset={resetFor('fleetTab', state.fleetTab)}
        />
      </Group>
      <Group title={t('settings.group.view')}>
        <SelectRow
          title={t('settings.gran')}
          desc={t('settings.granDesc')}
          value={state.granularity}
          disabled={disabled}
          options={[
            { id: 'step', label: t('gran.step') },
            { id: 'turn', label: t('gran.turn') },
          ]}
          onPick={(id) => { set?.('defaultGranularity', id) }}
          reset={resetFor('defaultGranularity', state.granularity)}
        />
        <SelectRow
          title={t('settings.mode')}
          desc={t('settings.modeDesc')}
          value={state.mode}
          disabled={disabled}
          options={[
            { id: 'total', label: t('gran.total') },
            { id: 'delta', label: t('gran.delta') },
          ]}
          onPick={(id) => { set?.('defaultTrendMode', id) }}
          reset={resetFor('defaultTrendMode', state.mode)}
        />
        <ToggleRow
          title={t('settings.durationCurve')}
          desc={t('settings.durationCurveDesc')}
          on={state.durationCurve === 'show'}
          disabled={disabled}
          onPick={(show) => { showHide('defaultDurationCurve', show ? 'show' : 'hide') }}
          reset={resetFor('defaultDurationCurve', state.durationCurve)}
        />
        <SelectRow
          title={t('settings.deltaBase')}
          desc={t('settings.deltaBaseDesc')}
          value={state.deltaBase}
          disabled={disabled}
          options={[
            { id: 'step', label: t('browser.base.step') },
            { id: 'turn', label: t('browser.base.turn') },
          ]}
          onPick={(id) => { set?.('defaultDeltaBase', id) }}
          reset={resetFor('defaultDeltaBase', state.deltaBase)}
        />
        <SelectRow
          title={t('settings.toolSort')}
          desc={t('settings.toolSortDesc')}
          value={state.toolSort}
          disabled={disabled}
          options={[
            { id: 'size', label: t('tool.sort.size') },
            { id: 'count', label: t('tool.sort.count') },
            { id: 'name', label: t('tool.sort.name') },
          ]}
          onPick={(id) => { set?.('defaultToolSort', id) }}
          reset={resetFor('defaultToolSort', state.toolSort)}
        />
        <SelectRow
          title={t('settings.fileSort')}
          desc={t('settings.fileSortDesc')}
          value={state.fileSort}
          disabled={disabled}
          options={[
            { id: 'count', label: t('files.sort.count') },
            { id: 'latest', label: t('files.sort.latest') },
            { id: 'path', label: t('files.sort.path') },
          ]}
          onPick={(id) => { set?.('defaultFileSort', id) }}
          reset={resetFor('defaultFileSort', state.fileSort)}
        />
      </Group>
      <Group title={t('settings.group.prompt')} note={t('settings.promptHint')}>
        <PromptTextRow
          label={t('settings.promptPrefix')}
          desc={t('settings.promptPrefixDesc')}
          placeholder={t('settings.promptPlaceholder')}
          value={state.promptPrefix}
          disabled={disabled}
          reset={resetFor('promptPrefix', state.promptPrefix)}
          onCommit={(text) => { set?.('promptPrefix', text) }}
        />
        <PromptTextRow
          label={t('settings.promptSuffix')}
          desc={t('settings.promptSuffixDesc')}
          placeholder={t('settings.promptPlaceholder')}
          value={state.promptSuffix}
          disabled={disabled}
          reset={resetFor('promptSuffix', state.promptSuffix)}
          onCommit={(text) => { set?.('promptSuffix', text) }}
        />
      </Group>
    </>
  )
}

/** The Plugins page owns the bundle's page and section chrome, so the rows render flat; unserved or absent degrades to nothing. */
export function makePluginConfigCard(kit: ViewKit): (props: SettingsCardProps) => ReactElement | null {
  const { t } = kit
  return function PluginConfigCard(props: SettingsCardProps): ReactElement | null {
    const state = typeof props.useContextSettings === 'function' ? props.useContextSettings(s => s) : undefined
    if (state === undefined || state.status === 'unavailable') return null
    const disabled = state.status !== 'ready' || !state.writable
    // The blanket reset is pointless — and would read as a dead control — while every row already holds
    // its default, which is exactly the state a fresh install sits in.
    const dirty = PreferenceValues.some(([field, read]) => read(state) !== String(DEFAULT_SETTINGS[field]))
    return (
      <div className="lc-settings-prefs">
        {!state.writable && state.status === 'ready'
          ? <p className="lc-settings-note" role="status">{t('settings.readOnly')}</p>
          : null}
        <PreferenceRows t={t} state={state} set={props.set} reset={props.reset} />
        <div className="lc-settings-actions">
          <button
            type="button"
            className="lc-settings-reset-all"
            disabled={disabled || !dirty}
            title={t('settings.resetAllHint')}
            onClick={() => { props.resetAll?.() }}
          >
            {t('settings.resetAll')}
          </button>
        </div>
      </div>
    )
  }
}