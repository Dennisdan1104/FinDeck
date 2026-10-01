/**
 * The create-from-sessions picker: the stored-session list folded into
 * collapsible project groups, with the selection count and the create action
 * above them. One component serves both frames this flow has — the Skills
 * page's tab and the frame-wide dialog the composer's mode pick opens — so the
 * picker decides nothing about its frame; selection and the in-flight create
 * are its own local state, and every fact it renders comes from the page store.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionsAdminEntry } from '@deepseek-ai/dsh-api-remotes/client'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsSettingsState, SkillsSettingsStore } from './store.ts'
import { countCopy } from './store.ts'
import type { SkillsKey } from './locales.ts'
import styles from './SkillsSection.module.css'

/** Props every frame hands the picker: the page controller, its snapshot, and copy. */
export interface ForgePickerProps {
  /** Page controller owning the forge flow and the session slice. */
  readonly controller: SkillsSettingsStore
  /** Live page snapshot (the forge slice's status and rows). */
  readonly state: SkillsSettingsState
  /** Section copy. */
  readonly t: (key: SkillsKey) => string
}

/** One project group of the forge session picker. */
interface ForgeGroup {
  /** Stable key: the directory itself, or the empty string for the ungrouped tail. */
  readonly key: string
  /** The session's recorded working directory; absent for a session that has none. */
  readonly path?: string
  /** The group's sessions, newest first, in the order the Host listed them. */
  readonly sessions: readonly SessionsAdminEntry[]
}

/**
 * Group the forge session list by the directory each session was created in —
 * the one project fact the administration rows carry. Groups follow the Host's
 * own order by their newest session; sessions the Host recorded no directory
 * for collect into one final group rather than scattering through the list.
 * @param sessions - stored-session rows, newest first.
 * @returns the project groups in list order.
 */
function forgeGroups(sessions: readonly SessionsAdminEntry[]): readonly ForgeGroup[] {
  const groups = new Map<string, SessionsAdminEntry[]>()
  const ungrouped: SessionsAdminEntry[] = []
  for (const session of sessions) {
    if (session.cwd === undefined || session.cwd.trim() === '') {
      ungrouped.push(session)
      continue
    }
    const existing = groups.get(session.cwd)
    if (existing === undefined) groups.set(session.cwd, [session])
    else existing.push(session)
  }
  const ordered: ForgeGroup[] = [...groups].map(([path, rows]) => ({ key: path, path, sessions: rows }))
  if (ungrouped.length > 0) ordered.push({ key: '', sessions: ungrouped })
  return ordered
}

/**
 * The display name of one project group: the directory's last segment, or the
 * dictionary's name for sessions that recorded no directory.
 * @param group - the group being rendered.
 * @param t - section copy.
 * @returns the group's label.
 */
function forgeGroupLabel(group: ForgeGroup, t: (key: SkillsKey) => string): string {
  if (group.path === undefined) return t('forgeUngrouped')
  const segments = group.path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return segments.at(-1) || group.path
}

/**
 * Render the picker.
 * @param props - the page controller, its snapshot, and section copy.
 * @returns the intro, the action bar, and the folded project groups.
 */
export function ForgePicker({ controller, state, t }: ForgePickerProps): ReactNode {
  const [selected, setSelected] = useState<readonly string[]>([])
  const [forging, setForging] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Expanded project groups; every group starts folded so the picker opens on
  // the project list rather than on fifty session rows.
  const [expanded, setExpanded] = useState<readonly string[]>([])

  const toggle = (sessionId: string, checked: boolean): void => {
    setSelected(previous =>
      checked ? [...previous, sessionId] : previous.filter(candidate => candidate !== sessionId))
  }

  const toggleGroup = (key: string, open: boolean): void => {
    setExpanded(previous => open ? [...previous, key] : previous.filter(candidate => candidate !== key))
  }

  const forge = (): void => {
    setFailure(null)
    setForging(true)
    void controller.forge(selected)
      .then((message) => { if (message !== undefined) setFailure(message) })
      .finally(() => { setForging(false) })
  }

  const renderSession = (session: SessionsAdminEntry): ReactNode => (
    <li key={session.sessionId} className={styles['forgeSession']}>
      <label className={styles['rowHead']}>
        <input
          type="checkbox"
          className={styles['checkbox']}
          checked={selected.includes(session.sessionId)}
          disabled={forging}
          aria-label={session.title ?? session.sessionId}
          onChange={(event) => { toggle(session.sessionId, event.target.checked) }}
        />
        <span className={styles['rowName']}>{session.title ?? session.sessionId}</span>
        <span className={styles['rowState']}>{new Date(session.updatedAt).toLocaleString()}</span>
      </label>
    </li>
  )

  // The action sits above the picker: selecting sessions is what arms it, and
  // the answer to "what will this do" stays at the top of the scroll.
  const bar = (
    <div className={styles['forgeBar']}>
      <span className={styles['forgeSelection']}>{countCopy(t('forgeSelectedCount'), selected.length)}</span>
      <button
        type="button"
        className={styles['primaryButton']}
        disabled={forging || selected.length === 0}
        onClick={forge}
      >
        {forging ? t('forgeCreating') : t('forgeCreate')}
      </button>
    </div>
  )

  if (state.forge.status === 'error') {
    return (
      <>
        <p className={styles['intro']}>{t('forgeIntro')}</p>
        <p role="alert" className={styles['error']}>{`${t('forgeFailed')}: ${state.forge.error ?? ''}`}</p>
        <div>
          <button type="button" className={styles['secondaryButton']} onClick={() => { void controller.loadForgeSessions() }}>
            {t('retry')}
          </button>
        </div>
      </>
    )
  }

  if (state.forge.status === 'ready' && state.forge.sessions.length === 0) {
    return (
      <>
        <p className={styles['intro']}>{t('forgeIntro')}</p>
        <p className={styles['empty']}>{t('forgeEmpty')}</p>
      </>
    )
  }

  return (
    <>
      <p className={styles['intro']}>{t('forgeIntro')}</p>
      {bar}
      <ul className={styles['forgeGroups']}>
        {forgeGroups(state.forge.sessions).map((group) => {
          const open = expanded.includes(group.key)
          return (
            <li key={group.key} className={styles['forgeGroup']}>
              <button
                type="button"
                className={styles['forgeGroupHead']}
                aria-expanded={open}
                title={group.path}
                onClick={() => { toggleGroup(group.key, !open) }}
              >
                <IconChevronDownOutlineRegular className={open ? styles['forgeChevronOpen'] : styles['forgeChevron']} />
                <span className={styles['forgeGroupName']}>{forgeGroupLabel(group, t)}</span>
                <span className={styles['forgeGroupCount']}>{String(group.sessions.length)}</span>
              </button>
              {open ? <ul className={styles['forgeGroupSessions']}>{group.sessions.map(renderSession)}</ul> : null}
            </li>
          )
        })}
      </ul>
      {failure === null ? null : <p role="alert" className={styles['error']}>{failure}</p>}
    </>
  )
}
