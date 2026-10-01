/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /** Canonical host directory path. */
  readonly path: string
  /** User-visible title. */
  readonly title: string
  /**
   * Whether this is the built-in default Workspace: sessions created without
   * an explicit Workspace land here.
   */
  readonly isDefault: boolean
  /**
   * Resolved project directory: the custom override when one is set, otherwise
   * the derived default `<home>/projects/<workspaceId>`.
   */
  readonly projectDir: string
  /** Whether `projectDir` is a user override rather than the derived default. */
  readonly projectDirCustom: boolean
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested directory cannot back a Workspace. */
    'workspace/invalid-path': { readonly path: string }
    /** A project creation carried a blank name. */
    'workspace/invalid-project-name': { readonly name: string }
    /** Another Workspace already uses the requested name. */
    'workspace/name-conflict': { readonly name: string }
    /** The requested project directory is not fully qualified, or cannot be created. */
    'workspace/invalid-project-dir': { readonly workspaceId: WorkspaceId; readonly path: string }
    /** The Session or its anchor is not in the Workspace's manual order. */
    'workspace/move-invalid': {
      readonly workspaceId: WorkspaceId
      readonly sessionId: SessionId
      readonly beforeSessionId?: SessionId
    }
    /** The verb needs an interaction the composed backend does not serve. */
    'directory-picker/unavailable': { readonly capability: string }
    /** The target is not fully qualified, or the backend cannot list it. */
    'directory-picker/unreadable': { readonly path: string }
    /** A child of that name is already there. */
    'directory-picker/exists': { readonly path: string }
    /** The parent is not fully qualified, the name is not one segment, or creation failed. */
    'directory-picker/create-failed': { readonly path: string }
  }
}

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** Named new project, with an optional working directory to adopt. */
export interface WorkspaceCreateProjectRequest {
  /** Non-blank display name; stored as the project title. */
  readonly name: string
  /** Fully qualified working directory; omitted derives and creates `<home>/projects/<uuid>`. */
  readonly path?: string
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Archived Session requested for restoration to Workspace grouping surfaces. */
export interface WorkspaceUnarchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Workspace project-directory repoint. */
export interface WorkspaceSetProjectDirRequest {
  readonly workspaceId: WorkspaceId
  /** Absolute directory the Workspace's project data moves to. */
  readonly path: string
}

/** Workspace project-directory reset back to the derived default. */
export interface WorkspaceResetProjectDirRequest {
  readonly workspaceId: WorkspaceId
}

/** Workspace whose project directory is materialized on demand. */
export interface WorkspaceEnsureProjectRequest {
  readonly workspaceId: WorkspaceId
}

/** Materialized project directory and its managed subdirectories. */
export interface WorkspaceProjectDirValue {
  /** Resolved absolute project directory. */
  readonly projectDir: string
  /** Whether each managed subdirectory exists after materialization. */
  readonly subdirectories: {
    readonly memory: boolean
    readonly presets: boolean
    readonly automations: boolean
  }
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** One ordered Workspace change after a generation's baseline. */
export type WorkspaceFollowIncrement =
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement
