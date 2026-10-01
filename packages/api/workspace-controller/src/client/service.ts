/** React-free Client Workspace service and command facade. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorkspaceView } from '../types.ts'
import type { ClientWorkspaceModel, WorkspaceSnapshot } from './model.ts'

/** Structured create failure for callers that distinguish Host business errors. */
export class WorkspaceCreateError extends Error {
  override readonly name = 'WorkspaceCreateError'

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`workspace create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/**
 * Structured project-directory failure. The Host is the authority on what a
 * usable directory is (absolute, and creatable when missing), so its message is
 * the caller-facing one and `rpcError.code` lets a surface branch on
 * `workspace/invalid-project-dir`.
 */
export class WorkspaceProjectDirError extends Error {
  override readonly name = 'WorkspaceProjectDirError'

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(rpcError.message)
  }
}

/** Bare observable source for the Workspace Controller snapshot. */
export interface WorkspaceSource {
  /** Read the identity-stable current snapshot. */
  getSnapshot(): WorkspaceSnapshot
  /**
   * Subscribe to snapshot changes.
   * @param listener - invalidation callback.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void
}

/** Workspace Controller's Client service face. */
export interface IWorkspaces {
  /** Host-authoritative Workspace rows, order, archive set, and follow lifecycle. */
  readonly list: WorkspaceSource
  /**
   * Register an existing path as a Workspace.
   * @param input - Host create payload.
   * @returns the created or idempotently resolved Workspace.
   */
  create(input: { path: string }): Promise<WorkspaceView>
  /**
   * Create a named project, optionally over a caller-chosen working directory.
   * @param input - Host create-project payload.
   * @returns the created project.
   */
  createProject(input: { name: string; path?: string }): Promise<WorkspaceView>
  /**
   * Rename a Workspace.
   * @param workspaceId - target Workspace.
   * @param title - new display title.
   * @returns the renamed Workspace.
   */
  rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView>
  /**
   * Repoint a project's directory at an absolute path. The Host materializes
   * the directory tree before it records the override, so a path that is not
   * fully qualified or cannot be created rejects with
   * {@link WorkspaceProjectDirError}.
   * @param workspaceId - target Workspace.
   * @param path - absolute directory to adopt.
   * @returns the updated Workspace.
   */
  setProjectDir(workspaceId: WorkspaceId, path: string): Promise<WorkspaceView>
  /**
   * Clear a project's directory override back to the derived default.
   * @param workspaceId - target Workspace.
   * @returns the updated Workspace.
   */
  resetProjectDir(workspaceId: WorkspaceId): Promise<WorkspaceView>
  /**
   * Delete a Workspace registration without deleting Sessions or files.
   * @param workspaceId - target Workspace.
   */
  delete(workspaceId: WorkspaceId): Promise<void>
  /**
   * Move a Workspace within the Host registry order.
   * @param workspaceId - Workspace to move.
   * @param beforeWorkspaceId - anchor Workspace; omitted appends.
   */
  insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
  /**
   * Archive a Session from Workspace grouping surfaces.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Restore an archived Session to Workspace grouping surfaces.
   * @param sessionId - Session to restore.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Move a Session within one Workspace account.
   * @param workspaceId - owning Workspace.
   * @param sessionId - Session to move.
   * @param beforeSessionId - anchor Session; omitted appends.
   * @returns the changed Workspace.
   */
  insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView>
}

/** Owns the bare Workspace snapshot and Workspace-only commands. */
export class WorkspaceController extends Service implements IWorkspaces {
  readonly list: WorkspaceSource

  /**
   * @param ctx - Client root Context.
   * @param model - Remote-backed Workspace state model.
   */
  constructor(ctx: Context, private readonly model: ClientWorkspaceModel) {
    super(ctx, 'workspaces')
    this.list = model
  }

  async create(input: { path: string }): Promise<WorkspaceView> {
    const result = await this.model.create(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value.workspace
  }

  async createProject(input: { name: string; path?: string }): Promise<WorkspaceView> {
    const result = await this.model.createProject(input)
    if (!result.ok) throw new WorkspaceCreateError(result.error)
    return result.value
  }

  async rename(workspaceId: WorkspaceId, title: string): Promise<WorkspaceView> {
    const result = await this.model.rename(workspaceId, title)
    if (!result.ok) throw commandError('rename', result.error)
    return result.value.workspace
  }

  async delete(workspaceId: WorkspaceId): Promise<void> {
    const result = await this.model.delete(workspaceId)
    if (!result.ok) throw commandError('delete', result.error)
  }

  async setProjectDir(workspaceId: WorkspaceId, path: string): Promise<WorkspaceView> {
    const result = await this.model.setProjectDir(workspaceId, path)
    if (!result.ok) throw new WorkspaceProjectDirError(result.error)
    return result.value.workspace
  }

  async resetProjectDir(workspaceId: WorkspaceId): Promise<WorkspaceView> {
    const result = await this.model.resetProjectDir(workspaceId)
    if (!result.ok) throw new WorkspaceProjectDirError(result.error)
    return result.value.workspace
  }

  async insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void> {
    const result = await this.model.insertBefore(workspaceId, beforeWorkspaceId)
    if (!result.ok) throw commandError('reorder', result.error)
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.archiveSession(sessionId)
    if (!result.ok) throw commandError('session archive', result.error)
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    const result = await this.model.unarchiveSession(sessionId)
    if (!result.ok) throw commandError('session unarchive', result.error)
  }

  async insertSessionBefore(
    workspaceId: WorkspaceId,
    sessionId: SessionId,
    beforeSessionId?: SessionId,
  ): Promise<WorkspaceView> {
    const result = await this.model.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    if (!result.ok) throw commandError('move', result.error)
    return result.value.workspace
  }
}

function commandError(operation: string, failure: RemoteFailure): Error {
  return new Error(`workspace ${operation} failed: ${failure.code}: ${failure.message}`)
}
