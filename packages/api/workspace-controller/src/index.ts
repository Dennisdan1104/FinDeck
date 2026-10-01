/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceEnsureProjectRequest,
  WorkspaceFollowFrame,
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

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry']

  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(ctx: Context) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    this.commands = new WorkspaceCommands(ctx)
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('create')
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Create one named project, optionally over a caller-chosen directory.
   * @param request - display name and optional working directory.
   * @returns the created project projection.
   */
  @Remote('createProject')
  createProject(request: WorkspaceCreateProjectRequest): Promise<WorkspaceView> {
    return this.commands.createProject(request)
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @Remote('rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request)
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @Remote('insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @Remote('archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Restore one archived Session to Workspace grouping surfaces.
   * @param request - Session identity to restore.
   * @returns the complete resulting archive set.
   */
  @Remote('unarchiveSession')
  unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.unarchiveSession(request)
  }

  /**
   * Point one Workspace at an absolute custom project directory, creating its
   * `memory/`, `presets/`, and `automations/` subdirectories.
   * @param request - Workspace identity and the directory to adopt.
   * @returns the updated Workspace projection.
   */
  @Remote('setProjectDir')
  setProjectDir(request: WorkspaceSetProjectDirRequest): Promise<WorkspaceValue> {
    return this.commands.setProjectDir(request)
  }

  /**
   * Restore one Workspace's derived default project directory
   * (`<home>/projects/<workspaceId>`), creating it when absent.
   * @param request - Workspace identity to reset.
   * @returns the updated Workspace projection.
   */
  @Remote('resetProjectDir')
  resetProjectDir(request: WorkspaceResetProjectDirRequest): Promise<WorkspaceValue> {
    return this.commands.resetProjectDir(request)
  }

  /**
   * Materialize one Workspace's project directory tree on demand, for
   * surfaces that need the directory before it has ever been written.
   * @param request - Workspace identity to materialize.
   * @returns the resolved project directory and its subdirectory state.
   */
  @Remote('ensureProject')
  ensureProject(request: WorkspaceEnsureProjectRequest): Promise<WorkspaceProjectDirValue> {
    return this.commands.ensureProject(request)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    return this.feed.follow(signal)
  }
}

export default WorkspaceController
