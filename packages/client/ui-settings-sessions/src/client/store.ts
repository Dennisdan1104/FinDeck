/**
 * Sessions settings page store: the Host's stored-session inventory plus the
 * one in-flight administration action. The Host stays the single fact source —
 * a removal answers with the whole list, and a rename republishes it after the
 * title write lands — so the page renders from one accepted answer instead of
 * folding a delta.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  SessionId, SessionsAdminEntry, SessionsAdminListValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Origin-relative download route owned by `@deepseek-ai/dsh-session-log-export`. */
const SESSION_EXPORT_PATH = '/api/session.export'

/** Page snapshot. */
export interface SessionsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; a failed single action reports through its own return value. */
  error: string | null
  /** Every stored session, most recently active first. */
  entries: readonly SessionsAdminEntry[]
  /** Session whose rename or removal is in flight; every row's actions stay disabled while set. */
  busySessionId: SessionId | null
}

/** The sessions settings page controller (one per settings surface). */
export class SessionsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<SessionsSettingsState> = createSnapshotStore<SessionsSettingsState>({
    status: 'idle', error: null, entries: [], busySessionId: null,
  })

  /** Latest load wins; a superseded read never overwrites a newer one. */
  private generation = 0

  /**
   * @param ctx - the page plugin's context, whose `remote.sessionsAdmin`
   * namespace carries the inventory and the removal, and whose
   * `remote.session` namespace carries the existing rename verb.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Refresh the whole stored-session inventory.
   * @returns settlement after the answer is published either way.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    const response = await this.ctx.remote.sessionsAdmin.list()
    if (generation !== this.generation) return
    if (!response.ok) {
      this.store.update((state) => { state.status = 'error'; state.error = response.error.message })
      return
    }
    this.adopt(response.value)
  }

  /**
   * Store one explicit title on a stored session. The title write is the
   * existing per-session verb, so this page never re-implements it; the
   * inventory is re-read afterwards because renaming opens the session on the
   * Host, which its row reports.
   * @param sessionId - the session to rename.
   * @param title - raw title text; the Host normalizes acceptance.
   * @returns the failure message, or undefined once the title was accepted.
   */
  async rename(sessionId: SessionId, title: string): Promise<string | undefined> {
    this.store.update((state) => { state.busySessionId = sessionId })
    try {
      const result = await this.ctx.remote.session.rename({ sessionId, title })
      if (!result.ok) return result.error.message
    } finally {
      this.store.update((state) => { state.busySessionId = null })
    }
    await this.load()
    return undefined
  }

  /**
   * Permanently remove one stored session from the Host.
   * @param sessionId - the session whose stored log is discarded.
   * @returns the failure message, or undefined once the Host accepted the removal.
   */
  async remove(sessionId: SessionId): Promise<string | undefined> {
    this.store.update((state) => { state.busySessionId = sessionId })
    try {
      const result = await this.ctx.remote.sessionsAdmin.deleteSession({ sessionId })
      if (!result.ok) return result.error.message
      this.adopt(result.value)
    } finally {
      this.store.update((state) => { state.busySessionId = null })
    }
    return undefined
  }

  /**
   * Hand one session's stored log to the browser download manager. The Host
   * route already streams a canonical-JSONL archive of any size, so the page
   * links to it instead of reading the log through a Remote.
   * @param sessionId - the session whose log is downloaded.
   */
  exportSession(sessionId: SessionId): void {
    const url = `${SESSION_EXPORT_PATH}?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=false`
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = ''
    anchor.click()
  }

  /** Publish one accepted answer's inventory over the current snapshot. */
  private adopt(value: SessionsAdminListValue): void {
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.entries = value.items
    })
  }
}
