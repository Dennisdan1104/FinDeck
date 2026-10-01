/**
 * Browser-safe vocabulary of the stored-session administration surface: one
 * row per durable Session artifact the settings page manages, plus the
 * removal request. These are storage facts — identity, size, whole-log counts,
 * and the workspace path a Session was created in — never conversation
 * content.
 *
 * @module @deepseek-ai/dsh-api-sessions-admin-controller/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The addressed Session is open in this Host process, so its artifact is still owned by a writer. */
    'sessions-admin/open': { readonly sessionId: SessionId }
    /** No stored Session carries the addressed identity. */
    'sessions-admin/not-found': { readonly sessionId: SessionId }
    /** Another process holds the Session's write lock, so its artifact was not removed. */
    'sessions-admin/owned': { readonly sessionId: SessionId }
  }
}

/**
 * One stored Session as the administration surface lists it. Every field
 * except the identity, its creation time, and removal state comes from a
 * projection row; a Session whose projections were never checkpointed is
 * still listed, with the unavailable fields absent rather than invented.
 */
export interface SessionsAdminEntry {
  /** Durable Session identity. */
  readonly sessionId: SessionId
  /** Latest accepted title; absent when no title projection row exists for this Session. */
  readonly title?: string
  /** Durable header creation time, epoch milliseconds. */
  readonly createdAt: number
  /**
   * Last activity time, epoch milliseconds: the later of {@link createdAt} and
   * the newest human prompt recorded in the Session-list metadata projection.
   */
  readonly updatedAt: number
  /** Whole-log turns carrying at least one closed step; absent when the stats projection has no row. */
  readonly turns?: number
  /** Whole-log closed steps; absent when the stats projection has no row. */
  readonly steps?: number
  /** Working directory the Session was created in; absent for a Session with no recorded cwd. */
  readonly cwd?: string
  /** Physical artifact size in bytes; absent for a Session that never materialized on disk. */
  readonly sizeBytes?: number
  /**
   * Whether the Session is open in this Host process. An open Session owns its
   * durable artifact and cannot be removed until it is closed.
   */
  readonly open: boolean
}

/** Every stored Session this Host can describe, most recently active first. */
export interface SessionsAdminListValue {
  readonly items: readonly SessionsAdminEntry[]
}

/** Request to discard one stored Session permanently. */
export interface SessionsAdminRemoveRequest {
  readonly sessionId: SessionId
}
