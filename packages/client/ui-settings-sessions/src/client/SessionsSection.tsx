/**
 * Sessions settings section: one row per session stored on this server, with
 * its whole-log turn/step counts, last activity, workspace, and log size, plus
 * the three administration actions. Renaming writes an explicit title through
 * the Session's own rename verb; Export hands the Host's session-log download
 * route to the browser; Delete asks for confirmation and then asks the Host to
 * discard the stored log.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionsAdminEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionsSettingsStore } from './store.ts'
import type { SessionsKey } from './locales.ts'
import styles from './SessionsSection.module.css'

/** Namespace-bound translate with this section's template parameters. */
export type SessionsTranslate = (key: SessionsKey, params?: Record<string, unknown>) => string

/** Injected dependencies of {@link SessionsSection} (slot `inject`). */
export interface SessionsSectionInjected {
  /** The page store (loaded on mount, replaced by every accepted answer). */
  controller: SessionsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: SessionsSettingsStore['store']
  }
  /** Section copy. */
  t: SessionsTranslate
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type SessionsSectionProps = Partial<InjectFace<SessionsSectionInjected>>

/**
 * Render the Sessions section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function SessionsSection(props: SessionsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded injected={{ controller, useSnapshot, t }} />
}

/** One fact row of a stored session's metadata. */
function Fact({ label, value, code = false }: { label: string; value: string; code?: boolean }): ReactNode {
  return (
    <>
      <dt className={styles['factLabel']}>{label}</dt>
      <dd className={code ? `${styles['factValue']} ${styles['factCode']}` : styles['factValue']}>{value}</dd>
    </>
  )
}

/**
 * Absolute activity time through the dictionary's template: `toLocaleString`
 * would follow the browser language rather than the app locale and produce
 * mixed-language text after a switch.
 * @param at - epoch milliseconds of the last activity.
 * @param t - section copy.
 * @returns the localized stamp.
 */
function stamp(at: number, t: SessionsTranslate): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return t('time', {
    y: date.getFullYear(),
    m: pad(date.getMonth() + 1),
    d: pad(date.getDate()),
    hh: pad(date.getHours()),
    mm: pad(date.getMinutes()),
  })
}

function Loaded({ injected }: { injected: InjectFace<SessionsSectionInjected> }): ReactNode {
  const { controller, t } = injected
  const state = injected.useSnapshot(snapshot => snapshot)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const busy = state.busySessionId !== null

  if (state.status === 'idle') void controller.load()

  const run = (operation: () => Promise<string | undefined | void>): void => {
    setActionError(undefined)
    void operation().then((failure) => { if (failure !== undefined) setActionError(failure) })
  }

  if (state.status === 'error') {
    return (
      <div className={styles['section']}>
        <h2 className={styles['title']}>{t('title')}</h2>
        <p role="alert" className={styles['error']}>{`${t('loadFailed')}: ${state.error ?? ''}`}</p>
        <button
          type="button"
          className={styles['secondaryButton']}
          onClick={() => { run(() => controller.load()) }}
        >
          {t('retry')}
        </button>
      </div>
    )
  }

  return (
    <div className={styles['section']}>
      <div className={styles['head']}>
        <div className={styles['headText']}>
          <h2 className={styles['title']}>{t('title')}</h2>
          <p className={styles['intro']}>{t('intro')}</p>
        </div>
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={busy || state.status === 'loading'}
          onClick={() => { run(() => controller.load()) }}
        >
          {state.status === 'loading' ? t('refreshing') : t('refresh')}
        </button>
      </div>
      {actionError === undefined ? null : <p role="alert" className={styles['error']}>{actionError}</p>}
      {state.status === 'ready' && state.entries.length === 0
        ? <p className={styles['empty']}>{t('empty')}</p>
        : (
          <ul className={styles['rows']}>
            {state.entries.map(entry => (
              <li key={entry.sessionId} className={styles['row']}>
                <div className={styles['rowHead']}>
                  {editing !== null && editing.id === entry.sessionId
                    ? (
                      <form
                        className={styles['renameForm']}
                        onSubmit={(event) => {
                          event.preventDefault()
                          const title = editing.value
                          setEditing(null)
                          run(() => controller.rename(entry.sessionId, title))
                        }}
                      >
                        <input
                          className={styles['input']}
                          value={editing.value}
                          aria-label={t('renameLabel')}
                          autoFocus
                          onChange={(event) => { setEditing({ id: entry.sessionId, value: event.target.value }) }}
                        />
                        <button type="submit" className={styles['secondaryButton']} disabled={busy}>
                          {t('renameSave')}
                        </button>
                        <button
                          type="button"
                          className={styles['secondaryButton']}
                          onClick={() => { setEditing(null) }}
                        >
                          {t('renameCancel')}
                        </button>
                      </form>
                    )
                    : (
                      <>
                        <span className={styles['rowTitle']}>{entry.title ?? t('untitled')}</span>
                        {entry.open ? <span className={styles['tag']}>{t('openBadge')}</span> : null}
                        <div className={styles['actions']}>
                          <button
                            type="button"
                            className={styles['secondaryButton']}
                            disabled={busy}
                            onClick={() => {
                              setConfirming(null)
                              setEditing({ id: entry.sessionId, value: entry.title ?? '' })
                            }}
                          >
                            {t('rename')}
                          </button>
                          <button
                            type="button"
                            className={styles['secondaryButton']}
                            title={t('exportHint')}
                            onClick={() => { controller.exportSession(entry.sessionId) }}
                          >
                            {t('export')}
                          </button>
                          {confirming === entry.sessionId
                            ? (
                              <>
                                <button
                                  type="button"
                                  className={styles['dangerButton']}
                                  disabled={busy}
                                  onClick={() => {
                                    setConfirming(null)
                                    run(() => controller.remove(entry.sessionId))
                                  }}
                                >
                                  {t('deleteConfirm')}
                                </button>
                                <button
                                  type="button"
                                  className={styles['secondaryButton']}
                                  onClick={() => { setConfirming(null) }}
                                >
                                  {t('deleteCancel')}
                                </button>
                              </>
                            )
                            : (
                              <button
                                type="button"
                                className={styles['dangerButton']}
                                title={entry.open ? t('openHint') : t('deleteHint')}
                                disabled={busy || entry.open}
                                onClick={() => { setConfirming(entry.sessionId) }}
                              >
                                {t('delete')}
                              </button>
                            )}
                        </div>
                      </>
                    )}
                </div>
                <SessionFacts entry={entry} t={t} />
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

/** The metadata block of one stored-session row. */
function SessionFacts({ entry, t }: { entry: SessionsAdminEntry; t: SessionsTranslate }): ReactNode {
  return (
    <dl className={styles['facts']}>
      <Fact label={t('turns')} value={entry.turns === undefined ? t('unknown') : String(entry.turns)} />
      <Fact label={t('steps')} value={entry.steps === undefined ? t('unknown') : String(entry.steps)} />
      <Fact label={t('updated')} value={stamp(entry.updatedAt, t)} />
      <Fact
        label={t('workspace')}
        value={entry.cwd ?? t('unknown')}
        code={entry.cwd !== undefined}
      />
      <Fact
        label={t('size')}
        value={entry.sizeBytes === undefined ? t('unknown') : fileSizeText(entry.sizeBytes)}
      />
    </dl>
  )
}
