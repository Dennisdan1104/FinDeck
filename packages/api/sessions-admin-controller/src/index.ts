/**
 * Host Remote owner for stored-session administration over the durable
 * Session store: one row per stored artifact — identity, title, whole-log
 * turn/step counts, last activity, workspace, and physical size — and the
 * permanent removal of one stored Session.
 *
 * This is the management sibling of `session.list()`: it reads the persistence
 * store directly rather than the live Session registry, so it also describes a
 * stored Session this process never opened, and it carries the two facts a
 * conversation list has no reason to pay for — the artifact's byte size and
 * its whole-log counts. Title and counts come from the projection cache's
 * checkpoint when a Session is cold, so listing never opens a log; a Session
 * whose projections were never checkpointed is still listed, with the
 * unavailable fields absent rather than invented.
 *
 * Removal is delegated to the persistence backend, which owns the artifact
 * layout and the write lock that proves no writer still owns the Session.
 *
 * @module @deepseek-ai/dsh-api-sessions-admin-controller
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the `sessionListMetadata` projection declaration this
// controller reads for last-activity time, and the `api-session/removed`
// forwarded event it emits.
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
// Type-only: resolves the `ctx.sessionProjectionCache` merge this controller reads.
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type { ProjectionSnapshot, SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves the `sessionStats` projection declaration (turns and steps).
import type {} from '@deepseek-ai/dsh-session-stats/types'
// Type-only: resolves the `title` projection declaration.
import type {} from '@deepseek-ai/dsh-session-title/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionsAdminEntry,
  SessionsAdminListValue,
  SessionsAdminRemoveRequest,
} from './types.ts'

export type * from './types.ts'

/** Projection rows one administration entry is built from. */
const PROJECTION_KEYS = [
  'title',
  'sessionStats',
  'sessionListMetadata',
] as const satisfies readonly Extract<keyof SessionProjectionMap, string>[]

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `sessionsAdmin` Remote namespace. */
    sessionsAdmin: SessionsAdminController
  }
}

/**
 * Host service backing the generated `ctx.remote.sessionsAdmin` namespace.
 * Every mutation answers with the whole list, so one round trip leaves the
 * page consistent instead of making the caller fold a delta.
 */
export class SessionsAdminController extends TypertRemoteService {
  static inject = ['sessionPersistence', 'sessions', 'sessionProjections']

  /** @param ctx - Host context carrying the persistence and projection services. */
  constructor(ctx: Context) {
    super(ctx, 'sessionsAdmin', { namespace: 'sessionsAdmin' })
  }

  /**
   * List every stored Session, most recently active first.
   * @returns one row per artifact this Host can describe; a row whose
   *   projections were never checkpointed omits the fields they supply.
   */
  @Remote
  async list(): Promise<SessionsAdminListValue> {
    const items = (await this.ctx.sessionPersistence.list()).map(snapshot => this.entryFor(snapshot))
    items.sort((left, right) => right.updatedAt - left.updatedAt)
    return { items }
  }

  /**
   * Permanently discard one stored Session and answer with the resulting list.
   *
   * Named `deleteSession` rather than `remove` because the browser's Remote
   * namespace service owns `remove(kind, method, token)` for its own method
   * ledger; a Remote method of that name fails every namespace mount at once.
   * @param request - the Session whose durable artifact is removed.
   * @returns the list after the removal.
   * @throws RemoteError when the Session is open in this process or another
   *   process holds its write lock (`sessions-admin/open` and
   *   `sessions-admin/owned`), or when no stored Session carries the id
   *   (`sessions-admin/not-found`).
   */
  @Remote
  async deleteSession(request: SessionsAdminRemoveRequest): Promise<SessionsAdminListValue> {
    const sessionId = request.sessionId
    if (this.ctx.sessions.get(sessionId) !== undefined) {
      throw new RemoteError(
        'sessions-admin/open',
        `session "${sessionId}" is open in this server; close it before removing it`,
        { sessionId },
      )
    }
    let removed: boolean
    try {
      removed = await this.ctx.sessionPersistence.remove(sessionId)
    } catch (error: unknown) {
      if (error instanceof SessionAlreadyOwnedError) {
        throw new RemoteError('sessions-admin/owned', error.message, { sessionId })
      }
      throw new RemoteError(
        'gateway/internal',
        `removing session "${sessionId}" failed: ${messageOf(error)}`,
        {},
      )
    }
    if (!removed) {
      throw new RemoteError(
        'sessions-admin/not-found',
        `session "${sessionId}" is not stored on this server`,
        { sessionId },
      )
    }
    // Every connected browser drops the row through the same forwarded event a
    // disposed live Session produces; no other surface derives the id.
    this.ctx.emit('api-session/removed', sessionId)
    return await this.list()
  }

  /** Project one stored-session observation onto the administration view. */
  private entryFor(snapshot: SessionPersistenceSnapshot): SessionsAdminEntry {
    const header = snapshot.header
    const values = this.projectionsFor(header)?.values
    const listed = values?.sessionListMetadata
    const stats = values?.sessionStats
    const title = values?.title
    const lastPromptAt = typeof listed?.lastPromptAt === 'number' ? listed.lastPromptAt : 0
    return {
      sessionId: header.id,
      createdAt: header.createdAt,
      updatedAt: Math.max(header.createdAt, lastPromptAt),
      open: this.ctx.sessions.get(header.id) !== undefined,
      ...title === undefined || title === null ? {} : { title },
      ...stats === undefined ? {} : { turns: stats.turns, steps: stats.steps },
      ...header.cwd === undefined ? {} : { cwd: header.cwd },
      ...snapshot.sizeBytes === undefined ? {} : { sizeBytes: snapshot.sizeBytes },
    }
  }

  /**
   * Read the projection block one stored Session's row is built from: the live
   * cut for an open Session, and the cache's zero-I/O checkpoint for a cold
   * one. A checkpoint that cannot be read or fails its schema leaves the row
   * without projection fields instead of failing the whole list.
   * @param header - the listed Session's header (the cache's lifecycle identity witness).
   * @returns the block, or undefined when this Session has no readable checkpoint.
   */
  private projectionsFor(header: SessionHeader): ProjectionSnapshot | undefined {
    const live = this.ctx.sessions.get(header.id)
    try {
      if (live !== undefined) return this.ctx.sessionProjections.snapshot(live, PROJECTION_KEYS)
      // A seeded Session's inherited cut is not zero, so its checkpoint cannot
      // be addressed from the header alone; only its title is exposed, through
      // the dedicated predecessor read.
      if (header.isSeeded) return undefined
      const cache = this.ctx.get('sessionProjectionCache')
      return cache?.cachedSnapshot(header, SessionLogOffset(0), PROJECTION_KEYS)
        ?? cache?.cachedPredecessorTitle(header, SessionLogOffset(0))
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `sessions-admin: projection column for "${header.id}" failed; serving the row without it: ${messageOf(error)}`,
      )
      return undefined
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default SessionsAdminController
