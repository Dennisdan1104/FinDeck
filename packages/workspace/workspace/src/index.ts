/**
 * Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
 * stable registry order, and header-validated session membership over the
 * domain data form.
 * @module @deepseek-ai/dsh-workspace
 */

import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceEntity } from './entity.ts'
import type { WorkspaceEntityHost } from './entity.ts'

export { WorkspaceMoveInvalidError } from './entity.ts'
import { defaultWorkspaceTitle, fullyQualifiedWorkspacePath, realpathNormalize } from './paths.ts'
import { defaultProjectDir, materializeProjectDir, projectPresetsDirOf, resolveProjectDir } from './project-dir.ts'
import type { ProjectDirState } from './project-dir.ts'
import { workspaceDomainSpec } from './spec.ts'
import type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
import type { CreateProjectRequest, Workspace, WorkspaceId as WorkspaceIdBrand } from './types.ts'

export type { CreateProjectRequest, Workspace } from './types.ts'
export {
  PROJECTS_DIR_NAME,
  defaultProjectDir,
  materializeProjectDir,
  projectAutomationsDir,
  projectMemoryDir,
  projectPresetsDir,
  projectPresetsDirOf,
  resolveProjectDir,
} from './project-dir.ts'
export type { ProjectDirState, ProjectSubdirectories, ProjectSubdirectory } from './project-dir.ts'

/** Workspace registry deployment policy. */
export interface Config {
  /**
   * Directory backing the built-in default Workspace (sessions created
   * without an explicit Workspace land there). Unset disables the feature;
   * the product composition supplies `$DSH_HOME/default-workspace`.
   */
  readonly defaultWorkspaceDir?: string
  /**
   * Days an archived Session keeps its archive entry and its stored log before
   * the startup sweep discards both. Unset uses 30.
   */
  readonly archiveRetentionDays?: number
}

/** Milliseconds in one day, the unit {@link Config.archiveRetentionDays} is quoted in. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Archive retention applied when the deployment names none. */
const DEFAULT_ARCHIVE_RETENTION_DAYS = 30
export { workspaceDomainState, workspaceRecord, workspaceDomainSpec } from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
export { realpathNormalize } from './paths.ts'

/** Identifies one workspace record (see `src/types.ts` for the brand rationale). */
export type WorkspaceId = WorkspaceIdBrand

/**
 * Brand a string as a {@link WorkspaceId}.
 * @param id - Raw workspace id string.
 * @returns the same string, branded at compile time.
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/**
 * An archiveSession request named a session neither live nor in session
 * persistence — a definite miss only; storage faults propagate as themselves.
 */
export class WorkspaceUnknownSessionError extends Error {
  /**
   * @param sessionId - The unknown session id.
   */
  constructor(readonly sessionId: SessionId) {
    super(`cannot archive session '${sessionId}': live sessions and session persistence hold no such session`)
    this.name = 'WorkspaceUnknownSessionError'
  }
}

/** A workspace reorder named a source or anchor absent from the durable registry order. */
export class WorkspaceOrderInvalidError extends Error {
  /**
   * @param workspaceId - Missing source or anchor id.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot reorder unknown workspace '${workspaceId}'`)
    this.name = 'WorkspaceOrderInvalidError'
  }
}

/**
 * A project-directory change named a path that is not fully qualified, or a
 * directory tree that could not be created. Both are caller-correctable
 * failures; storage faults propagate as themselves.
 */
export class WorkspaceProjectDirInvalidError extends Error {
  /**
   * @param projectDir - The rejected or uncreatable project directory.
   * @param message - Which path failed and why.
   * @param options - Standard error options; the filesystem failure travels as the cause.
   */
  constructor(readonly projectDir: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceProjectDirInvalidError'
  }
}

/** A project creation named a blank display name. */
export class WorkspaceProjectNameInvalidError extends Error {
  /**
   * @param projectName - The rejected name, exactly as the caller supplied it.
   */
  constructor(readonly projectName: string) {
    super(`project name must not be blank: '${projectName}'`)
    this.name = 'WorkspaceProjectNameInvalidError'
  }
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceRegistry: WorkspaceRegistry
  }
}

interface BootstrapGroup {
  readonly path: string
  readonly headers: SessionHeader[]
  readonly newestAt: number
}

const sameIds = (left: readonly WorkspaceId[], right: readonly WorkspaceId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const compareHeaders = (left: SessionHeader, right: SessionHeader): number =>
  right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id))

/**
 * Durable workspace registry. Startup waits for `sessionPersistence`, builds
 * one canonical-cwd header index, and completes the one-time history
 * bootstrap before the service becomes active. The persistence dependency is
 * mandatory so an unavailable peer can never be mistaken for an empty
 * history and commit the initialized marker.
 */
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private table?: KvTable<WorkspaceId, WorkspaceRecord>
  private global?: DomainGlobal<WorkspaceDomainState>
  private state?: WorkspaceDomainState
  private readonly entities = new Map<WorkspaceId, WorkspaceEntity>()
  private readonly headers = new Map<SessionId, SessionHeader>()
  private readonly sessionPaths = new Map<SessionId, string>()
  private readonly invalidSessionPaths = new Map<SessionId, string>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: WorkspaceEntityHost = {
    table: () => this.requireTable(),
    sessionPath: id => this.sessionPaths.get(id),
    readSessionHeader: id => this.readSessionHeader(id),
    isUnreadableSession: id => this.persistenceOwnsUnreadableFormat(id),
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path)
      this.invalidSessionPaths.delete(id)
    },
  }

  /**
   * Ask the persistence backend whether it holds this id in a Session format
   * it cannot decode. Only the JSONL backend can answer; every other backend
   * (including test doubles) reports nothing unreadable, which leaves the
   * pre-existing prune behavior exactly as it was.
   * @param id - Session whose persistent presence is asked about.
   * @returns true when the id exists under an unreadable newer format.
   */
  private persistenceOwnsUnreadableFormat(id: SessionId): boolean {
    const probe: unknown = this.ctx.sessionPersistence
    if (probe === null || probe === undefined) return false
    const ask = (probe as { isUnreadableSession?: unknown }).isUnreadableSession
    if (typeof ask !== 'function') return false
    return (ask as (candidate: SessionId) => boolean).call(probe, id) === true
  }

  /** Deployment policy for the built-in default Workspace and archive retention. */
  static Config: z<Config> = z.object({
    defaultWorkspaceDir: z.string(),
    archiveRetentionDays: z.number(),
  })

  /** Canonical path of the built-in default Workspace, once established. */
  private defaultPath: string | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceRegistry')
    this.configuredDefaultDir = config.defaultWorkspaceDir === undefined || config.defaultWorkspaceDir === ''
      ? undefined
      : config.defaultWorkspaceDir
    const retentionDays = config.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      throw new Error(`archiveRetentionDays must be a positive number of days, got ${String(retentionDays)}`)
    }
    this.archiveRetentionMs = retentionDays * MS_PER_DAY
  }

  /** Configured default Workspace directory; undefined disables the feature. */
  private readonly configuredDefaultDir: string | undefined

  /** Archive retention window in milliseconds, resolved once from {@link Config.archiveRetentionDays}. */
  private readonly archiveRetentionMs: number

  /**
   * The built-in default Workspace: where sessions created without an explicit
   * Workspace (AI-initiated or background work) land. `undefined` when the
   * deployment disabled it or establishment failed.
   * @returns the default Workspace entity, or undefined.
   */
  defaultWorkspace(): Workspace | undefined {
    return this.defaultPath === undefined
      ? undefined
      : this.list().find(workspace => workspace.path === this.defaultPath)
  }

  /** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workspace.domainClose')
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.state = domain.global.get()

    await this.recoverPendingMutation()
    this.validateStoredState(this.state)
    if (!this.state.initialized) {
      const headers = await this.listStoredHeaders()
      await this.replaceHeaderIndex(headers)
      await this.bootstrap(headers)
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.listStoredHeaders())
    }

    await this.indexLiveSessions()
    this.validateStoredState(this.requireState())
    this.rebuildEntities()
    await this.sweepExpiredArchives()
    this.reportFilteredCandidates()
    await this.ensureDefaultWorkspace()
  }

  /**
   * Establish the configured default Workspace: create its directory when
   * absent and register it once. Idempotent across boots; a failure leaves the
   * registry usable and the default simply absent.
   */
  private async ensureDefaultWorkspace(): Promise<void> {
    const configured = this.configuredDefaultDir
    if (configured === undefined) return
    try {
      let canonical: string
      try {
        canonical = await realpathNormalize(configured)
      } catch {
        await mkdir(configured, { recursive: true })
        canonical = await realpathNormalize(configured)
      }
      this.defaultPath = canonical
      if (!this.list().some(workspace => workspace.path === canonical)) await this.create(canonical)
    } catch (error: unknown) {
      this.ctx.logger.warn(`workspace: could not establish the default workspace at "${configured}": ${String(error)}`)
    }
  }

  /**
   * Create or reuse a workspace for an existing directory. The fully qualified
   * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
   * non-directory path rejects. Repeated calls for the same canonical path
   * return the existing entity without changing its title.
   * A newly created workspace is prepended to the durable registry order.
   * Different canonical paths may share a display title.
   * @param path - Existing directory to own, in a fully qualified path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  async create(path: string, title?: string): Promise<Workspace> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title))
  }

  /**
   * Create one named project with its own working directory and materialize
   * its project directory in the same call.
   *
   * Without `path` the working directory is a fresh `<home>/projects/<uuid>/`
   * created here; with `path` the supplied fully qualified directory is
   * created when absent and adopted. Either way the record's title is the
   * trimmed name (duplicate titles are allowed, and an already-owned canonical
   * path resolves to the existing record unchanged), and the project directory
   * tree — the root plus `memory/`, `presets/`, and `automations/` — exists
   * before this resolves.
   * @param request - project name and optional working directory.
   * @returns the created or already-registered workspace.
   */
  async createProject(request: CreateProjectRequest): Promise<Workspace> {
    const name = request.name.trim()
    if (name === '') throw new WorkspaceProjectNameInvalidError(request.name)
    const path = request.path ?? defaultProjectDir(WorkspaceId(randomUUID()))
    if (!fullyQualifiedWorkspacePath(path)) {
      throw new WorkspaceProjectDirInvalidError(
        path,
        `project directory is not fully qualified: '${path}'`,
      )
    }
    try {
      await mkdir(path, { recursive: true })
    } catch (error) {
      throw new WorkspaceProjectDirInvalidError(
        path,
        `cannot create project directory '${path}': ${String(error)}`,
        { cause: error },
      )
    }
    const workspace = await this.create(path, name)
    await this.ensureProjectDir(workspace.id)
    return workspace
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.entities.get(id)
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireState().workspaceIds.map((id) => {
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`workspace registry order references missing workspace '${id}'`)
      }
      return entity
    })
  }

  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. Unknown ids are an idempotent no-op for domain callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(() => this.deleteKnown(id))
  }

  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id)
      if (beforeId !== undefined && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId)
      }
      if (beforeId === id) return state.workspaceIds
      const without = state.workspaceIds.filter(workspaceId => workspaceId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const workspaceIds = [...without.slice(0, at), id, ...without.slice(at)]
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds
      await this.setState({ ...state, workspaceIds })
      return workspaceIds
    })
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.requireState().archivedSessionIds
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * An already archived id resolves without writing, which keeps the first
   * archive's retention clock rather than restarting it.
   * @param sessionId - The session to archive.
   * @returns resolution after durability.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with another archive.
      if (this.requireState().archivedSessionIds.includes(sessionId)) return
      if (!(await this.sessionKnown(sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId)
      }
      const state = this.requireState()
      await this.setState({
        ...state,
        archivedSessionIds: [...state.archivedSessionIds, sessionId],
        archivedAt: { ...state.archivedAt, [sessionId as string]: new Date().toISOString() },
      })
    })
  }

  /**
   * Restore one archived session to the grouping surfaces. Its membership slot
   * survived archiving, so it returns to the position it held. An id that is
   * not archived resolves without writing.
   * @param sessionId - The session to restore.
   * @returns resolution after durability.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      const archivedAt = { ...state.archivedAt }
      delete archivedAt[sessionId as string]
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
        archivedAt,
      })
    })
  }

  /**
   * Apply the archive retention policy once per boot: an archived session whose
   * clock ran past {@link Config.archiveRetentionDays} loses its stored log, its
   * membership slot, and its archive entry; one whose log is already gone loses
   * the entry alone. An archive written before this clock existed starts its
   * window at the first boot that reads it, so an upgrade never discards
   * history. A session this process holds open, a log a newer build owns, and a
   * failed removal all keep their entry: the sweep never guesses its way past a
   * refusal, and the next boot retries.
   */
  private async sweepExpiredArchives(): Promise<void> {
    const state = this.requireState()
    if (state.archivedSessionIds.length === 0) return
    const cutoff = Date.now() - this.archiveRetentionMs
    const archivedAt: Record<string, string> = { ...state.archivedAt }
    const kept: SessionId[] = []
    let changed = false
    for (const sessionId of state.archivedSessionIds) {
      const key = sessionId as string
      const stamp = archivedAt[key]
      if (stamp === undefined) {
        archivedAt[key] = new Date().toISOString()
        changed = true
        kept.push(sessionId)
        continue
      }
      if (Date.parse(stamp) > cutoff) {
        kept.push(sessionId)
        continue
      }
      if (!(await this.discardExpiredArchive(sessionId))) {
        kept.push(sessionId)
        continue
      }
      delete archivedAt[key]
      changed = true
    }
    if (changed) await this.setState({ ...state, archivedSessionIds: kept, archivedAt })
  }

  /**
   * Discard one expired archive's stored log and membership slot.
   * @param sessionId - The expired archived session.
   * @returns whether the archive entry may be dropped.
   */
  private async discardExpiredArchive(sessionId: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(sessionId) !== undefined) return false
    // A log this build cannot decode belongs to a newer build: never delete it.
    if (this.persistenceOwnsUnreadableFormat(sessionId)) return false
    // Resolved while the header index still places the session: the membership
    // view is filtered by that index, so dropping the index entry first would
    // hide the owning Workspace from this lookup and leave the slot behind.
    const owner = this.list().find(workspace => workspace.sessionIds.includes(sessionId))
    if (this.headers.has(sessionId)) {
      try {
        await this.ctx.sessionPersistence.remove(sessionId)
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `workspace: archive retention could not discard session '${sessionId}': ${String(error)}`,
        )
        return false
      }
    }
    this.headers.delete(sessionId)
    this.sessionPaths.delete(sessionId)
    this.invalidSessionPaths.delete(sessionId)
    if (owner !== undefined) await owner.detachSession(sessionId)
    return true
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(id) !== undefined) return true
    if (this.headers.has(id)) return true
    await this.indexHeaders(await this.listStoredHeaders())
    return this.headers.has(id)
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path: string): Promise<Workspace | undefined> {
    const canonical = await realpathNormalize(path)
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }
    return undefined
  }

  /**
   * Materialize one workspace's project directory: the resolved root plus its
   * `memory/`, `presets/`, and `automations/` subdirectories. Idempotent, and
   * it never writes the record — the derived default is not persisted, so a
   * workspace keeps the same resolution across restarts.
   * @param id - Workspace whose project directory to materialize.
   * @returns the resolved project directory and the observed subdirectory state.
   */
  async ensureProjectDir(id: WorkspaceId): Promise<ProjectDirState> {
    const workspace = this.requireWorkspace(id)
    const resolved = resolveProjectDir(workspace)
    try {
      return await materializeProjectDir(resolved)
    } catch (error) {
      throw new WorkspaceProjectDirInvalidError(
        resolved,
        `cannot create project directory '${resolved}': ${String(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Point one workspace's project directory at a custom absolute path, or
   * clear a custom path back to the derived default. The directory tree is
   * materialized before the path is recorded, so an uncreatable directory
   * leaves the record untouched. Serialized on the registry operation chain
   * like every other registry write.
   * @param id - Workspace whose project directory changes.
   * @param projectDir - Absolute custom project directory; omitted restores the default.
   * @returns the materialized project directory and the observed subdirectory state.
   */
  setProjectDir(id: WorkspaceId, projectDir?: string): Promise<ProjectDirState> {
    return this.enqueueOperation(async () => {
      const workspace = this.requireWorkspace(id)
      if (projectDir !== undefined && !fullyQualifiedWorkspacePath(projectDir)) {
        throw new WorkspaceProjectDirInvalidError(
          projectDir,
          `project directory is not fully qualified: '${projectDir}'`,
        )
      }
      const resolved = projectDir ?? defaultProjectDir(id)
      let state: ProjectDirState
      try {
        state = await materializeProjectDir(resolved)
      } catch (error) {
        throw new WorkspaceProjectDirInvalidError(
          resolved,
          `cannot create project directory '${resolved}': ${String(error)}`,
          { cause: error },
        )
      }
      if (workspace.projectDir !== projectDir) await workspace.setProjectDir(projectDir)
      return state
    })
  }

  /**
   * The project `presets/` directory of the workspace whose registered path
   * contains `path` — the project-scoped preset root a working directory is
   * entitled to see, and the only one a read or write about it may reach.
   *
   * The lookup is by containment over canonical paths, so a caller states the
   * directory it is working in rather than naming a workspace, and a path no
   * workspace contains answers undefined instead of guessing. Nothing is
   * created and no record is written.
   * @param path - Absolute directory path, typically a session's working directory.
   * @returns the absolute `presets/` directory, or undefined when no workspace contains `path`.
   */
  async projectPresetsDirForPath(path: string): Promise<string | undefined> {
    const canonical = await canonicalLookupPath(path)
    return canonical === undefined ? undefined : projectPresetsDirOf(this.list(), canonical)
  }

  /**
   * Resolve one registered workspace or fail loud.
   * @param id - Workspace id.
   * @returns the registered entity; throws when no entity carries the id.
   */
  private requireWorkspace(id: WorkspaceId): Workspace {
    const workspace = this.get(id)
    if (workspace === undefined) throw new Error(`unknown workspace '${id}'`)
    return workspace
  }

  private async createCanonical(canonical: string, title?: string): Promise<WorkspaceEntity> {
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }

    const workspaceName = title ?? defaultWorkspaceTitle(canonical)
    const table = this.requireTable()
    const state = this.requireState()
    const id = WorkspaceId(randomUUID())
    const now = new Date().toISOString()
    const record: WorkspaceRecord = {
      path: canonical,
      title: workspaceName,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    const pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    }
    try {
      await this.setState(pendingState)
    } catch (error) {
      this.entities.delete(id)
      throw error
    }
    try {
      await table.put(id, record)
    } catch (error) {
      this.entities.delete(id)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record write and pending-marker rollback both failed`,
        )
      }
      throw error
    }

    try {
      await this.setState({
        initialized: true,
        workspaceIds: [id, ...state.workspaceIds],
        archivedSessionIds: state.archivedSessionIds,
        archivedAt: state.archivedAt,
      })
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

  private async deleteKnown(id: WorkspaceId): Promise<boolean> {
    const entity = this.entities.get(id)
    if (entity === undefined) return false
    const state = this.requireState()
    const nextState = {
      initialized: true,
      workspaceIds: state.workspaceIds.filter(workspaceId => workspaceId !== id),
      archivedSessionIds: state.archivedSessionIds,
      archivedAt: state.archivedAt,
    }
    await this.setState({
      ...nextState,
      pendingMutation: { operation: 'delete', workspaceId: id },
    })
    this.entities.delete(id)
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.entities.set(id, entity)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        // The durable marker still says to finish deletion, so the cache must
        // agree with that recoverable direction rather than republish a row
        // absent from the persisted order.
        this.entities.delete(id)
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`,
        )
      }
      throw error
    }
    try {
      await this.setState(nextState)
    } catch (error) {
      // The deletion committed at the table write and was already published
      // to Host streams. Keep the durable marker for startup recovery rather
      // than reporting failure after the requested state became true.
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`,
      )
    }
    return true
  }

  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  private async recoverPendingMutation(): Promise<void> {
    const state = this.requireState()
    const pending = state.pendingMutation
    if (pending === undefined) return
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace `
        + `'${pending.workspaceId}' is still present in registry order`,
      )
    }
    await this.requireTable().delete(pending.workspaceId)
    await this.setState({
      initialized: state.initialized,
      workspaceIds: state.workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
      archivedAt: state.archivedAt,
    })
  }

  private async bootstrap(headers: readonly SessionHeader[]): Promise<void> {
    const table = this.requireTable()
    const state = this.requireState()
    const groupsByPath = new Map<string, SessionHeader[]>()
    for (const header of headers) {
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) continue
      const group = groupsByPath.get(path)
      if (group === undefined) groupsByPath.set(path, [header])
      else group.push(header)
    }
    const groups: BootstrapGroup[] = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders)
      const newest = groupHeaders[0] as SessionHeader
      return { path, headers: groupHeaders, newestAt: newest.createdAt }
    }).sort((left, right) =>
      right.newestAt - left.newestAt || left.path.localeCompare(right.path))

    const byPath = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      byPath.set(record.path, id)
      for (const sessionId of record.sessionIds) accounted.set(sessionId, id)
    }

    for (const group of groups) {
      let id = byPath.get(group.path)
      if (id === undefined) {
        const sessionIds = group.headers
          .map(header => header.id)
          .filter(sessionId => !accounted.has(sessionId))
        if (sessionIds.length === 0) continue
        id = WorkspaceId(randomUUID())
        const createdAt = new Date(group.newestAt).toISOString()
        const record: WorkspaceRecord = {
          path: group.path,
          title: defaultWorkspaceTitle(group.path),
          sessionIds,
          createdAt,
          updatedAt: createdAt,
        }
        await table.put(id, record)
        byPath.set(group.path, id)
        for (const sessionId of sessionIds) accounted.set(sessionId, id)
        continue
      }

      const current = table.get(id) as WorkspaceRecord
      const historical = group.headers
        .map(header => header.id)
        .filter(sessionId => accounted.get(sessionId) === undefined || accounted.get(sessionId) === id)
      const historicalSet = new Set(historical)
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter(sessionId => !historicalSet.has(sessionId)),
      ]
      if (sameSessionIds(current.sessionIds, sessionIds)) continue
      await table.update(id, record => ({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      }))
      for (const sessionId of historical) accounted.set(sessionId, id)
    }

    const groupRank = new Map(groups.map(group => [group.path, group.newestAt]))
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]))
    const workspaceIds = [...table.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt)
        const rightTime = groupRank.get(right.path) ?? Date.parse(right.createdAt)
        return rightTime - leftTime
          || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
            - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
          || String(leftId).localeCompare(String(rightId))
      })
      .map(([id]) => id)

    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState({ initialized: false, workspaceIds, archivedSessionIds: state.archivedSessionIds, archivedAt: state.archivedAt })
    }
    await this.setState({ initialized: true, workspaceIds, archivedSessionIds: state.archivedSessionIds, archivedAt: state.archivedAt })
  }

  private validateStoredState(state: WorkspaceDomainState): void {
    const table = this.requireTable()
    const order = new Set<WorkspaceId>()
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`)
      }
      order.add(id)
    }
    if (state.initialized && order.size !== table.size) {
      const orphan = [...table.keys()].find(id => !order.has(id))
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan as WorkspaceId}' is absent from registry order`,
      )
    }

    const paths = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      const pathHolder = paths.get(record.path)
      if (pathHolder !== undefined) {
        throw new Error(
          `workspace domain is inconsistent: path '${record.path}' is claimed `
          + `by both workspace '${pathHolder}' and workspace '${id}'`,
        )
      }
      paths.set(record.path, id)
      for (const sessionId of record.sessionIds) {
        const holder = accounted.get(sessionId)
        if (holder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId}' is accounted `
            + `by both workspace '${holder}' and workspace '${id}'`,
          )
        }
        accounted.set(sessionId, id)
      }
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    for (const id of this.requireState().workspaceIds) {
      const record = this.requireTable().get(id) as WorkspaceRecord
      this.entities.set(id, new WorkspaceEntity(this.host, id, record))
    }
  }

  private async replaceHeaderIndex(headers: readonly SessionHeader[]): Promise<void> {
    this.headers.clear()
    this.sessionPaths.clear()
    this.invalidSessionPaths.clear()
    await this.indexHeaders(headers)
  }

  private async indexHeaders(headers: readonly SessionHeader[]): Promise<void> {
    for (const header of headers) await this.indexHeader(header)
  }

  private async indexHeader(header: SessionHeader): Promise<void> {
    this.headers.set(header.id, header)
    this.sessionPaths.delete(header.id)
    if (header.cwd === undefined) {
      this.invalidSessionPaths.set(header.id, 'header has no cwd')
      return
    }
    try {
      const path = await realpathNormalize(header.cwd)
      if (!(await stat(path)).isDirectory()) {
        this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`)
        return
      }
      this.sessionPaths.set(header.id, path)
      this.invalidSessionPaths.delete(header.id)
    } catch {
      this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`)
    }
  }

  /** Every stored session's header, projected from the persistence snapshot listing. */
  private async listStoredHeaders(): Promise<SessionHeader[]> {
    const snapshots = await this.ctx.sessionPersistence.list()
    return snapshots.map(snapshot => snapshot.header)
  }

  private async indexLiveSessions(): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    await this.indexHeaders(sessions.list().map(session => session.header))
  }

  private reportFilteredCandidates(): void {
    for (const entity of this.entities.values()) {
      const record = this.requireTable().get(entity.id) as WorkspaceRecord
      for (const sessionId of record.sessionIds) {
        const path = this.sessionPaths.get(sessionId)
        if (path === record.path) continue
        // A session stored in a newer format is present and owned by another
        // build: its membership is kept deliberately, so say why it has no row
        // instead of reporting it with the reasons of a membership about to be
        // pruned on the next write.
        if (this.persistenceOwnsUnreadableFormat(sessionId)) {
          this.ctx.logger.warn(
            `workspace '${entity.id}' keeps session '${sessionId}' in its membership: `
            + 'it is stored in a newer Session format this build cannot read',
          )
          continue
        }
        const reason = this.invalidSessionPaths.get(sessionId)
          ?? (this.headers.has(sessionId)
            ? `canonical cwd '${path}' differs from workspace path '${record.path}'`
            : 'session header is missing')
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`,
        )
      }
    }
  }

  private async readSessionHeader(id: SessionId): Promise<SessionHeader> {
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) {
      this.headers.set(id, live.header)
      return live.header
    }
    const cached = this.headers.get(id)
    if (cached !== undefined) return cached

    const headers = await this.listStoredHeaders()
    await this.indexHeaders(headers)
    const header = this.headers.get(id)
    if (header === undefined) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`)
    }
    return header
  }

  private requireTable(): KvTable<WorkspaceId, WorkspaceRecord> {
    if (this.table === undefined) throw new Error('workspace registry is not started yet')
    return this.table
  }

  private requireState(): WorkspaceDomainState {
    if (this.state === undefined) throw new Error('workspace registry is not started yet')
    return this.state
  }

  private async setState(state: WorkspaceDomainState): Promise<void> {
    await (this.global as DomainGlobal<WorkspaceDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      // A committed delete may leave only its marker cleanup pending. Retry
      // recovery before another create/delete can overwrite that pending operation record.
      await this.recoverPendingMutation()
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

const sameSessionIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/**
 * Canonicalize a working directory for a containment lookup: the real path when
 * the filesystem resolves it, otherwise the caller's own absolute spelling, so
 * a directory that was moved or deleted still matches the workspace holding its
 * path. A path that is not fully qualified names no location this registry can
 * place, and matches nothing.
 */
async function canonicalLookupPath(path: string): Promise<string | undefined> {
  if (!fullyQualifiedWorkspacePath(path)) return undefined
  try {
    return await realpathNormalize(path)
  } catch {
    // Realpath is the only probe: absence, permission loss, and a race with a
    // concurrent delete all leave the caller's spelling as the best identity.
    return path
  }
}

export default WorkspaceRegistry
