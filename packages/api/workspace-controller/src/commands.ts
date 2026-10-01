/** Workspace command implementation and stable Remote failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceProjectDirInvalidError,
  WorkspaceProjectNameInvalidError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceEnsureProjectRequest,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceProjectDirValue,
  WorkspaceRenameRequest,
  WorkspaceResetProjectDirRequest,
  WorkspaceSetProjectDirRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceValue,
  WorkspaceView,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  /** Whether one workspace is the registry's built-in default. */
  private isDefault(workspace: Workspace): boolean {
    return this.ctx.workspaceRegistry.defaultWorkspace()?.id === workspace.id
  }

  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
        if (existing !== undefined) {
          return { workspace: workspaceView(existing, this.isDefault(existing)), created: false }
        }
        const workspace = await this.ctx.workspaceRegistry.create(request.path)
        return { workspace: workspaceView(workspace, this.isDefault(workspace)), created: true }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
          { cause: error },
        )
      }
    })
  }

  /**
   * Create one named project, optionally over a caller-chosen directory.
   *
   * A blank name is the caller's error (`workspace/invalid-project-name`); an
   * unqualified or uncreatable working directory reuses the create path's
   * `workspace/invalid-path` failure. The registry materializes the project
   * directory tree before this resolves.
   * @param request - project name and optional working directory.
   * @returns the created project projection.
   */
  createProject(request: WorkspaceCreateProjectRequest): Promise<WorkspaceView> {
    return this.enqueue(async () => {
      try {
        const workspace = await this.ctx.workspaceRegistry.createProject(request)
        return workspaceView(workspace, this.isDefault(workspace))
      } catch (error) {
        if (error instanceof WorkspaceProjectNameInvalidError) {
          throw new RemoteError(
            'workspace/invalid-project-name',
            error.message,
            { name: error.projectName },
            { cause: error },
          )
        }
        if (error instanceof WorkspaceProjectDirInvalidError) {
          throw new RemoteError(
            'workspace/invalid-path',
            error.message,
            { path: error.projectDir },
            { cause: error },
          )
        }
        throw error
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(new RemoteError('gateway/bad-request', 'Workspace rename requires a non-blank title', {}))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw new RemoteError(
            'workspace/name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: workspaceView(workspace, this.isDefault(workspace)) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw new RemoteError(
        'workspace/move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace, this.isDefault(workspace)) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Restore one archived Session to the grouping surfaces.
   * @param request - Session identity to restore.
   * @returns the complete resulting archive set.
   */
  async unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    await this.ctx.workspaceRegistry.unarchiveSession(request.sessionId)
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Repoint one Workspace's project directory at an absolute custom path.
   * @param request - Workspace identity and the directory to adopt.
   * @returns the updated Workspace projection.
   */
  setProjectDir(request: WorkspaceSetProjectDirRequest): Promise<WorkspaceValue> {
    return this.applyProjectDir(request.workspaceId, request.path)
  }

  /**
   * Restore one Workspace's derived default project directory.
   * @param request - Workspace identity to reset.
   * @returns the updated Workspace projection.
   */
  resetProjectDir(request: WorkspaceResetProjectDirRequest): Promise<WorkspaceValue> {
    return this.applyProjectDir(request.workspaceId, undefined)
  }

  /**
   * Materialize one Workspace's project directory tree on demand. Idempotent;
   * the derived default is never written to the record.
   * @param request - Workspace identity to materialize.
   * @returns the resolved project directory and its subdirectory state.
   */
  ensureProject(request: WorkspaceEnsureProjectRequest): Promise<WorkspaceProjectDirValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    return this.projectDirValueOf(workspace.id)
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  /**
   * Repoint one Workspace's project directory durably, mapping the registry's
   * caller-correctable failures onto the stable Remote code.
   */
  private applyProjectDir(workspaceId: WorkspaceId, path: string | undefined): Promise<WorkspaceValue> {
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(workspaceId)
      try {
        await this.ctx.workspaceRegistry.setProjectDir(workspace.id, path)
      } catch (error) {
        throw projectDirFailure(workspace.id, error)
      }
      return { workspace: workspaceView(workspace, this.isDefault(workspace)) }
    })
  }

  /** Materialize one Workspace's project directory, mapping the same failures. */
  private async projectDirValueOf(workspaceId: WorkspaceId): Promise<WorkspaceProjectDirValue> {
    try {
      const state = await this.ctx.workspaceRegistry.ensureProjectDir(workspaceId)
      return { projectDir: state.projectDir, subdirectories: { ...state.subdirectories } }
    } catch (error) {
      throw projectDirFailure(workspaceId, error)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function workspaceNotFound(workspaceId: WorkspaceId): RemoteError<'workspace/not-found'> {
  return new RemoteError(
    'workspace/not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Map a failed project-directory change onto the stable Remote code. Every
 * other failure is returned unchanged and propagates as itself.
 * @param workspaceId - Workspace whose project directory was being changed.
 * @param error - Failure raised by the registry.
 * @returns the Remote failure to throw, or the original error.
 */
function projectDirFailure(workspaceId: WorkspaceId, error: unknown): unknown {
  if (!(error instanceof WorkspaceProjectDirInvalidError)) return error
  return new RemoteError(
    'workspace/invalid-project-dir',
    error.message,
    { workspaceId, path: error.projectDir },
    { cause: error },
  )
}
