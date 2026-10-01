/**
 * The roundtable primary page (R13/U6): a full-bleed room under the shell's
 * page chrome — a head strip (phase, the running table's facts, the seating)
 * above a shared transcript that fills the remaining height, with the
 * steering composer pinned below it. The composer belongs to a table that is
 * open: while none runs, the body hosts the open-table setup or the seating
 * editor as a centered card with no composer below it, so opening the table
 * stays the setup's own action, and the history column's selection reuses the
 * same room layout read-only.
 * The host engine owns every decision (order, skips, interruption, @点名,
 * and what a deep speaker may look up); this page sends the three open-table
 * choices (plus, for a deep table, the conversation to continue), user
 * messages, and polls the room while it is busy.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  DisclosureRow, IconCheckOutlineMedium, IconCopyOutlineMedium, IconLinkOutlineRegular, IconThinkOutlineRegular, MarkdownText,
  Menu, StateDot, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  RosterIdentity, RoundtableEntry, RoundtableFlowItem, RoundtablePartial, RoundtableRoomView,
  RoundtableToolActivity,
} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the table's configuration and its citation record are declared by
// the Host package that owns them, and this page is the same package's public
// browser face.
import type { RoundtableCitation, RoundtableTableConfig } from '@deepseek-ai/dsh-roundtable/types'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { selectArchive, selectedArchive, subscribeHistory } from './history-store.ts'
import css from './RoundtablePage.module.css'

/** One roster as the setup screen lists and edits it. */
export interface RoundtableRosterView {
  readonly id: string
  readonly name: string
  readonly builtin: boolean
  readonly members: readonly RosterIdentity[]
}

/** One model the open-table setup can route every speaker through. */
export interface RoundtableModelOption {
  readonly provider: string
  readonly model: string
  /** Provider display name, for the option's group label. */
  readonly providerName: string
  readonly modelName: string
}

/** One roster as the editor writes it back. */
export interface RoundtableRosterDraft {
  readonly id: string
  readonly name: string
  readonly members: readonly {
    readonly id: string
    readonly name: string
    readonly prompt: string
    readonly moderator: boolean
  }[]
}

export type RoundtablePageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.roundtable'>
  & {
    /** Read the rosters, the remembered table, and the room in one call. */
    readonly load: () => Promise<{
      rosters: RoundtableRosterView[]
      table: RoundtableTableConfig
      room: RoundtableRoomView
    }>
    /** The models every speaker request may use; empty when none is configured. */
    readonly models: () => Promise<RoundtableModelOption[]>
    /**
     * Open a table with the three choices made, remembering them. A deep table
     * may name the conversation it continues; the engine exports it to a file
     * its speakers read, and refuses a seed on a shallow table.
     */
    readonly open: (
      config: RoundtableTableConfig,
      seed?: { sessionId: string; title: string },
    ) => Promise<RoundtableRoomView>
    /** Store the user's own rosters. */
    readonly saveRosters: (rosters: readonly RoundtableRosterDraft[]) => Promise<void>
    /** Read the live room; polled while busy. */
    readonly room: () => Promise<RoundtableRoomView>
    /** Send one user message (opening, steering, or interrupting). */
    readonly send: (text: string) => Promise<RoundtableRoomView>
    /**
     * Stop the round the table is running: the speaker generating right now is
     * cancelled and its unfinished speech is discarded, so the table waits for
     * the user's next message instead of moving on to the next speaker.
     */
    readonly interrupt: () => Promise<RoundtableRoomView>
    /** Clear the table. */
    readonly reset: () => Promise<RoundtableRoomView>
    /** Read one archived table in full (the history column's selection). */
    readonly archiveRead: (id: string) => Promise<RoundtableArchiveView>
    /**
     * The shell chrome's `New Roundtable` signal: a revision that moves each
     * time the primary nav button asks for a fresh table while this page is
     * open. It reports the request only; this page owns the reaction.
     */
    readonly useNewTable: SnapshotSelectorHook<number>
  }

/** One archived table as the page renders it, read-only. */
export interface RoundtableArchiveView {
  readonly closedAt: string
  readonly rosterName: string
  readonly depth: 'shallow' | 'deep'
  readonly model: string
  readonly seedTitle?: string
  readonly transcript: readonly RoundtableEntry[]
}

function fill(text: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text)
}

/** Characters of one tool call's argument JSON the expanded row renders. */
const TOOL_ARGUMENT_MAX_CHARS = 2_000

/** Characters of a source URL's path a source row shows before it ellipsizes. */
const SOURCE_PATH_MAX_CHARS = 28

/** Row-state semantics of one tool call, as the shared state dot reads them. */
function toolDotState(status: RoundtableToolActivity['status']): StateDotState {
  switch (status) {
    case 'ok': return 'done'
    case 'error': return 'error'
    case 'interrupted': return 'warning'
    default: return 'ongoing'
  }
}

/**
 * What one tool call is called in the room: the tool's own action name, with
 * an unrecognized tool keeping its wire name as the title.
 * @param name - the wire tool name.
 * @param t - the page locale seat.
 * @returns the row's title.
 */
function toolTitle(name: string, t: RoundtablePageProps['t']): string {
  switch (name) {
    case 'web_search': return t('toolWebSearch')
    case 'web_fetch': return t('toolWebFetch')
    case 'read': return t('toolRead')
    case 'read_image': return t('toolReadImage')
    case 'grep': return t('toolGrep')
    case 'glob': return t('toolGlob')
    default: return name === '' ? t('toolUnknown') : name
  }
}

/** One tool call's status, as the row's trailing chip reads it. */
function toolStatusLabel(status: RoundtableToolActivity['status'], t: RoundtablePageProps['t']): string {
  switch (status) {
    case 'ok': return t('toolOk')
    case 'error': return t('toolError')
    case 'interrupted': return t('toolInterrupted')
    default: return t('toolRunning')
  }
}

/** Whether two open-table configurations differ in any choice the user makes. */
function differs(left: RoundtableTableConfig, right: RoundtableTableConfig): boolean {
  return left.depth !== right.depth || left.rosterId !== right.rosterId
    || left.provider !== right.provider || left.model !== right.model
}

/**
 * The open-table setup: depth, seating, and model, then open.
 *
 * Nothing here is a form to fill: the three choices come pre-selected from the
 * last table the user opened, so opening again is one click.
 */
export function SetupPanel({ rosters, table, models, modelProblem, seedChoices, onOpen, onEditRoster, t }: {
  readonly rosters: readonly RoundtableRosterView[]
  readonly table: RoundtableTableConfig
  readonly models: readonly RoundtableModelOption[]
  readonly modelProblem: string | null
  /** Workspaces and their sessions, for the deep table's continue-a-conversation picker. */
  readonly seedChoices: readonly {
    readonly workspaceId: string
    readonly title: string
    readonly sessions: readonly { readonly id: string; readonly title: string }[]
  }[]
  readonly onOpen: (config: RoundtableTableConfig, seed?: { sessionId: string; title: string }) => void
  readonly onEditRoster: () => void
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  const [config, setConfig] = useState<RoundtableTableConfig>(table)
  const [touched, setTouched] = useState(false)
  const [seedWorkspace, setSeedWorkspace] = useState('')
  const [seedSession, setSeedSession] = useState('')
  // The remembered table arrives after the first render; adopt it until the
  // user touches a control, whatever the one who opened the page last chose.
  if (!touched && differs(config, table)) setConfig(table)
  // Switching to a shallow table drops the seed: continuing a conversation is
  // the deep table's capability (its speakers read the export themselves).
  if (config.depth !== 'deep' && (seedWorkspace !== '' || seedSession !== '')) {
    setSeedWorkspace('')
    setSeedSession('')
  }
  const patch = (next: Partial<RoundtableTableConfig>): void => {
    setTouched(true)
    setConfig(current => ({ ...current, ...next }))
  }
  const { provider, model } = config
  const route = `${provider}/${model}`
  // The remembered route stays selectable even when the catalog does not
  // currently offer it, so opening with it is still possible.
  const offersRoute = models.some(option => `${option.provider}/${option.model}` === route)

  return (
    <section className={css.setup}>
      <h3 className={css.sectionTitle}>{t('setupTitle')}</h3>
      <p className={css.hint}>{t('setupBlurb')}</p>

      <div className={css.setupRow} role="radiogroup" aria-label={t('depthLabel')}>
        {(['shallow', 'deep'] as const).map(depth => (
          <button
            key={depth}
            type="button"
            role="radio"
            aria-checked={config.depth === depth}
            className={css.depthOption}
            data-selected={String(config.depth === depth)}
            onClick={() => { patch({ depth }) }}
          >
            <span className={css.depthName}>{depth === 'deep' ? t('depthDeep') : t('depthShallow')}</span>
            <span className={css.depthHint}>{depth === 'deep' ? t('depthDeepHint') : t('depthShallowHint')}</span>
          </button>
        ))}
      </div>

      <label className={css.setupField}>
        <span>{t('rosterLabel')}</span>
        <select value={config.rosterId} onChange={(event) => { patch({ rosterId: event.currentTarget.value }) }}>
          {rosters.map(roster => (
            <option key={roster.id} value={roster.id}>
              {`${roster.name} · ${fill(t('rosterMembers'), { count: String(roster.members.length) })}`}
            </option>
          ))}
        </select>
      </label>
      <p className={css.hint}>{t('rosterModeratorNote')}</p>
      <button type="button" className={css.ghost} onClick={onEditRoster}>{t('editRoster')}</button>

      <label className={css.setupField}>
        <span>{t('modelLabel')}</span>
        <select
          value={route}
          onChange={(event) => {
            const [providerPart, ...rest] = event.currentTarget.value.split('/')
            // A picker value always names a provider before the slash: the
            // options are the catalog plus the remembered route.
            /* v8 ignore next -- every option value carries a provider */
            patch({ provider: providerPart ?? '', model: rest.join('/') })
          }}
        >
          {offersRoute ? null : <option value={route}>{route}</option>}
          {models.map(option => (
            <option key={`${option.provider}/${option.model}`} value={`${option.provider}/${option.model}`}>
              {`${option.providerName} · ${option.modelName}`}
            </option>
          ))}
        </select>
      </label>
      {models.length === 0 ? <p className={css.hint}>{modelProblem ?? t('modelEmpty')}</p> : null}

      {config.depth === 'deep'
        ? (
          <div className={css.seedPicker}>
            <p className={css.hint}>{t('seedHint')}</p>
            <label className={css.setupField}>
              <span>{t('seedWorkspaceLabel')}</span>
              <select
                value={seedWorkspace}
                onChange={(event) => {
                  setSeedWorkspace(event.currentTarget.value)
                  setSeedSession('')
                }}
              >
                <option value="">{t('seedNone')}</option>
                {seedChoices.map(workspace => (
                  <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
                ))}
              </select>
            </label>
            {seedWorkspace !== ''
              ? (
                <label className={css.setupField}>
                  <span>{t('seedSessionLabel')}</span>
                  <select
                    value={seedSession}
                    onChange={(event) => { setSeedSession(event.currentTarget.value) }}
                  >
                    <option value="">{t('seedNone')}</option>
                    {(seedChoices.find(workspace => workspace.workspaceId === seedWorkspace)?.sessions ?? [])
                      .map(session => (
                        <option key={session.id} value={session.id}>{session.title}</option>
                      ))}
                  </select>
                </label>
              )
              : null}
          </div>
        )
        : null}

      <div className={css.flowActions}>
        <button
          type="button"
          className={css.primary}
          onClick={() => {
            const seeded = config.depth === 'deep' && seedSession !== ''
              ? seedChoices
                .flatMap(workspace => workspace.sessions)
                .find(session => session.id === seedSession)
              : undefined
            onOpen(config, seeded === undefined ? undefined : { sessionId: seeded.id, title: seeded.title })
          }}
        >
          {t('open')}
        </button>
      </div>
    </section>
  )
}

/** The seating editor: names, contracts, order, and who closes the round. */
export function RosterEditor({ rosters, onSave, onClose, t }: {
  readonly rosters: readonly RoundtableRosterView[]
  readonly onSave: (drafts: readonly RoundtableRosterDraft[]) => Promise<void>
  readonly onClose: () => void
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  // A built-in seating is edited as a copy: the saved roster replaces it by
  // id, which is why the editor starts from what the roster currently seats.
  // The picker chooses which DRAFT is shown, never which roster to reload —
  // an edit made here survives looking at another seating.
  const [drafts, setDrafts] = useState<RoundtableRosterDraft[]>(() => rosters.map(roster => ({
    id: roster.id,
    name: roster.name,
    members: roster.members.map(member => ({
      id: member.id,
      name: member.name,
      prompt: member.prompt,
      moderator: member.moderator,
    })),
  })))
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // The picker's index is bound to this list, so a draft is always selected;
  // the fallback keeps the editor total for a caller that passes none.
  /* v8 ignore next -- the picker only ever names an existing draft */
  const roster = drafts[active] ?? { id: '', name: '', members: [] }
  const patchRoster = (next: Partial<RoundtableRosterDraft>): void => {
    // Copy the whole list, then replace the selected draft in it: the picker's
    // index is bound to this list, so an edit always names the draft it shows.
    const patched = structuredClone(drafts)
    const selected = patched[active]
    /* v8 ignore next -- the picker's index is bound to this list, so a draft is always selected */
    if (selected === undefined) return
    patched[active] = { ...selected, ...next }
    setDrafts(patched)
    setSaved(false)
  }
  const moveMember = (from: number, to: number): void => {
    const members = [...roster.members]
    const [moved] = members.splice(from, 1)
    /* v8 ignore next -- a move button only exists for a seat that is in the list */
    if (moved === undefined) return
    members.splice(to, 0, moved)
    patchRoster({ members })
  }
  const addSeat = (): void => {
    // A seat added here starts from the first shipped identity this deployment
    // lists: its empty name and contract keep that identity's own, so the new
    // row speaks the shipped contract until the user writes another.
    const seed = rosters.flatMap(candidate => candidate.members).find(member => member.builtin)?.id
    patchRoster({
      members: [
        ...roster.members,
        /* v8 ignore next -- every deployment ships the identities its rosters are built from */
        { id: seed ?? 'bull-researcher', name: '', prompt: '', moderator: false },
      ],
    })
  }
  const addRoster = (): void => {
    const id = `custom-${String(drafts.length + 1)}`
    setDrafts(current => [...current, {
      id,
      name: id,
      members: [{ id: 'bull-researcher', name: '', prompt: '', moderator: false }],
    }])
    setActive(drafts.length)
    setSaved(false)
  }

  return (
    <section className={css.setup}>
      <h3 className={css.sectionTitle}>{t('editRoster')}</h3>
      <p className={css.hint}>{t('editRosterHint')}</p>
      <div className={css.formRow}>
        <label className={css.setupField}>
          <span>{t('rosterPick')}</span>
          <select value={String(active)} onChange={(event) => { setActive(Number(event.currentTarget.value)) }}>
            {drafts.map((draft, index) => <option key={draft.id} value={String(index)}>{draft.name}</option>)}
          </select>
        </label>
        <label className={css.setupField}>
          <span>{t('rosterName')}</span>
          <input value={roster.name} onChange={(event) => { patchRoster({ name: event.currentTarget.value }) }} />
        </label>
      </div>
      {roster.members.map((member, index) => (
        <div key={`${member.id}-${String(index)}`} className={css.formRow}>
          <label className={css.setupField}>
            <span>{t('memberName')}</span>
            <input
              value={member.name}
              placeholder={t('memberNameHint')}
              onChange={(event) => {
                patchRoster({
                  members: roster.members.map((row, at) => at === index ? { ...row, name: event.currentTarget.value } : row),
                })
              }}
            />
          </label>
          <label className={css.setupField}>
            <span>{t('memberId')}</span>
            <input value={member.id} readOnly />
          </label>
          <label className={`${css.setupField} ${css.setupFieldWide}`}>
            <span>{t('memberPrompt')}</span>
            <input
              value={member.prompt}
              onChange={(event) => {
                patchRoster({
                  members: roster.members.map((row, at) => at === index ? { ...row, prompt: event.currentTarget.value } : row),
                })
              }}
            />
          </label>
          <label className={css.seatFlag}>
            <input
              type="radio"
              name={`closer-${roster.id}`}
              checked={member.moderator}
              onChange={() => {
                // One member closes a seating: marking one unmarks the rest.
                patchRoster({
                  members: roster.members.map((row, at) => ({ ...row, moderator: at === index })),
                })
              }}
            />
            {t('memberModerator')}
          </label>
          <button type="button" className={css.ghost} disabled={index === 0} onClick={() => { moveMember(index, index - 1) }}>
            {t('memberUp')}
          </button>
          <button
            type="button"
            className={css.ghost}
            disabled={index === roster.members.length - 1}
            onClick={() => { moveMember(index, index + 1) }}
          >
            {t('memberDown')}
          </button>
          <button
            type="button"
            className={css.ghost}
            disabled={roster.members.length <= 1}
            onClick={() => { patchRoster({ members: roster.members.filter((_row, at) => at !== index) }) }}
          >
            {t('memberRemove')}
          </button>
        </div>
      ))}
      <div className={css.flowActions}>
        <button type="button" className={css.ghost} onClick={addSeat}>{t('addMember')}</button>
        <button type="button" className={css.ghost} onClick={addRoster}>{t('addSeating')}</button>
        <button
          type="button"
          className={css.primary}
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onSave(drafts).then(
              () => { setBusy(false); setSaved(true) },
              () => { setBusy(false) },
            )
          }}
        >
          {busy ? t('savingRosters') : t('saveRosters')}
        </button>
        <button type="button" className={css.ghost} onClick={onClose}>{t('closeEditor')}</button>
        {saved ? <span className={css.cardDesc}>{t('rostersSaved')}</span> : null}
      </div>
    </section>
  )
}

/** Render the roundtable page. */
export function RoundtablePage({
  load, models, open, saveRosters, room, send, interrupt, reset, archiveRead, useNewTable, useWorkspaces, useSessions, t,
}: RoundtablePageProps): ReactNode {
  const [view, setView] = useState<RoundtableRoomView | null>(null)
  const [rosters, setRosters] = useState<RoundtableRosterView[]>([])
  const [table, setTable] = useState<RoundtableTableConfig | null>(null)
  const [options, setOptions] = useState<RoundtableModelOption[]>([])
  const [modelProblem, setModelProblem] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [openFailure, setOpenFailure] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // The composer's @ list: the seated identities, opened by the composer's own
  // control and closed by a pick, Escape, or a pointer outside it.
  const [mentionOpen, setMentionOpen] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  // The history column's selection: null renders the live room, an archive id
  // renders that closed table read-only.
  const historySelected = useSyncExternalStore(subscribeHistory, selectedArchive, selectedArchive)
  const [archive, setArchive] = useState<RoundtableArchiveView | null>(null)
  const [archiveFailed, setArchiveFailed] = useState(false)
  // The shell chrome's "New Roundtable" request (see the page's `newTable` seat).
  const newTableRequest = useNewTable(revision => revision)

  // The deep table's continue-a-conversation choices: every workspace with its
  // sessions' display titles, straight from the standard hooks.
  const workspaces = useWorkspaces(s => s.items)
  const sessionsById = useSessions(s => s.byId)
  const seedChoices = workspaces.map(workspace => ({
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    sessions: workspace.sessionIds
      .flatMap(id => sessionsById[id] === undefined ? [] : [sessionsById[id]])
      .filter(session => session.origin !== 'subagent')
      .map(session => ({ id: session.id, title: session.displayTitle })),
  }))

  useEffect(() => {
    if (historySelected === null) {
      setArchive(null)
      setArchiveFailed(false)
      return
    }
    let current = true
    setArchive(null)
    setArchiveFailed(false)
    void archiveRead(historySelected).then(
      (value) => { if (current) setArchive(value) },
      () => { if (current) setArchiveFailed(true) },
    )
    return () => { current = false }
  }, [historySelected, archiveRead])

  const reload = async (): Promise<void> => {
    const value = await load()
    setView(value.room)
    setRosters(value.rosters)
    setTable(value.table)
  }

  // Starting a new table means returning to the open-table setup: drop the
  // archive the column may have selected, release the running table (the host
  // archives a table that spoke before it clears), and read the released
  // configuration back — `reset` reports the closed room, so the remembered
  // setup itself comes from the following read. The revision outlives this
  // component, so the ref records what this mount has already acted on: a
  // remount (coming back to the page) must not release the table again.
  const seenNewTable = useRef(newTableRequest)
  useEffect(() => {
    if (newTableRequest === seenNewTable.current) return
    seenNewTable.current = newTableRequest
    selectArchive(null)
    void reset().then(
      () => load().then(
        (value) => { setView(value.room); setRosters(value.rosters); setTable(value.table) },
        () => { setFailed(true) },
      ),
      () => { setFailed(true) },
    )
  }, [newTableRequest, reset, load])

  useEffect(() => {
    let current = true
    setFailed(false)
    void load().then(
      (value) => { if (current) { setView(value.room); setRosters(value.rosters); setTable(value.table) } },
      () => { if (current) setFailed(true) },
    )
    void models().then(
      (value) => { if (current) setOptions(value) },
      // The page is unmounted before the catalog answers; nothing is left to
      // show the failure on.
      /* v8 ignore next -- an unmounted page has no hint to set */
      (error: unknown) => { if (current) setModelProblem(`${t('modelLoadFailed')} (${String(error)})`) },
    )
    return () => { current = false }
  }, [load, models, t])

  // Poll the room for as long as a table is open: fast while a speaker is
  // generating, because the room publishes the unfinished turn as `partial` and
  // the page renders it growing; slow while the table just sits there, which
  // still picks up a turn an agent-driven round recorded outside this page.
  const roomOpen = view !== null && view.table !== null
  useEffect(() => {
    if (!roomOpen) return
    const timer = window.setInterval(() => {
      void room().then((next) => { setView(next) }, () => {})
    }, view?.busy === true ? 200 : 2000)
    return () => { window.clearInterval(timer) }
  }, [roomOpen, view?.busy, room])

  // Follow the newest turn only while the reader is already at the bottom. The
  // growth of a streaming turn or a fresh poll re-renders constantly, and
  // scrolling on every render would drag a reader who scrolled up back down —
  // so an explicit scroll position, not the render, decides.
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const following = useRef(true)
  // How far above the bottom still counts as "at the bottom": enough to absorb
  // a line or two of growth between polls.
  const followSlack = 64
  const trackFollow = (): void => {
    const el = transcriptRef.current
    if (el === null) return
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= followSlack
  }
  useEffect(() => {
    const el = transcriptRef.current
    if (el === null || !following.current) return
    el.scrollTop = el.scrollHeight
  }, [view])

  const nameOf = (id: string): string => rosterMembers(
    rosters,
    // A table that has not been opened carries no seating, and the room always
    // names one once it has.
    /* v8 ignore next -- the queue only renders while a table is running */
    view?.table?.rosterId ?? table?.rosterId ?? '',
  ).find(identity => identity.id === id)?.name ?? id
  const phaseKey = view === null || view.phase === 'wait-user-open'
    ? 'phaseOpen'
    : view.phase === 'round' ? 'phaseRound' : 'phaseGuide'

  const submit = (): void => {
    const text = draft.trim()
    // The composer disables itself for an empty draft; the keyboard path is
    // the one that can still reach this.
    /* v8 ignore next -- the send control is disabled while the draft is empty */
    if (text === '') return
    setDraft('')
    // The newest entry is the user's own: follow again even after scrolling up.
    following.current = true
    void send(text).then((next) => { setView(next) }, () => { setFailed(true) })
  }

  /** The composer's mid-round action: stop the round, keep the draft, wait for the user. */
  const stopRound = (): void => {
    following.current = true
    void interrupt().then((next) => { setView(next) }, () => { setFailed(true) })
  }

  /**
   * Insert one seat's @-call at the caret.
   *
   * The host reads a call as `@` plus a token the message splits on whitespace,
   * and matches that token against the identity's display name or id
   * (`parseAtCall`), so a seat whose display name carries a space is called by
   * its id — writing its name would truncate at the space and call nobody.
   * @param identity - the seat the user picked.
   */
  const insertMention = (identity: RosterIdentity): void => {
    const token = /\s/u.test(identity.name) ? identity.id : identity.name
    const field = composerRef.current
    const start = field?.selectionStart ?? draft.length
    const end = field?.selectionEnd ?? start
    const lead = start === 0 || /\s$/u.test(draft.slice(0, start)) ? '' : ' '
    const mention = `${lead}@${token} `
    const next = draft.slice(0, start) + mention + draft.slice(end)
    const caret = start + mention.length
    setDraft(next)
    setMentionOpen(false)
    // The caret lands after the mention the state update is about to paint:
    // the refocus happens at the frame boundary so it reads the committed
    // value, and focusing here is what keeps the list's own focus return from
    // pulling the keyboard back onto the @ control.
    window.requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(caret, caret)
    })
  }

  const openTable = (config: RoundtableTableConfig, seed?: { sessionId: string; title: string }): void => {
    setOpenFailure(null)
    following.current = true
    void open(config, seed).then(
      // The room is the only source of the running table, so a host that
      // answered without one leaves the page on the closed reading.
      (next) => { setView(next); setTable(next.table) },
      (error: unknown) => { setOpenFailure(fill(t('openFailed'), { message: String(error) })) },
    )
  }

  const running = view?.table ?? null

  /**
   * The identities the @ list offers: exactly the seats of the running table,
   * the same roster the head strip shows. A mention narrows the next round to
   * one speaker, so an unseated identity would be a call nobody answers.
   */
  const seats = running === null ? [] : rosterMembers(rosters, running.rosterId)

  // While a speaker is generating, the composer's action stops the round rather
  // than sending: the engine is busy, and the user's next message is meant to
  // open a fresh round from a settled table.
  const interrupting = view?.busy === true

  return (
    <div className={css.page}>
      {failed
        ? (
          <p className={css.failure} role="alert">
            {`${t('error')} `}
            <button type="button" onClick={() => { setFailed(false); void reload().catch(() => { setFailed(true) }) }}>{t('retry')}</button>
          </p>
        )
        : null}
      {openFailure === null ? null : <p className={css.formError} role="alert">{openFailure}</p>}

      {historySelected !== null
        ? (
          <>
            <header className={css.head}>
              <div className={css.statusBar}>
                <span className={css.headTitle}>{t('archiveTitle')}</span>
                {archiveFailed
                  ? <span className={css.failure}>{t('archiveFailed')}</span>
                  : archive === null
                    ? <span className={css.busy}>{t('archiveLoading')}</span>
                    : (
                      <span className={css.queueChip}>
                        {`${archive.rosterName} · ${archive.depth === 'deep' ? t('depthDeep') : t('depthShallow')}`}
                        {` · ${archive.model} · ${archive.closedAt.slice(0, 16).replace('T', ' ')}`}
                        {archive.seedTitle !== undefined ? ` · ${fill(t('seedChip'), { title: archive.seedTitle })}` : ''}
                      </span>
                    )}
                <button type="button" className={css.reset} onClick={() => { selectArchive(null) }}>{t('archiveBack')}</button>
              </div>
            </header>
            <div className={css.transcript}>
              {archive === null || archiveFailed
                ? null
                : archive.transcript.length === 0
                  ? <p className={css.empty}>{t('empty')}</p>
                  : <TranscriptRounds transcript={archive.transcript} floor={null} t={t} />}
            </div>
          </>
        )
        : (
          <>
            <header className={css.head}>
              <div className={css.statusBar}>
                <span className={css.phase} data-phase={view?.phase}>{t(phaseKey)}</span>
                {running === null
                  ? <span className={css.queueChip}>{t('tableClosed')}</span>
                  : (
                    <span className={css.queueChip}>
                      {`${t('tableRoster')}: ${rosters.find(roster => roster.id === running.rosterId)?.name ?? running.rosterId}`}
                      {` · ${t('tableDepth')}: ${running.depth === 'deep' ? t('depthDeep') : t('depthShallow')}`}
                      {` · ${t('tableModel')}: ${running.model}`}
                      {running.seed !== undefined ? ` · ${fill(t('seedChip'), { title: running.seed.title })}` : ''}
                    </span>
                  )}
                {view?.busy === true ? <span className={css.busy}>{t('busyHint')}</span> : null}
                {view?.phase === 'round' && view.queue.length > 0
                  ? <span className={css.queueChip}>{`${t('queueLabel')}: ${view.queue.map(nameOf).join(' → ')}`}</span>
                  : null}
                {view !== null && view.rounds.length > 0
                  ? <span className={css.queueChip}>{fill(t('roundsLabel'), { count: String(view.rounds.length) })}</span>
                  : null}
                <button
                  type="button"
                  className={css.reset}
                  onClick={() => {
                    if (!window.confirm(t('resetConfirm'))) return
                    // The host answers with a released configuration, so the page falls
                    // back to the setup and the next table may differ.
                    void reset().then((next) => { setView(next) }, () => {})
                  }}
                >
                  {t('reset')}
                </button>
              </div>
              {running === null ? null : (
                <div className={css.roster} aria-label={t('rosterTitle')}>
                  {rosterMembers(rosters, running.rosterId).map(identity => (
                    <span key={identity.id} className={css.rosterChip} data-floor={String(view?.queue[0] === identity.id)}>
                      {identity.name}
                      {identity.builtin ? <span className={css.rosterBadge}>{t('builtinBadge')}</span> : null}
                    </span>
                  ))}
                </div>
              )}
            </header>

            {editing
              ? (
                <div className={css.setupPane}>
                  <RosterEditor
                    rosters={rosters}
                    t={t}
                    onClose={() => { setEditing(false) }}
                    onSave={async (drafts) => {
                      await saveRosters(drafts)
                      await reload()
                    }}
                  />
                </div>
              )
              : running === null && table !== null
                ? (
                  // The setup is the room's empty state: it opens the table
                  // itself, and no composer renders until one is open.
                  <div className={css.setupPane}>
                    <SetupPanel
                      rosters={rosters}
                      table={table}
                      models={options}
                      modelProblem={modelProblem}
                      seedChoices={seedChoices}
                      t={t}
                      onEditRoster={() => { setEditing(true) }}
                      onOpen={openTable}
                    />
                  </div>
                )
                : (
                <div className={css.transcript} ref={transcriptRef} onScroll={trackFollow}>
                  {view === null || (view.transcript.length === 0 && view.partial === null)
                    ? <p className={css.empty}>{t('empty')}</p>
                    : (
                      <>
                        <TranscriptRounds
                          transcript={view.transcript}
                          floor={view.busy ? view.queue[0] ?? null : null}
                          t={t}
                        />
                        {view.partial === null
                          ? null
                          : <StreamingTurn key={view.partial.speaker} partial={view.partial} t={t} />}
                      </>
                    )}
                </div>
              )}

            {running === null
              ? null
              : (
                <div className={css.composer}>
                  {/* The @ control and its list: the seats of the running table,
                      opened above the field (the composer sits on the room's
                      floor, so a list opening downward would leave the page).
                      A pick writes the call into the draft and returns the
                      caret to the field; Escape, a pick, or a pointer outside
                      closes the list. */}
                  <Menu
                    open={mentionOpen}
                    onClose={() => { setMentionOpen(false) }}
                    items={seats.map((identity, index) => ({ id: String(index), label: identity.name }))}
                    onSelect={(id) => {
                      const seat = seats[Number(id)]
                      /* v8 ignore next -- a row exists only for a seat the current roster still lists */
                      if (seat === undefined) return
                      insertMention(seat)
                    }}
                    side="top"
                    align="start"
                    portal
                    dense
                    className={css.mentionAnchor}
                    listClassName={css.mentionList}
                    anchor={(
                      <button
                        type="button"
                        className={css.mentionButton}
                        aria-label={t('mentionOpen')}
                        aria-haspopup="menu"
                        aria-expanded={mentionOpen}
                        // A room that names a roster this page no longer holds
                        // (edited away while the table runs) has no seat to
                        // call: the control stands down rather than opening an
                        // empty list.
                        disabled={seats.length === 0}
                        onClick={() => { setMentionOpen(open => !open) }}
                      >
                        @
                      </button>
                    )}
                  />
                  <textarea
                    ref={composerRef}
                    value={draft}
                    placeholder={t('sendPlaceholder')}
                    aria-label={interrupting ? t('interrupt') : t('send')}
                    onChange={(event) => { setDraft(event.currentTarget.value) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        if (interrupting) stopRound()
                        else submit()
                      }
                    }}
                  />
                  <button
                    type="button"
                    data-action={interrupting ? 'interrupt' : 'send'}
                    disabled={!interrupting && draft.trim() === ''}
                    onClick={interrupting ? stopRound : submit}
                  >
                    {interrupting ? t('interrupt') : t('send')}
                  </button>
                </div>
              )}
          </>
        )}
    </div>
  )
}

/** The seats one roster lists, or none when the roster is gone. */
function rosterMembers(rosters: readonly RoundtableRosterView[], rosterId: string): readonly RosterIdentity[] {
  return rosters.find(roster => roster.id === rosterId)?.members ?? []
}

/**
 * Every round of a transcript, each rendered as its own block so the round
 * structure is visible at a glance.
 * @param props.transcript - the entries to render, oldest first.
 * @param props.floor - the speaker id currently holding the floor, or null.
 * @param props.t - the page locale seat.
 * @returns one block per round.
 */
function TranscriptRounds({ transcript, floor, t }: {
  readonly transcript: readonly RoundtableEntry[]
  readonly floor: string | null
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  return (
    <>
      {groupRounds(transcript).map((round, index) => (
        <div key={String(index)} className={css.round}>
          {round.map((entry, at) => (
            <TranscriptEntry key={String(at)} entry={entry} floor={floor} t={t} />
          ))}
        </div>
      ))}
    </>
  )
}

/**
 * Split a flat transcript into rounds: a round opens at each user message and
 * runs to the next one. Notes the room adds before any user message lead a
 * round of their own.
 * @param transcript - the entries to group, oldest first.
 * @returns the rounds in order, each non-empty.
 */
function groupRounds(transcript: readonly RoundtableEntry[]): RoundtableEntry[][] {
  const rounds: RoundtableEntry[][] = []
  let current: RoundtableEntry[] | null = null
  for (const entry of transcript) {
    if (current === null || entry.kind === 'user') {
      current = [entry]
      rounds.push(current)
      continue
    }
    current.push(entry)
  }
  return rounds
}

/**
 * One transcript entry: its speaker head, thinking, speech, what a deep
 * speaker consulted, and its bottom bar. A user entry renders as the room's
 * own message, marked apart from the speakers by its own block styling; a
 * speaker turn renders as its own card, so a run of speakers reads as a stack
 * of messages rather than as one continuous text flow.
 * @param props.entry - the entry to render.
 * @param props.floor - the speaker id currently holding the floor, or null.
 * @param props.t - the page locale seat.
 * @returns the entry block.
 */
function TranscriptEntry({ entry, floor, t }: {
  readonly entry: RoundtableEntry
  readonly floor: string | null
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  return (
    <div
      className={css.entry}
      data-kind={entry.kind}
      data-floor={String(entry.kind === 'speaker' && entry.speaker === floor)}
      data-interrupted={entry.interrupted === true ? 'true' : undefined}
    >
      <div className={css.entryHead}>
        <span className={css.entryName}>{entry.kind === 'user' ? t('entryUser') : entry.name}</span>
      </div>
      {entry.kind === 'speaker'
        ? (
          <TurnActivity
            flow={entry.flow}
            reasoning={entry.reasoning}
            tools={entry.tools}
            t={t}
            // A stopped turn was being read expanded while it streamed; keeping its
            // thinking open is what makes the interrupted remainder fully readable.
            defaultOpen={entry.interrupted === true}
          />
        )
        : null}
      {entry.kind === 'user'
        ? <p className={css.entryTextPlain}>{entry.text}</p>
        : <EntryText text={entry.text} t={t} />}
      {entry.interrupted === true ? <p className={css.interruptedNote}>{t('interruptedNote')}</p> : null}
      {entry.truncated === true ? <p className={css.truncated}>{t('truncatedNote')}</p> : null}
      {entry.citations === undefined || entry.citations.length === 0
        ? null
        : <SourceList citations={entry.citations} t={t} />}
      <EntryFooter entry={entry} t={t} />
    </div>
  )
}

/** How long the copy action shows its success glyph, in ms (the session page's window). */
const COPIED_FEEDBACK_MS = 1_000

/**
 * Copy one entry's authored text with the session page's icon-swap feedback:
 * a short check swap after a successful write, gated so a re-click during the
 * window neither re-copies nor stacks timers.
 * @param text - the entry text to write; a speaker's is its Markdown source.
 * @returns the transient `copied` flag and the copy handler.
 */
function useEntryCopy(text: string): { readonly copied: boolean; readonly onCopy: () => void } {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      // A refused write (no clipboard grant) stays silent: the glyph is the
      // whole feedback, and a stale check would claim a copy that never landed.
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_FEEDBACK_MS)
    })
  }, [copied, text])
  return { copied, onCopy }
}

/**
 * How many tool calls one entry reports, read from the timeline when the turn
 * carries one and from the flattened list otherwise — the same precedence
 * {@link TurnActivity} renders under.
 * @param entry - the entry to count for.
 * @returns the number of calls the turn made.
 */
function entryToolCount(entry: RoundtableEntry): number {
  if (entry.flow !== undefined) return entry.flow.filter(item => item.kind === 'tool').length
  return entry.tools?.length ?? 0
}

/**
 * One entry's bottom bar: the session page's message footer at the room's
 * smaller scale — the copy action on the left, then the entry's own meta
 * right-aligned (the interrupted marker, the calls it made, the sources it
 * read, and the clock). The room records no token usage and no turn duration,
 * so the session page's two stat pills have no counterpart here.
 * A system note copies nothing — it is the room's own remark, not authored
 * text — so its bar carries the clock alone.
 * @param props.entry - the entry the bar belongs to.
 * @param props.t - the page locale seat.
 * @returns the entry's footer row.
 */
function EntryFooter({ entry, t }: {
  readonly entry: RoundtableEntry
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  const { copied, onCopy } = useEntryCopy(entry.text)
  const toolCount = entryToolCount(entry)
  const sourceCount = entry.citations?.length ?? 0
  const copyLabel = copied ? t('copied') : t('copy')
  return (
    <div className={css.foot}>
      {entry.kind === 'system'
        ? null
        : (
          <Tooltip label={copyLabel} side="bottom">
            <button type="button" className={css.footAction} aria-label={copyLabel} onClick={onCopy}>
              {copied ? <IconCheckOutlineMedium /> : <IconCopyOutlineMedium />}
            </button>
          </Tooltip>
        )}
      <div className={css.footMeta}>
        {entry.interrupted === true ? <span className={css.interrupted}>{t('interruptedLabel')}</span> : null}
        {toolCount === 0 ? null : (
          <span className={css.footStat}>{fill(t('toolsCount'), { count: String(toolCount) })}</span>
        )}
        {sourceCount === 0 ? null : (
          <span className={css.footStat}>{fill(t('sourcesCount'), { count: String(sourceCount) })}</span>
        )}
        <span className={css.footAt}>{entry.at.slice(11, 16)}</span>
      </div>
    </div>
  )
}

/** Localized chrome the shared Markdown renderer needs from this page's locale seat. */
function markdownLabels(t: RoundtablePageProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/**
 * One entry's text as the shared conversation Markdown renderer draws it: the
 * page no longer shows `**bold**` and `[title](url)` source characters. The
 * user's own message stays plain text — it is quoted back verbatim, not
 * authored prose — while every speaker turn (and a streaming one, with the
 * renderer's tolerance for markers still arriving) goes through this.
 * @param props.text - the entry's text.
 * @param props.streaming - whether the text is still growing; defaults to settled.
 * @param props.t - the page locale seat.
 * @returns the entry's Markdown block.
 */
function EntryText({ text, streaming = false, t }: {
  readonly text: string
  readonly streaming?: boolean
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  // Reference-stable per locale revision: a new identity discards the shared
  // renderer's streaming cache in the middle of a growing turn.
  const labels = useMemo(() => markdownLabels(t), [t])
  return (
    <div className={css.entryText}>
      <MarkdownText text={text} streaming={streaming} labels={labels} />
    </div>
  )
}

/**
 * What a deep speaker consulted, behind one collapsed row: sources are
 * reference material, not speech, so the room shows their count until the
 * reader asks for the list. A web address renders as its short destination —
 * the full URL rides the `title` — so one long link can never run across the
 * transcript.
 * @param props.citations - the turn's sources, in the order it consulted them.
 * @param props.t - the page locale seat.
 * @returns the collapsed source list.
 */
function SourceList({ citations, t }: {
  readonly citations: readonly RoundtableCitation[]
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.sources}>
      <DisclosureRow
        icon={<IconLinkOutlineRegular size={14} />}
        title={fill(t('sourcesCount'), { count: String(citations.length) })}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        rowClassName={css.sourcesRow}
        titleClassName={css.sourcesTitle}
      >
        <ul className={css.sourceList}>
          {citations.map((citation, index) => (
            <li key={`${citation.tool}-${String(index)}`} className={css.sourceItem}>
              <span className={css.sourceTool}>{toolTitle(citation.tool, t)}</span>
              <SourceLabel label={citation.label} />
            </li>
          ))}
        </ul>
      </DisclosureRow>
    </div>
  )
}

/**
 * One source's destination: a page link when the label is an absolute HTTP(S)
 * address, otherwise the label as text (a search query or a file path), always
 * on one ellipsized line.
 * @param props.label - the label the citation recorded.
 * @returns the destination, or null for an empty label.
 */
function SourceLabel({ label }: { readonly label: string }): ReactNode {
  if (label === '') return null
  const link = webAddress(label)
  if (link === null) return <span className={css.sourceText} title={label}>{label}</span>
  return (
    <a
      className={css.sourceLink}
      href={link.href}
      title={link.href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {link.text}
    </a>
  )
}

/**
 * Reduce a citation label to a linkable web destination: the host and a
 * bounded path, never the full URL.
 * @param label - the citation label.
 * @returns the href plus its short display text, or null for a non-web label.
 */
function webAddress(label: string): { href: string; text: string } | null {
  let url: URL
  try {
    url = new URL(label)
  } catch {
    // A search query, a file path, or any other non-absolute label: new URL
    // has no other failure mode for a string.
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.replace(/^www\./, '')
  const path = url.pathname.replace(/\/$/, '')
  return {
    href: label,
    text: path === '' || path.length <= SOURCE_PATH_MAX_CHARS
      ? `${host}${path}`
      : `${host}${path.slice(0, SOURCE_PATH_MAX_CHARS)}…`,
  }
}

/**
 * The tool calls one turn made, in call order: a compact line per call in the
 * session page's tool-row idiom — a state dot, the action's name, one line
 * naming what it acted on, and the call's state. Expanding a line shows the
 * arguments the model emitted.
 * @param props.tools - the turn's calls, oldest first.
 * @param props.t - the page locale seat.
 * @returns the calls' lines, or null when the turn made none.
 */
function ToolActivityList({ tools, t }: {
  readonly tools: readonly RoundtableToolActivity[]
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  if (tools.length === 0) return null
  return (
    <div className={css.tools} aria-label={t('toolsLabel')}>
      {tools.map((tool, index) => <ToolActivityLine key={`${tool.key}-${String(index)}`} tool={tool} t={t} />)}
    </div>
  )
}

/**
 * One tool call: the row's state, title, subject, and — on demand — the
 * arguments. The body is the raw argument JSON in a monospace block, capped so
 * one oversized call cannot dominate the room.
 * @param props.tool - the call to render.
 * @param props.t - the page locale seat.
 * @returns the call's row.
 */
function ToolActivityLine({ tool, t }: {
  readonly tool: RoundtableToolActivity
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const title = toolTitle(tool.name, t)
  // A running call has no subject yet (the window reports it only once the
  // call settles), so the state chip carries the row until it does.
  const summary = tool.summary
  const args = tool.arguments.slice(0, TOOL_ARGUMENT_MAX_CHARS)
  const expandable = args !== ''
  return (
    <div className={css.tool} data-state={tool.status}>
      <DisclosureRow
        icon={<StateDot state={toolDotState(tool.status)} size={8} />}
        title={title}
        open={open}
        expandable={expandable}
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        rowClassName={css.toolRow}
        titleClassName={css.toolTitle}
        collapsedContent={(
          <>
            {summary === '' ? null : <span className={css.toolSummary}>{summary}</span>}
            <span className={css.toolState}>{toolStatusLabel(tool.status, t)}</span>
          </>
        )}
      >
        <div className={css.toolBody}>
          <span className={css.toolBodyLabel}>{t('toolArgumentsLabel')}</span>
          <pre className={css.toolCode}>{args}</pre>
        </div>
      </DisclosureRow>
    </div>
  )
}

/**
 * The turn a speaker is writing right now: the room publishes the deltas it has
 * folded so far as `partial`, and this renders them as the entry that is still
 * growing — thinking and the calls its window makes interleaved as they happen,
 * then speech. Mounted with the speaker id as its key, so the thinking
 * disclosure opens once per turn instead of collapsing again on every poll.
 * @param props.partial - the in-flight turn the room reported.
 * @param props.t - the page locale seat.
 * @returns the streaming entry block.
 */
function StreamingTurn({ partial, t }: {
  readonly partial: RoundtablePartial
  readonly t: RoundtablePageProps['t']
}): ReactNode {
  return (
    <div className={css.entry} data-kind="speaker" data-streaming="true" data-floor="true">
      <div className={css.entryHead}>
        <span className={css.entryName}>{partial.name}</span>
        <span className={css.streaming}>{t('streamingLabel')}</span>
      </div>
      <TurnActivity flow={partial.flow} reasoning={partial.reasoning} tools={partial.tools} t={t} defaultOpen streaming />
      <EntryText text={partial.text} streaming t={t} />
    </div>
  )
}

/**
 * A speaker turn's process, as one unit: with a `flow` timeline the thinking
 * and the calls are drawn interleaved in the order they happened; without one
 * (an archive written before the field existed, or a reader talking to an
 * older engine) the flattened reasoning and tool list render as they always
 * did.
 * @param props.flow - the turn's interleaved timeline, when the engine sent one.
 * @param props.reasoning - the flattened thinking, used when there is no timeline.
 * @param props.tools - the flattened call list, used when there is no timeline.
 * @param props.t - the page locale seat.
 * @param props.defaultOpen - whether the thinking disclosure starts expanded.
 * @param props.streaming - whether the turn is still growing.
 * @returns the turn's process block, or null when it has none.
 */
function TurnActivity({ flow, reasoning, tools, t, defaultOpen = false, streaming = false }: {
  readonly flow?: readonly RoundtableFlowItem[] | undefined
  readonly reasoning?: string | undefined
  readonly tools?: readonly RoundtableToolActivity[] | undefined
  readonly t: RoundtablePageProps['t']
  readonly defaultOpen?: boolean
  readonly streaming?: boolean
}): ReactNode {
  if (flow !== undefined) return <FlowDisclosure flow={flow} t={t} defaultOpen={defaultOpen} streaming={streaming} />
  return (
    <>
      <ReasoningDisclosure text={reasoning ?? ''} t={t} defaultOpen={defaultOpen} />
      {tools === undefined ? null : <ToolActivityList tools={tools} t={t} />}
    </>
  )
}

/**
 * One turn's activity timeline inside the thinking disclosure: each stretch of
 * thinking renders as compact Markdown, and each call sits where it happened,
 * as the same compact tool row the flattened list used. A timeline with calls
 * but no thinking renders as the plain tool list instead, so a "Thinking"
 * disclosure never titles rows that hold no thinking.
 * @param props.flow - the turn's interleaved timeline, oldest first.
 * @param props.t - the page locale seat.
 * @param props.defaultOpen - whether the disclosure starts expanded.
 * @param props.streaming - whether the turn is still growing; the last segment
 *   parses incrementally while it does.
 * @returns the timeline block.
 */
function FlowDisclosure({ flow, t, defaultOpen = false, streaming = false }: {
  readonly flow: readonly RoundtableFlowItem[]
  readonly t: RoundtablePageProps['t']
  readonly defaultOpen?: boolean
  readonly streaming?: boolean
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen)
  // Reference-stable per locale revision: a new identity discards the shared
  // renderer's streaming cache in the middle of a growing segment.
  const labels = useMemo(() => markdownLabels(t), [t])
  const thinking = flow.filter(item => item.kind === 'reasoning' && item.text !== '')
  if (thinking.length === 0) {
    return <ToolActivityList tools={flow.flatMap(item => item.kind === 'tool' ? [item.tool] : [])} t={t} />
  }
  return (
    <div className={css.reasoning}>
      <DisclosureRow
        icon={<IconThinkOutlineRegular size={14} />}
        title={t('reasoningLabel')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        rowClassName={css.reasoningRow}
        titleClassName={css.reasoningTitle}
      >
        <div className={css.flow}>
          {flow.map((item, index) => item.kind === 'reasoning'
            ? item.text === ''
              ? null
              : (
                <div key={`reasoning-${String(index)}`} className={css.flowReasoning}>
                  <MarkdownText text={item.text} streaming={streaming && index === flow.length - 1} labels={labels} />
                </div>
              )
            : <ToolActivityLine key={`tool-${item.tool.key}`} tool={item.tool} t={t} />)}
        </div>
      </DisclosureRow>
    </div>
  )
}

/**
 * One speaker turn's thinking, a muted disclosure above the speech. Collapsed
 * by default: the thinking is the speaker's own working, not part of the
 * table's shared record. A turn still streaming opens it, so the thinking is
 * read as it arrives.
 * @param props.text - the speaker's reasoning text.
 * @param props.t - the page locale seat.
 * @param props.defaultOpen - whether the disclosure starts expanded; defaults to collapsed.
 * @returns the reasoning disclosure, or null for an empty one.
 */
export function ReasoningDisclosure({ text, t, defaultOpen = false }: {
  readonly text: string
  readonly t: RoundtablePageProps['t']
  readonly defaultOpen?: boolean
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen)
  if (text === '') return null
  return (
    <div className={css.reasoning}>
      <DisclosureRow
        icon={<IconThinkOutlineRegular size={14} />}
        title={t('reasoningLabel')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        rowClassName={css.reasoningRow}
        titleClassName={css.reasoningTitle}
      >
        <p className={css.reasoningBody}>{text}</p>
      </DisclosureRow>
    </div>
  )
}
