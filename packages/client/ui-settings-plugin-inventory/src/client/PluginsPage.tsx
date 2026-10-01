/**
 * The Plugins settings page body: the user-managed plugin cards above, and the
 * collapsed system-plugin region below.
 *
 * The user region lists the deployment's optional, user-facing plugins from
 * the curated catalog; each card switches its Loader entry through the user
 * patch layer. The system region stacks the configuration views contributed to
 * `settings.plugins.system` and then the read-only inventory of everything the
 * user does not own. Nothing here is user-switchable except the user region.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { PluginInventorySnapshot, PluginPatchRow } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutlineRegular,
  IconSearchOutlineMedium,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { catalogRow, isManagedPlugin, PLUGIN_GROUP_KEYS, PLUGIN_GROUP_ORDER } from './catalog.ts'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginsPage.module.css'

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type AgentPresetGroup = NonNullable<PluginInventorySnapshot['agentPresets']>[number]
type AgentPresetRow = AgentPresetGroup['rows'][number]


export type { PluginPatchRow } from '@deepseek-ai/dsh-api-remotes/client'

/** Registration-side Remote face used by the page. */
export interface PluginsPageInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
  /**
   * Display name for one preset: shipped presets resolve through the
   * agent-preset dictionaries, user-authored ones keep their own metadata.
   */
  presetName: (preset: AgentPresetGroup) => string
  /** Read the user-layer cordis.patch.yml disable facts. */
  listPatch: () => Promise<PluginPatchRow[]>
  /**
   * Write one entry's user-layer disable fact; null drops the override row.
   * @param id - the Loader entry id.
   * @param disabled - the next fact (true/false), or null to drop the row.
   * @returns the rows as written.
   */
  writePatch: (id: string, disabled: boolean | null) => Promise<PluginPatchRow[]>
}
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginsPageProps =
  PropsRuntime<'settings.plugins.body'>
  & PropsLocale<'settings.pluginInventory'>
  & PropsRenderSlots<'settings.plugins.system'>
  & InjectFace<PluginsPageInjected>

type Translate = PluginsPageProps['t']

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(phase: PluginFiberPhase, t: Translate): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether one row's module name or entry id matches the catalog query. */
function matches(moduleName: string, entryId: string | null, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [moduleName, ...entryId === null ? [] : [entryId]]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

/** The roster row shown when the preset switcher has no explicit choice. */
function fallbackPreset(presets: readonly AgentPresetGroup[]): AgentPresetGroup | undefined {
  return presets.find(preset => preset.isDefault) ?? presets[0]
}

/** The switcher's display label for one preset. */
function presetLabel(preset: AgentPresetGroup, t: Translate, presetName: (preset: AgentPresetGroup) => string): string {
  const name = presetName(preset)
  if (preset.broken !== undefined) return t('presetOptionBroken', { name })
  if (preset.isDefault) return t('presetOptionDefault', { name })
  return name
}

/**
 * One expandable plugin card; the caller owns the trailing status content.
 */
function PluginCard({
  rowKey, moduleName, entryId, description, version, trailing, confirm, ariaLabel, failed, expanded, onToggle, children,
}: {
  readonly rowKey: string
  readonly moduleName: string
  readonly entryId: string | null
  readonly description: string
  readonly version?: string | undefined
  readonly trailing: ReactNode
  /** Rendered between the header and the details while a destructive action is pending. */
  readonly confirm?: ReactNode | undefined
  readonly ariaLabel: string
  readonly failed: boolean
  readonly expanded: string | null
  readonly onToggle: (key: string) => void
  readonly children: ReactNode
}): ReactNode {
  const open = expanded === rowKey
  const detailId = `plugin-details-${encodeURIComponent(rowKey)}`
  return (
    <li
      className={css.card}
      data-plugin-entry={entryId ?? undefined}
      data-plugin-module={moduleName}
      data-failed={failed ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
    >
      <button
        className={css.cardContent}
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={ariaLabel}
        onClick={() => { onToggle(rowKey) }}
      >
        <span className={css.cardMain}>
          <span className={css.cardTitleLine}>
            <strong className={css.cardTitle} title={moduleName}>{moduleShortName(moduleName)}</strong>
            {version === undefined ? null : <span className={css.cardVersion}>{version}</span>}
          </span>
          <span className={css.cardDesc}>{description}</span>
        </span>
        <span className={css.cardTrailing}>
          {trailing}
          <IconChevronDownOutlineRegular className={css.chevron} size={12} aria-hidden="true" />
        </span>
      </button>
      {confirm}
      {open ? <div className={css.cardDetails} id={detailId}>{children}</div> : null}
    </li>
  )
}

/** Detail rows shared by every card: the Loader identity, then labeled facts. */
function CardFacts({ moduleName, moduleLabel, entryId, facts }: {
  readonly moduleName: string
  readonly moduleLabel: string
  readonly entryId: string | null
  readonly facts: readonly (readonly [label: string, value: ReactNode])[]
}): ReactNode {
  return (
    <>
      {entryId === null ? null : <code className={css.entryValue} data-loader-entry>{entryId}</code>}
      <dl className={css.details}>
        <div>
          <dt>{moduleLabel}</dt>
          <dd>{moduleName}</dd>
        </div>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/** Status dot naming a live root-fiber phase; rows with no live fiber show none. */
function PhaseDot({ phase, t }: { readonly phase: NonNullable<PluginFiberPhase>; readonly t: Translate }): ReactNode {
  const status = phaseLabel(phase, t)
  return (
    <span
      className={css.statusDot}
      data-phase={phase}
      role="img"
      aria-label={status}
      title={status}
    />
  )
}

/** Enablement tag; `kind` selects the palette. */
function StateTag({ kind, label }: { readonly kind: string; readonly label: string }): ReactNode {
  return <span className={css.configTag} data-kind={kind}>{label}</span>
}

/** A pure single-toggle switch in the shell's accent language (no UA chrome). */
function Toggle({ checked, disabled, onToggle, label }: {
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
  readonly label: string
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={css.toggle}
      data-on={checked ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <span className={css.toggleThumb} aria-hidden="true" />
    </button>
  )
}

/** The destructive-action strip one card shows while a disable is pending. */
function ConfirmStrip({ title, t, onConfirm, onCancel }: {
  readonly title: string
  readonly t: Translate
  readonly onConfirm: () => void
  readonly onCancel: () => void
}): ReactNode {
  return (
    <div className={css.confirmStrip}>
      <span className={css.confirmText}>
        <strong>{t('confirmDisableTitle', { name: title })}</strong>
        {` ${t('confirmDisableBody')}`}
      </span>
      <span className={css.confirmActions}>
        <button type="button" className={css.confirmAction} onClick={onConfirm}>
          {t('confirmDisableAction')}
        </button>
        <button type="button" className={css.confirmCancel} onClick={onCancel}>
          {t('cancel')}
        </button>
      </span>
    </div>
  )
}

/** Render the Plugins page: user-managed cards, then the collapsed system region. */
export function PluginsPage({
  list, presetName, listPatch, writePatch, renderSlot, t,
}: PluginsPageProps): ReactNode {
  const sectionId = useId()
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [chosenPreset, setChosenPreset] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState<boolean | null>(null)
  const [globalOpen, setGlobalOpen] = useState<boolean | null>(null)
  // The system region is a disclosure closed by default: the page's working
  // surface is the user cards, and the inventory is a reference. Its body
  // mounts on the first expansion and then stays mounted while hidden, so the
  // configuration views keep their staged drafts across collapse.
  const [systemOpen, setSystemOpen] = useState(false)
  const [systemMounted, setSystemMounted] = useState(false)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  // The user-layer disable facts (plugin page overrides); a read failure
  // leaves the switches on their runtime state and charges the write attempt.
  const [patchRows, setPatchRows] = useState<PluginPatchRow[]>([])
  const [patchFault, setPatchFault] = useState<string | null>(null)
  const [toggleBusy, setToggleBusy] = useState<string | null>(null)
  // Disabling a plugin survives restart and silently removes what it provides,
  // so the off direction asks once; enabling stays one click.
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => list()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    void listPatch().then(
      (rows) => { if (current) setPatchRows(rows) },
      () => { if (current) setPatchFault(t('toggleFailed')) },
    )
    return () => { current = false }
  }, [list, listPatch, request, t])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const searching = normalizedQuery.length > 0
  const snapshot = state.status === 'ready' ? state.snapshot : undefined
  const presets = snapshot?.agentPresets ?? []
  const selected = presets.find(preset => preset.id === chosenPreset) ?? fallbackPreset(presets)

  /** Presets that actually enable a module, keyed by module name. */
  const enabledIn = useMemo(() => {
    const found = new Map<string, [AgentPresetGroup, ...AgentPresetGroup[]]>()
    for (const preset of presets) {
      for (const row of preset.rows) {
        if (row.enabled !== true) continue
        const groups = found.get(row.moduleName)
        if (groups === undefined) found.set(row.moduleName, [preset])
        else if (!groups.includes(preset)) groups.push(preset)
      }
    }
    return found
  }, [presets])

  const entries = snapshot?.entries ?? []
  // The user region owns the catalog's managed modules; the system region owns
  // every other Loader entry.
  const managedEntries = entries.filter(entry => isManagedPlugin(moduleShortName(entry.moduleName)))
  const managedIds = new Set(managedEntries.map(entry => entry.entryId))
  const systemEntries = entries.filter(entry => !managedIds.has(entry.entryId))
  const failedEntries: PluginInventoryEntry[] = []
  const regularEntries: PluginInventoryEntry[] = []
  for (const entry of systemEntries) {
    if (entry.fiberPhase === 'failed') failedEntries.push(entry)
    else regularEntries.push(entry)
  }

  const entryMatch = (entry: PluginInventoryEntry): boolean => matches(entry.moduleName, entry.entryId, normalizedQuery)
  const rowMatch = (row: AgentPresetRow): boolean => matches(row.moduleName, row.entryId, normalizedQuery)
  const filteredFailed = failedEntries.filter(entryMatch)
  const filteredRegular = regularEntries.filter(entryMatch)
  const globalCount = filteredFailed.length + filteredRegular.length
  const selectedRows = selected === undefined ? [] : selected.rows.filter(rowMatch)
  const otherPresetMatches = searching
    ? presets.filter(preset => preset !== selected && preset.rows.some(rowMatch))
    : []
  const otherMatchCount = otherPresetMatches
    .reduce((total, preset) => total + preset.rows.filter(rowMatch).length, 0)

  const presetEffectiveOpen = searching || (presetOpen ?? true)
  // Default open: the toggles the plugin page owns live on the global plane,
  // and a collapsed group hides the one interactive surface this page gained.
  const globalEffectiveOpen = searching || (globalOpen ?? true)
  const nothingMatches = searching && globalCount === 0 && selectedRows.length === 0
    && otherPresetMatches.length === 0

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }
  const toggleRow = (key: string): void => {
    setExpanded(current => current === key ? null : key)
  }

  /** The switch's target state: the user layer wins when it names the row. */
  const switchOn = (entry: PluginInventoryEntry): boolean => {
    const patch = patchRows.find(row => row.id === entry.entryId)
    return patch?.disabled === undefined ? entry.enabled : !patch.disabled
  }

  /** Persist one disable fact; shared by the direct enable and the confirm. */
  const writeDisabled = (entryId: string, busyKey: string, nextDisabled: boolean): void => {
    setToggleBusy(busyKey)
    void writePatch(entryId, nextDisabled)
      .then((rows) => {
        setPatchRows(rows)
        setPatchFault(nextDisabled ? t('toggleStopHint') : t('toggleStartHint'))
      }, () => { setPatchFault(t('toggleFailed')) })
      .finally(() => { setToggleBusy(null) })
  }

  /** One user-managed card: name, catalog description, and its switch. */
  const managedCard = (entry: PluginInventoryEntry): ReactNode => {
    const key = `user:${entry.entryId}`
    const short = moduleShortName(entry.moduleName)
    const catalog = catalogRow(short)
    const title = catalog.nameKey === undefined ? short : t(catalog.nameKey)
    const failed = entry.fiberPhase === 'failed'
    const on = switchOn(entry)
    return (
      <li
        key={key}
        className={css.card}
        data-plugin-entry={entry.entryId}
        data-plugin-module={entry.moduleName}
        data-user-plugin="true"
        data-failed={failed ? 'true' : undefined}
      >
        <div className={css.managedCard}>
          <span className={css.cardMain}>
            <span className={css.cardTitleLine}>
              <strong className={css.cardTitle} title={entry.moduleName}>{title}</strong>
              {entry.version === undefined ? null : <span className={css.cardVersion}>{entry.version}</span>}
            </span>
            <span className={css.cardDesc}>{t(catalog.descriptionKey)}</span>
          </span>
          <span className={css.cardTrailing}>
            {entry.enabled && !failed && entry.fiberPhase !== null
              ? <PhaseDot phase={entry.fiberPhase} t={t} />
              : null}
            <Toggle
              checked={on}
              disabled={toggleBusy !== null}
              label={on ? t('toggleOff', { name: title }) : t('toggleOn', { name: title })}
              onToggle={() => {
                if (on) {
                  setConfirmKey(key)
                  return
                }
                writeDisabled(entry.entryId, key, false)
              }}
            />
          </span>
        </div>
        {confirmKey !== key ? null : (
          <ConfirmStrip
            title={title}
            t={t}
            onConfirm={() => {
              setConfirmKey(null)
              writeDisabled(entry.entryId, key, true)
            }}
            onCancel={() => { setConfirmKey(null) }}
          />
        )}
      </li>
    )
  }

  /** Trailing status and detail facts for one row of the selected preset. */
  const presetRowCard = (preset: AgentPresetGroup, row: AgentPresetRow, index: number): ReactNode => {
    const key = `preset:${preset.id}:${String(index)}`
    const title = moduleShortName(row.moduleName)
    const failed = row.fiberPhase === 'failed'
    const stateText = failed
      ? t('failedTag')
      : row.enabled === true ? t('enabledTag') : row.enabled === false ? t('disabledTag') : t('conditionalTag')
    const kind = failed ? 'failed' : row.enabled === true ? 'enabled' : row.enabled === false ? 'disabled' : 'conditional'
    return (
      <PluginCard
        key={key}
        rowKey={key}
        moduleName={row.moduleName}
        entryId={row.entryId}
        failed={failed}
        description={t(catalogRow(title).descriptionKey)}
        expanded={expanded}
        onToggle={toggleRow}
        ariaLabel={`${title}, ${stateText}`}
        trailing={(
          <>
            {row.enabled === true && !failed && row.fiberPhase !== null
              ? <PhaseDot phase={row.fiberPhase} t={t} />
              : null}
            <StateTag kind={kind} label={stateText} />
          </>
        )}
      >
        <CardFacts
          moduleName={row.moduleName}
          moduleLabel={t('moduleLabel')}
          entryId={row.entryId}
          facts={[
            [t('fromPreset'), presetName(preset)],
            [t('configuration'), stateText],
            ...row.fiberPhase === null ? [] : [[t('runtime'), phaseLabel(row.fiberPhase, t)] as const],
            ...row.condition === undefined ? [] : [[t('condition'), <code key="condition">{row.condition}</code>] as const],
          ]}
        />
      </PluginCard>
    )
  }

  /** One system-plane row; a preset-provided row carries the presets that enable it. */
  const globalRowCard = (
    entry: PluginInventoryEntry,
    providers?: readonly [AgentPresetGroup, ...AgentPresetGroup[]],
  ): ReactNode => {
    const key = `global:${entry.entryId}`
    const title = moduleShortName(entry.moduleName)
    const failed = entry.fiberPhase === 'failed'
    const stateText = failed
      ? t('failedTag')
      : providers !== undefined ? t('presetEnabledTag') : t(entry.enabled ? 'enabledTag' : 'disabledTag')
    const kind = failed ? 'failed' : providers !== undefined ? 'preset' : entry.enabled ? 'enabled' : 'disabled'
    // The switch's target state: the user layer wins when it names the row,
    // otherwise the runtime fact (which is what the next boot restores).
    const on = switchOn(entry)
    const busyKey = `global:${entry.entryId}`
    const catalog = catalogRow(title)
    return (
      <PluginCard
        key={key}
        rowKey={key}
        moduleName={entry.moduleName}
        entryId={entry.entryId}
        failed={failed}
        description={t(catalog.descriptionKey)}
        version={entry.version}
        expanded={expanded}
        onToggle={toggleRow}
        ariaLabel={`${title}, ${stateText}`}
        confirm={confirmKey !== key ? undefined : (
          <ConfirmStrip
            title={title}
            t={t}
            onConfirm={() => {
              setConfirmKey(null)
              writeDisabled(entry.entryId, busyKey, true)
            }}
            onCancel={() => { setConfirmKey(null) }}
          />
        )}
        trailing={(
          <>
            {entry.enabled && !failed && entry.fiberPhase !== null
              ? <PhaseDot phase={entry.fiberPhase} t={t} />
              : null}
            <StateTag kind={kind} label={stateText} />
            {providers === undefined
              ? (
                <Toggle
                  checked={on}
                  disabled={toggleBusy !== null}
                  label={on ? t('toggleOff', { name: title }) : t('toggleOn', { name: title })}
                  onToggle={() => {
                    if (on) {
                      setConfirmKey(key)
                      return
                    }
                    writeDisabled(entry.entryId, busyKey, false)
                  }}
                />
              )
              : null}
          </>
        )}
      >
        <CardFacts
          moduleName={entry.moduleName}
          moduleLabel={t('moduleLabel')}
          entryId={entry.entryId}
          facts={providers !== undefined
            ? [
              [t('configuration'), t('presetProvidedDetail')],
              [t('enabledIn'), (
                <span className={css.enabledIn}>
                  <span>{providers.map(preset => presetName(preset)).join(' · ')}</span>
                  <button
                    type="button"
                    className={css.jumpLink}
                    onClick={() => { setChosenPreset(providers[0].id) }}
                  >
                    {t('viewInPreset')}
                  </button>
                </span>
              )],
            ]
            : [
              [t('configuration'), t(entry.enabled ? 'enabledTag' : 'disabledTag')],
              ...entry.enabled ? [[t('runtime'), phaseLabel(entry.fiberPhase, t)] as const] : [],
            ]}
        />
      </PluginCard>
    )
  }

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
      {state.status === 'error' ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" onClick={retry}>{t('retry')}</button>
        </div>
      ) : null}
      {snapshot !== undefined ? (
        <>
          <section className={css.region} data-plugin-region="user">
            <div className={css.catalogHeading}>
              <h3>{t('userTitle')}</h3>
              <span data-plugin-count={managedEntries.length}>{` · ${String(managedEntries.length)} ${t('countUnit')}`}</span>
            </div>
            <p className={css.regionSub}>{t('userSubtitle')}</p>
            {managedEntries.length === 0
              ? <p className={css.status}>{t('userEmpty')}</p>
              : <ul className={css.cards}>{managedEntries.map(managedCard)}</ul>}
          </section>

          <section className={css.region} data-plugin-region="system">
            <div className={css.systemRow}>
              <button
                type="button"
                className={css.systemToggle}
                aria-expanded={systemOpen}
                aria-controls={`${sectionId}-system`}
                onClick={() => {
                  setSystemOpen((open) => {
                    if (!open) setSystemMounted(true)
                    return !open
                  })
                }}
              >
                <IconChevronDownOutlineRegular className={css.chevron} size={12} aria-hidden="true" />
                <span className={css.groupTitle}>{t('systemTitle')}</span>
                <span className={css.systemCount} data-system-count={systemEntries.length}>
                  {` · ${String(systemEntries.length)} ${t('countUnit')}`}
                </span>
              </button>
            </div>
            <p className={css.regionSub}>{t('systemSubtitle')}</p>
            {systemMounted ? (
              <div className={css.systemBody} id={`${sectionId}-system`} hidden={!systemOpen}>
                {renderSlot('settings.plugins.system', {})}
                <div className={css.catalog}>
                  <label className={css.search}>
                    <IconSearchOutlineMedium aria-hidden="true" />
                    <span className={css.visuallyHidden}>{t('search')}</span>
                    <input
                      type="search"
                      value={query}
                      placeholder={t('search')}
                      aria-label={t('search')}
                      onChange={(event) => { setQuery(event.currentTarget.value) }}
                    />
                  </label>
                  {entries.length === 0 && presets.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
                  {nothingMatches ? <p className={css.status}>{t('emptySearch')}</p> : null}

                  {selected !== undefined ? (
                    <section className={css.group} data-plugin-scope="preset" data-preset-id={selected.id}>
                      <div className={css.groupTitleRow}>
                        <button
                          type="button"
                          className={css.groupToggle}
                          aria-expanded={presetEffectiveOpen}
                          aria-controls={`${sectionId}-preset`}
                          onClick={() => { setPresetOpen(!presetEffectiveOpen) }}
                        >
                          <IconChevronDownOutlineRegular className={css.chevron} size={12} aria-hidden="true" />
                          <span className={css.groupTitle}>{t('presetTitle')}</span>
                        </button>
                        <div className={css.headerEnd}>
                          <Menu
                            open={switcherOpen}
                            onClose={() => { setSwitcherOpen(false) }}
                            items={presets.map(preset => ({ id: preset.id, label: presetLabel(preset, t, presetName) }))}
                            selectedId={selected.id}
                            onSelect={(id) => {
                              setSwitcherOpen(false)
                              setChosenPreset(id)
                            }}
                            align="end"
                            portal
                            anchor={(
                              <button
                                type="button"
                                className={css.switcher}
                                aria-haspopup="menu"
                                aria-expanded={switcherOpen}
                                aria-label={t('switcherLabel')}
                                onClick={() => { setSwitcherOpen(value => !value) }}
                              >
                                <span className={css.switcherLabel}>{presetLabel(selected, t, presetName)}</span>
                                <IconChevronDownOutlineRegular className={css.chevron} aria-hidden="true" />
                              </button>
                            )}
                          />
                        </div>
                      </div>
                      <p className={css.groupSub}>
                        {t('presetSubtitle')}
                        <span data-preset-plugin-count={selectedRows.length}>
                          {` · ${String(selectedRows.length)} ${t('countUnit')}`}
                        </span>
                      </p>
                      {presetEffectiveOpen ? (
                        <div id={`${sectionId}-preset`} className={css.groupBody}>
                          {selected.broken !== undefined ? (
                            <p className={css.brokenNote} role="alert">{selected.broken}</p>
                          ) : null}
                          {selectedRows.length > 0 ? (
                            <ul className={css.cards}>
                              {selectedRows.map((row, index) => presetRowCard(selected, row, index))}
                            </ul>
                          ) : null}
                          {otherMatchCount > 0 ? (
                            <p className={css.hint}>
                              {t('matchesInOtherPresets', { count: String(otherMatchCount) })}
                              {otherPresetMatches.map(preset => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  className={css.jumpLink}
                                  onClick={() => { setChosenPreset(preset.id) }}
                                >
                                  {presetName(preset)}
                                </button>
                              ))}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {entries.length > 0 ? (
                    <section className={css.group} data-plugin-scope="global">
                      <div className={css.groupTitleRow}>
                        <button
                          type="button"
                          className={css.groupToggle}
                          aria-expanded={globalEffectiveOpen}
                          aria-controls={`${sectionId}-global`}
                          onClick={() => { setGlobalOpen(!globalEffectiveOpen) }}
                        >
                          <IconChevronDownOutlineRegular className={css.chevron} size={12} aria-hidden="true" />
                          <span className={css.groupTitle}>{t('globalTitle')}</span>
                        </button>
                      </div>
                      <p className={css.groupSub}>
                        {t('globalSubtitle')}
                        <span data-plugin-count={globalCount}>{` · ${String(globalCount)} ${t('countUnit')}`}</span>
                        {filteredFailed.length > 0 ? (
                          <span className={css.failedCount}>{filteredFailed.length} {t('failedCountLabel')}</span>
                        ) : null}
                      </p>
                      {globalEffectiveOpen ? (
                        <div id={`${sectionId}-global`} className={css.groupBody}>
                          {PLUGIN_GROUP_ORDER.map((kind) => {
                            const groupFailed = filteredFailed.filter(entry => catalogRow(moduleShortName(entry.moduleName)).group === kind)
                            const groupRegular = filteredRegular
                              .filter(entry => catalogRow(moduleShortName(entry.moduleName)).group === kind)
                              .map(entry => ({ entry, providers: entry.enabled ? undefined : enabledIn.get(entry.moduleName) }))
                            const groupCount = groupFailed.length + groupRegular.length
                            if (groupCount === 0) return null
                            return (
                              <section key={kind} className={css.subgroup} data-plugin-group={kind}>
                                <h4 className={css.subgroupTitle}>
                                  {t(PLUGIN_GROUP_KEYS[kind])}
                                  <span>{` · ${String(groupCount)}`}</span>
                                </h4>
                                {/* Failures float above the group's healthy rows so a
                                    broken plugin cannot hide inside a long group. */}
                                <ul className={css.cards}>
                                  {groupFailed.map(entry => globalRowCard(entry))}
                                  {groupRegular.map(({ entry, providers }) => globalRowCard(entry, providers))}
                                </ul>
                              </section>
                            )
                          })}
                        </div>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {patchFault !== null ? (
        <p className={css.restartHint} role="status">{patchFault}</p>
      ) : null}
    </div>
  )
}
