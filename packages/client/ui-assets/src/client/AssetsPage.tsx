/**
 * The asset-hub primary page: one `settings.section` row over the
 * `assetOverview` Remote namespace. Four tabs — the asset grid/list, the
 * reports with the thesis strip, the mode flows, and the lineage graph — plus
 * one face detail view opened from a card, a row, or a lineage node.
 *
 * The assets tab reads the v2 `assetLibrary()` snapshot; reports and flows keep
 * reading `overview()`. The host owns every read and every verb run; this
 * component renders what the Remote answered.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  AssetFaceResult, AssetLibrary, AssetLibraryAsset, AssetOverview,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssetsLocaleKey } from './locales.ts'
import type { RunVerbFace } from './face/FaceRenderer.tsx'
import { AssetDetail } from './assets/AssetDetail.tsx'
import { AssetsView, type AssetView } from './assets/AssetsView.tsx'
import { LineageGraph } from './assets/LineageGraph.tsx'
import {
  filterAssets, NO_FILTER, sortAssets, type LibraryFilter, type LibrarySort,
} from './assets/library.ts'
import { FlowsTab, type SaveFlowRequest } from './flows/FlowsTab.tsx'
import { ReportsTab } from './reports/ReportsTab.tsx'
import css from './AssetsPage.module.css'

/** The tab ids in bar order. */
type TabId = 'assets' | 'reports' | 'flows' | 'graph'

/**
 * The tab bar in order: one stable tab id and the dictionary key naming that
 * tab. The id is what selection matches and what keys the row; the label text
 * itself lives only in the `ui.assets` dictionaries.
 */
const TAB_BAR: readonly (readonly [TabId, AssetsLocaleKey])[] = [
  ['assets', 'tabAssets'],
  ['reports', 'tabReports'],
  ['flows', 'tabFlows'],
  ['graph', 'tabGraph'],
]

/** Full page props: the owner share, the locale seat, and the injected Remote adapters. */
export type AssetsPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.assets'>
  & {
    /** Read the whole v2 library snapshot (`assetLibrary`). */
    readonly loadLibrary: () => Promise<AssetLibrary>
    /** Read the overview snapshot the reports and flows tabs render. */
    readonly loadOverview: () => Promise<AssetOverview>
    /** Read one version's face, manifest, and directory. */
    readonly loadFace: (asset: string, version?: number) => Promise<AssetFaceResult>
    /** Run one verb through the bridge; the returned status is the only verdict. */
    readonly runVerb: RunVerbFace
    /** Read one version-directory text file for an `embed` block. */
    readonly loadFile: (asset: string, version: number, path: string) => Promise<string>
    /** Hand one asset to a fresh AI session seeded by `assetBrief`. */
    readonly askAi: (asset: string) => Promise<void>
    /** Store one user mode through the owner's authoring Remote; failure text, or undefined. */
    readonly saveFlow: (request: SaveFlowRequest) => Promise<string | undefined>
  }

/** The page's one load state: both snapshots, each absent when its read failed. */
type HubState =
  | { readonly status: 'loading' }
  | {
    readonly status: 'ready'
    readonly library: AssetLibrary | null
    readonly overview: AssetOverview | null
  }

/** The retry row one failed section shows. */
function RetryLine({ onRetry, t }: { readonly onRetry: () => void; readonly t: AssetsPageProps['t'] }): ReactNode {
  return (
    <div className={css.failure}>
      <span role="alert">{t('error')}</span>
      <button type="button" onClick={onRetry}>{t('retry')}</button>
    </div>
  )
}

/** Render the asset-hub page. */
export function AssetsPage(props: AssetsPageProps): ReactNode {
  const { loadLibrary, loadOverview, loadFace, runVerb, loadFile, askAi, saveFlow, close, t } = props
  const [tab, setTab] = useState<TabId>('assets')
  const [request, setRequest] = useState(0)
  const [view, setView] = useState<AssetView>('grid')
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER)
  const [sort, setSort] = useState<LibrarySort>('name')
  const [descending, setDescending] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  /** The verb a card's primary action asked the detail view to spotlight. */
  const [focusVerb, setFocusVerb] = useState<string | undefined>(undefined)
  const [state, setState] = useState<HubState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    const settle = <T,>(read: () => Promise<T>): Promise<T | null> => read().then(
      value => value,
      () => null,
    )
    void Promise.all([settle(loadLibrary), settle(loadOverview)]).then(
      ([library, overview]) => { if (live) setState({ status: 'ready', library, overview }) },
    )
    return () => { live = false }
  }, [loadLibrary, loadOverview, request])

  const library = state.status === 'ready' ? state.library : null
  const overview = state.status === 'ready' ? state.overview : null
  const all: readonly AssetLibraryAsset[] = library?.assets ?? []
  const visible = useMemo(
    () => sortAssets(filterAssets(all, filter), sort, descending),
    [all, filter, sort, descending],
  )
  const focused = selected === undefined ? undefined : all.find(asset => asset.name === selected)

  const openAsset = (name: string): void => { setSelected(name); setFocusVerb(undefined) }
  const openAction = (name: string, verb: string): void => { setSelected(name); setFocusVerb(verb) }
  // Opening a session is the page's own leave route: the shell returns to the
  // conversation whenever the current session changes, and the explicit close
  // keeps that true if the section is ever hosted without that rule.
  const handOff = (name: string): Promise<void> => askAi(name).then(() => { close() })

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.blurb}>{t('blurb')}</p>
      <div className={css.tabs} role="tablist">
        {TAB_BAR.map(([id, key]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={css.tab}
            onClick={() => { setTab(id) }}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}

      {state.status === 'ready'
        ? (
          <>
            {library !== null && library.problems.length > 0
              ? (
                <p className={css.problems} role="status">
                  {`${t('problemsTitle')} ${library.problems.join('；')}`}
                </p>
              )
              : null}

            {tab === 'assets'
              ? library === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : focused === undefined
                  ? all.length === 0
                    ? <p className={css.status}>{t('emptyAssets')}</p>
                    : (
                      <AssetsView
                        assets={visible}
                        all={all}
                        filter={filter}
                        onFilter={setFilter}
                        view={view}
                        onView={setView}
                        sort={sort}
                        descending={descending}
                        onSort={(by, nextDescending) => { setSort(by); setDescending(nextDescending) }}
                        onSelect={openAsset}
                        onAction={openAction}
                        t={t}
                      />
                    )
                  : (
                    <AssetDetail
                      asset={focused}
                      loadFace={loadFace}
                      runVerb={runVerb}
                      loadFile={path => loadFile(focused.name, focused.latest_version, path)}
                      askAi={handOff}
                      onBack={() => { setSelected(undefined) }}
                      onNavigate={openAsset}
                      focusVerb={focusVerb}
                      onFocusConsumed={() => { setFocusVerb(undefined) }}
                      t={t}
                    />
                  )
              : null}

            {tab === 'reports'
              ? overview === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : <ReportsTab overview={overview} t={t} />
              : null}

            {tab === 'flows'
              ? overview === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : <FlowsTab overview={overview} saveFlow={saveFlow} onCreated={() => { setRequest(value => value + 1) }} t={t} />
              : null}

            {tab === 'graph'
              ? library === null
                ? <RetryLine onRetry={() => { setRequest(value => value + 1) }} t={t} />
                : (
                  <LineageGraph
                    assets={all}
                    onSelect={(name) => { setSelected(name); setTab('assets') }}
                    t={t}
                  />
                )
              : null}
          </>
        )
        : null}
    </div>
  )
}
