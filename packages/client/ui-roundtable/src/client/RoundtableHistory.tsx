/**
 * The roundtable history column: the sidebar content that replaces the
 * workspaces region while the roundtable page is open (the shell's
 * `sidebar.section` entry keyed 'roundtable'). The top row is the table open
 * right now, shown for as long as one is; below it come the engine's closed
 * tables, newest first, and clicking a row shows that transcript on the page.
 * Both reads are re-read on a short interval while the column is visible, so a
 * table opened or closed during the visit joins the list on its own. Pure data
 * face — the room and the archive both belong to the host engine.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RoundtableRoomView } from '@deepseek-ai/dsh-api-remotes/client'
import { selectArchive, selectedArchive, subscribeHistory } from './history-store.ts'
import css from './RoundtablePage.module.css'

/** One archive row as the sidebar lists it (the host summary, camelCase as served). */
export interface RoundtableHistoryRow {
  readonly id: string
  readonly closedAt: string
  readonly rosterName: string
  readonly turns: number
  readonly topic: string
  readonly seedTitle?: string
}

/** One seating as the live row needs it: the id the room seats and its display name. */
interface RoundtableHistoryRoster {
  readonly id: string
  readonly name: string
}

/** The live table's row: the open room reduced to what the row shows. */
interface RoundtableLiveRow {
  /** The seated seating's display name, or its id when the deployment no longer offers it. */
  readonly rosterName: string
  /** The seating's depth, null only for a room whose table was released with a transcript left. */
  readonly depth: 'shallow' | 'deep' | null
  /** Speaker turns recorded so far. */
  readonly turns: number
  /** First user message, empty when the table has none yet. */
  readonly topic: string
  /** Whether the engine is driving speaker requests right now. */
  readonly busy: boolean
}

export type RoundtableHistoryProps =
  PropsRuntime<'sidebar.section'>
  & PropsLocale<'ui.roundtable'>
  & {
    /** Recent closed tables, newest first; empty when nothing is archived. */
    readonly archiveList: () => Promise<readonly RoundtableHistoryRow[]>
    /**
     * The live room plus the seatings its row names, in one read. It carries
     * the same room snapshot the page polls, so naming the seated roster costs
     * the column no second request per interval.
     */
    readonly live: () => Promise<{
      readonly room: RoundtableRoomView
      readonly rosters: readonly RoundtableHistoryRoster[]
    }>
  }

/**
 * How often the column re-reads the archive listing and the live room,
 * milliseconds. Both are how a table opened or closed while the page stays open
 * reaches the column, so they are refreshed on an interval rather than once per
 * mount. The room rides this tick instead of a faster cadence of its own: the
 * page already polls the room every 200 ms while a speaker generates, and the
 * live row shows only seating, depth, turn count, and the busy flag.
 */
const HISTORY_POLL_MILLIS = 2500

/** `2026-09-12T10:30:00.000Z` → `09-12 10:30` for the row's meta line. */
function shortTime(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso
}

/** Newest first, whatever order the host served: `closedAt` descending, id as the tiebreak. */
function newestFirst(rows: readonly RoundtableHistoryRow[]): RoundtableHistoryRow[] {
  return [...rows].sort((left, right) => left.closedAt === right.closedAt
    ? right.id.localeCompare(left.id)
    : right.closedAt.localeCompare(left.closedAt))
}

/**
 * The live table's row, or null while no table is open. A table counts as open
 * once it carries a configuration or a transcript; the engine opens and clears
 * both together, so either one is enough to say the room exists.
 * @param room - the room snapshot the host served.
 * @param rosters - the seatings offered, for the seated one's display name.
 * @returns the row's data, or null when the room holds no table.
 */
function liveRow(
  room: RoundtableRoomView,
  rosters: readonly RoundtableHistoryRoster[],
): RoundtableLiveRow | null {
  const table = room.table
  if (table === null && room.transcript.length === 0) return null
  const opening = room.transcript.find(entry => entry.kind === 'user')
  return {
    rosterName: table === null
      ? ''
      : rosters.find(roster => roster.id === table.rosterId)?.name ?? table.rosterId,
    depth: table?.depth ?? null,
    turns: room.transcript.filter(entry => entry.kind === 'speaker').length,
    topic: opening?.text.trim() ?? '',
    busy: room.busy,
  }
}

/** Render the history column. */
export function RoundtableHistory({ archiveList, live, t }: RoundtableHistoryProps): ReactNode {
  const [rows, setRows] = useState<readonly RoundtableHistoryRow[] | null>(null)
  const [currentRow, setCurrentRow] = useState<RoundtableLiveRow | null>(null)
  const [failed, setFailed] = useState(false)
  const selected = useSyncExternalStore(subscribeHistory, selectedArchive, selectedArchive)

  useEffect(() => {
    let alive = true
    const read = (): void => {
      void archiveList().then(
        (value) => { if (alive) { setRows(newestFirst(value)); setFailed(false) } },
        () => { if (alive) setFailed(true) },
      )
      // Swallow a failed room read: the listing read above owns the failure
      // report, and a transient miss must not drop an open table from the
      // column while the next interval is already on its way.
      void live().then(
        (value) => { if (alive) setCurrentRow(liveRow(value.room, value.rosters)) },
        () => {},
      )
    }
    read()
    // A background tab has nothing to show the new row to; the visibility
    // handler catches up the moment the column is on screen again.
    const timer = window.setInterval(() => { if (!document.hidden) read() }, HISTORY_POLL_MILLIS)
    const onVisibility = (): void => { if (!document.hidden) read() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [archiveList, live])

  // A released table whose transcript is still shown has no seating name or
  // depth, so those parts drop out of the meta line.
  const currentMeta = currentRow === null ? '' : [
    currentRow.rosterName,
    currentRow.depth === null ? '' : t(currentRow.depth === 'deep' ? 'depthDeep' : 'depthShallow'),
    fillCount(t('historyTurns'), currentRow.turns),
  ].filter(part => part !== '').join(' · ')

  return (
    <nav className={css.history} aria-label={t('historyTitle')}>
      <p className={css.historyTitle}>{t('historyTitle')}</p>
      {failed ? <p className={css.historyEmpty}>{t('historyFailed')}</p> : null}
      {currentRow !== null
        ? (
          <button
            type="button"
            className={css.historyItem}
            data-selected={String(selected === null)}
            onClick={() => { selectArchive(null) }}
          >
            <span className={css.historyMeta}>
              <span className={css.historyCurrentBadge}>{t('historyCurrentBadge')}</span>
              {currentRow.busy ? <span className={css.historyBusyBadge}>{t('historyBusyBadge')}</span> : null}
              {currentMeta}
            </span>
            <span className={css.historyTopic}>
              {currentRow.topic === '' ? t('historyNoTopic') : currentRow.topic}
            </span>
          </button>
        )
        : null}
      {rows !== null && rows.length === 0 ? <p className={css.historyEmpty}>{t('historyEmpty')}</p> : null}
      {rows?.map(row => (
        <button
          key={row.id}
          type="button"
          className={css.historyItem}
          data-selected={String(selected === row.id)}
          onClick={() => { selectArchive(selected === row.id ? null : row.id) }}
        >
          <span className={css.historyMeta}>
            {`${shortTime(row.closedAt)} · ${row.rosterName} · ${fillCount(t('historyTurns'), row.turns)}`}
          </span>
          <span className={css.historyTopic}>{row.topic === '' ? t('historyNoTopic') : row.topic}</span>
        </button>
      ))}
      {selected !== null
        ? (
          <button type="button" className={css.historyCurrent} onClick={() => { selectArchive(null) }}>
            {t('historyViewCurrent')}
          </button>
        )
        : null}
    </nav>
  )
}

/** `{count}` placeholder fill for one number. */
function fillCount(text: string, count: number): string {
  return text.replaceAll('{count}', String(count))
}
