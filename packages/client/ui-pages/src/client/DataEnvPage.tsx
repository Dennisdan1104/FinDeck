/**
 * The environment & components page: the component download grid over the
 * `componentCatalog` Remote. The Host runs one install task at a time and owns
 * every fact, so this page renders the catalog, the task's progress, and each
 * component's outcome, and drives install and cancel through the injected
 * actions.
 */

import { type ReactNode } from 'react'
import type {
  ComponentInfo,
  ComponentProgress,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ComponentCatalogActions,
  ComponentCatalogState,
  ComponentCatalogStore,
} from './componentCatalog.ts'
import type { PagesLocaleKey } from './locales.ts'
import css from './PlaceholderPage.module.css'
import catalogCss from './ComponentCatalog.module.css'

/** Dictionary key of each progress stage the Host reports. */
const STAGE_KEYS: Record<ComponentProgress['stage'], PagesLocaleKey> = {
  download: 'components.stageDownload',
  install: 'components.stageInstall',
  verify: 'components.stageVerify',
}

/** Injected dependencies of {@link DataEnvPage} (slot `inject`). */
export interface DataEnvPageInjected {
  /** Reads, installs, and cancellations over the `componentCatalog` Remote. */
  readonly components: ComponentCatalogActions
  hooks: {
    /** Component catalog snapshot bound by the UI renderer as `useCatalog`. */
    catalog: ComponentCatalogStore
  }
}

/** Composed page props: the runtime and locale shares plus the inject face. */
export type DataEnvPageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.pages'>
  & InjectFace<DataEnvPageInjected>

/** One fact row of a component's metadata. */
function Fact({ label, value, code = false }: {
  readonly label: string
  readonly value: string
  readonly code?: boolean
}): ReactNode {
  return (
    <>
      <dt className={catalogCss.factLabel}>{label}</dt>
      <dd className={code ? `${catalogCss.factValue} ${catalogCss.factCode}` : catalogCss.factValue}>{value}</dd>
    </>
  )
}

/**
 * A byte count in the decimal units the Hosts report, at most two fraction
 * digits, so an estimated size and a live byte counter read the same way.
 * @param bytes - the reported byte count.
 * @param t - the page's translate seat, which owns the unit text.
 * @returns the localized size, unit included.
 */
function sizeText(bytes: number, t: DataEnvPageProps['t']): string {
  if (bytes < 1000) return t('components.sizeB', { size: String(Math.round(bytes)) })
  if (bytes < 1_000_000) return t('components.sizeKb', { size: (bytes / 1000).toFixed(1) })
  if (bytes < 1_000_000_000) return t('components.sizeMb', { size: (bytes / 1_000_000).toFixed(1) })
  return t('components.sizeGb', { size: (bytes / 1_000_000_000).toFixed(2) })
}

/**
 * The running task's stage, byte counts, and percentage.
 * @param task - the install task the follow stream last reported.
 * @param t - the page's translate seat.
 * @returns the localized progress line.
 */
function progressText(task: ComponentProgress, t: DataEnvPageProps['t']): string {
  const completed = task.completedBytes ?? 0
  const total = task.totalBytes
  if (total === undefined || total === 0) {
    return t('components.progressUnknown', { completed: sizeText(completed, t) })
  }
  return t('components.progress', {
    completed: sizeText(completed, t),
    total: sizeText(total, t),
    percent: String(Math.floor(completed / total * 100)),
  })
}

/** The install task's progress line; the bar stays indeterminate with no total. */
function ProgressLine({ task, t }: {
  readonly task: ComponentProgress
  readonly t: DataEnvPageProps['t']
}): ReactNode {
  const label = t('components.downloadProgress')
  const total = task.totalBytes
  const done = total === undefined || total === 0
  return (
    <div className={catalogCss.progress}>
      <span className={catalogCss.progressText} role="status">
        {`${t(STAGE_KEYS[task.stage])} · ${progressText(task, t)}`}
      </span>
      {done
        ? <progress className={catalogCss.bar} aria-label={label} />
        : <progress className={catalogCss.bar} aria-label={label} value={task.completedBytes ?? 0} max={total} />}
      {task.message === undefined ? null : <small className={catalogCss.note}>{task.message}</small>}
    </div>
  )
}

/** One component row: name, install state, action, description, and facts. */
function ComponentRow({ entry, catalog, components, t }: {
  readonly entry: ComponentInfo
  readonly catalog: ComponentCatalogState
  readonly components: ComponentCatalogActions
  readonly t: DataEnvPageProps['t']
}): ReactNode {
  const id = entry.id
  const task = catalog.task?.id === id ? catalog.task : null
  const active = catalog.task
  const failure = catalog.failures.find(item => item.id === id)
  const missing = (entry.requires ?? []).find(
    required => !catalog.entries.some(other => other.id === required && other.installed),
  )
  const busyElsewhere = task === null && active !== null

  return (
    <li className={catalogCss.row}>
      <div className={catalogCss.rowHead}>
        <span className={catalogCss.rowName}>{t(`components.${id}.name`)}</span>
        {entry.installed
          ? (
            <span className={catalogCss.tag}>
              {entry.version === undefined
                ? t('components.installed')
                : `${t('components.installed')} · ${entry.version}`}
            </span>
          )
          : null}
        <span className={catalogCss.rowActions}>
          {task === null
            ? null
            : (
              <button
                type="button"
                className={catalogCss.secondaryButton}
                onClick={() => { void components.cancel(id) }}
              >
                {t('components.cancel')}
              </button>
            )}
          {task !== null || entry.installed
            ? null
            : (
              <button
                type="button"
                className={catalogCss.primaryButton}
                disabled={missing !== undefined || busyElsewhere}
                title={busyElsewhere && active !== null
                  ? t('components.busy', { name: t(`components.${active.id}.name`) })
                  : undefined}
                onClick={() => { void components.install(id) }}
              >
                {failure === undefined ? t('components.download') : t('components.retry')}
              </button>
            )}
        </span>
      </div>
      <p className={catalogCss.rowDescription}>{t(`components.${id}.description`)}</p>
      {task === null ? null : <ProgressLine task={task} t={t} />}
      <dl className={catalogCss.facts}>
        {entry.estimateBytes === undefined
          ? null
          : <Fact label={t('components.sizeLabel')} value={sizeText(entry.estimateBytes, t)} />}
        {entry.location === undefined
          ? null
          : <Fact label={t('components.locationLabel')} value={entry.location} code />}
        {(entry.requires ?? []).map(required => (
          <Fact
            key={required}
            label={t('components.requiresLabel')}
            value={t(`components.${required}.name`)}
          />
        ))}
      </dl>
      {missing === undefined
        ? null
        : (
          <p className={catalogCss.hint}>
            {t('components.needsDependency', { name: t(`components.${missing}.name`) })}
          </p>
        )}
      {entry.problem === undefined
        ? null
        : <p className={catalogCss.note} role="status">{entry.problem}</p>}
      {failure === undefined
        ? null
        : (
          <p className={catalogCss.error} role="alert">
            {t('components.actionFailed', { message: failure.message })}
          </p>
        )}
    </li>
  )
}

/** The components block: the catalog's read cycle plus its rows. */
function ComponentRows({ catalog, components, t }: {
  readonly catalog: ComponentCatalogState
  readonly components: ComponentCatalogActions
  readonly t: DataEnvPageProps['t']
}): ReactNode {
  if (catalog.status === 'idle' || catalog.status === 'loading') {
    return <p className={catalogCss.note}>{t('data-env.componentsLoading')}</p>
  }
  if (catalog.status === 'error') {
    return (
      <>
        <p className={catalogCss.error} role="alert">
          {`${t('data-env.componentsFailed')} ${catalog.error ?? ''}`}
        </p>
        <div>
          <button
            type="button"
            className={catalogCss.secondaryButton}
            onClick={() => { void components.reload() }}
          >
            {t('data-env.retry')}
          </button>
        </div>
      </>
    )
  }
  return (
    <>
      {catalog.error === null
        ? null
        : (
          <p className={catalogCss.error} role="alert">
            {t('data-env.componentsRefreshFailed', { message: catalog.error })}
          </p>
        )}
      {catalog.streamError === null
        ? null
        : (
          <p className={catalogCss.note} role="status">
            {t('data-env.componentsStreamLost', { message: catalog.streamError })}
          </p>
        )}
      {catalog.entries.length === 0
        ? <p className={catalogCss.empty}>{t('data-env.componentsEmpty')}</p>
        : (
          <ul className={catalogCss.rows}>
            {catalog.entries.map(entry => (
              <ComponentRow key={entry.id} entry={entry} catalog={catalog} components={components} t={t} />
            ))}
          </ul>
        )}
    </>
  )
}

/** Render the environment & components page. */
export function DataEnvPage({ components, useCatalog, t }: DataEnvPageProps): ReactNode {
  const catalog = useCatalog(snapshot => snapshot)

  // The catalog is read on the page's first render; install outcomes and the
  // retry buttons refresh it afterwards.
  if (catalog.status === 'idle') void components.reload()

  return (
    <div className={css.page}>
      <h3 className={css.title}>{t('data-env.componentsTitle')}</h3>
      <p className={catalogCss.intro}>{t('data-env.componentsIntro')}</p>
      <ComponentRows catalog={catalog} components={components} t={t} />
    </div>
  )
}
