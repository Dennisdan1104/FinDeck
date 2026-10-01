/**
 * Agent presets: each session composes its model-facing plugin set from one
 * preset `cordis.yml`, mounted ONCE per preset under a standing scope and
 * joined by every agent that names it.
 *
 * The standing mount is what makes a preset one composition rather than one
 * per session: its plugin instances, tool registrations, prompt sections, and
 * projection units exist exactly once, keyed per session inside the plugins
 * themselves (they predate presets and were written for a shared world). An
 * agent joins by having its scope key parented to the mount's
 * ({@link bindScopeParent}), which makes the mount's registrations visible to
 * that agent's views and the mount's listeners receive that agent's events —
 * and a host reader with no agent at all (a cold transcript read) resolves
 * the same standing registrations by preset id.
 *
 * This package owns the preset vocabulary, filesystem discovery, and the
 * guarded standing mount. It does not decide when an agent is created — the
 * agent factory's `setup(agentCtx)` hook is the one supported call site,
 * because only there is the join installed while the agent is still
 * unpublished, so a rejected composition rolls the whole creation back.
 * @module @deepseek-ai/dsh-agent-presets
 */

import { rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { bindScopeParent, createScope, scopeOf, type Scope, type ScopeKey, type ScopeParentBinding } from '@deepseek-ai/dsh-scope'
// Type-only: resolves the `agent/created` lifecycle event this service watches.
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  AgentPresetDocument, AgentPresetRoster, AgentPresetRosterForRequest, AgentPresetRow, AgentPresetWriteRequest,
} from './types.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only: resolves the registry notification emitted after scope reparenting.
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: makes `ctx.get('workspaceRegistry')` resolve to the workspace
// registry when composed — the roster reads a caller's project preset root
// through it opportunistically (the documented `ctx.get` pattern), never as a
// hard dependency, so a deployment without workspaces keeps the global layer.
import type {} from '@deepseek-ai/dsh-workspace'
import type SettingsService from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { discoverPresets, SHIPPED_PRESET_ROOT, USER_PRESET_DIR } from './discovery.ts'
import {
  copyComposition, deleteComposition, notWritable, presetExists, readComposition,
  renderPresetDocument, writableRoot, writePresetDocument,
} from './authoring.ts'
import { livePresetMounts, mountPreset, serviceForAgent, standingMountFor } from './mount.ts'
import {
  fileComposition, mountedCompositionRows,
  type AgentPresetComposition,
} from './composition-inventory.ts'
import type { AgentPreset, Config, PresetRoot } from './preset.ts'
import { agentPresetProjectionDefinition } from './session.ts'
import { flowProblem, type FlowStep } from './mode.ts'
export type * from './types.ts'
export {
  fileComposition, mountedCompositionRows,
  type AgentPresetComposition,
} from './composition-inventory.ts'
export type {
  AgentPresetCompositionRow, CompositionRowEnablement,
} from './composition-inventory.ts'

/** Settings namespace carrying the user's chosen default preset. */
export const SETTINGS_NAMESPACE = 'agent-presets'

/** Refuse an empty preset id before invoking a domain operation. */
function validatePresetId(value: string, field: 'agentPreset' | 'from'): void {
  if (value.length === 0) {
    throw new RemoteError('gateway/bad-request', `${field} must be a non-empty string`, {})
  }
}

/** Whether one effective root layer accepts presets a caller authored. */
function hasWritableRoot(roots: readonly PresetRoot[]): boolean {
  return roots.some(root => root.trust === 'user')
}

/** Project one discovered preset onto the path-free row every roster read answers. */
function presetRow(preset: AgentPreset, defaultId: string): AgentPresetRow {
  return {
    id: preset.id,
    trust: preset.trust,
    isDefault: preset.id === defaultId,
    ...preset.name === undefined ? {} : { name: preset.name },
    ...preset.description === undefined ? {} : { description: preset.description },
    ...preset.broken === undefined ? {} : { broken: preset.broken },
    ...preset.modeKind === undefined ? {} : { modeKind: preset.modeKind },
    ...preset.flow === undefined ? {} : { flow: preset.flow },
  }
}

/** The layer one preset came from, named by what makes it unique. */
type PresetLayer =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly projectDir: string }

/** The roots one read acts on, in precedence order, beside the project layer they carry. */
interface PresetLayers {
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  readonly roots: readonly PresetRoot[]
  /** The project layer these roots carry, when the caller's working directory names one. */
  readonly project?: { readonly dir: string; readonly root: string }
}

/** Prefix of a global-layer preset identity. */
const GLOBAL_IDENTITY_PREFIX = 'global:'

/** Prefix of a project-layer preset identity, whose form is `project:<projectDir>:<id>`. */
const PROJECT_IDENTITY_PREFIX = 'project:'

/**
 * Directory a project keeps its presets in, relative to its project directory.
 *
 * dsh-workspace owns this layout (`projectPresetsDir`), and this package reaches
 * a project root only through the workspace registry — except here, where a
 * layer-qualified identity has to be read back into the root it names and the
 * registry has no lookup by project directory. The segment is repeated rather
 * than taking a runtime dependency on the package that owns it.
 */
const PROJECT_PRESETS_DIR = 'presets'

/** The identity of a global-layer preset, whose form is `global:<id>`. */
function globalIdentity(id: string): string {
  return `${GLOBAL_IDENTITY_PREFIX}${id}`
}

/** The identity of one project's copy of a preset. */
function projectIdentity(projectDir: string, id: string): string {
  return `${PROJECT_IDENTITY_PREFIX}${projectDir}:${id}`
}

/**
 * Split one preset identity into the layer it names and the bare preset id.
 *
 * A bare id names the global layer: that is what every record written before
 * project layers existed carries, and what a global preset still records. The
 * project id is the segment after the LAST colon, because a Windows project
 * directory carries a drive colon of its own. A `project:` prefix with no id
 * after it is not an identity this package ever writes, and reads as a bare id
 * rather than as a project layer nothing names.
 * @param value - a preset id, or a layer-qualified preset identity.
 * @returns the layer, the bare id, and whether `value` carried a layer prefix.
 */
function identityParts(value: string): {
  readonly layer: PresetLayer
  readonly id: string
  readonly qualified: boolean
} {
  if (value.startsWith(GLOBAL_IDENTITY_PREFIX)) {
    return { layer: { kind: 'global' }, id: value.slice(GLOBAL_IDENTITY_PREFIX.length), qualified: true }
  }
  if (value.startsWith(PROJECT_IDENTITY_PREFIX)) {
    const rest = value.slice(PROJECT_IDENTITY_PREFIX.length)
    const at = rest.lastIndexOf(':')
    if (at > 0 && at < rest.length - 1) {
      return { layer: { kind: 'project', projectDir: rest.slice(0, at) }, id: rest.slice(at + 1), qualified: true }
    }
  }
  return { layer: { kind: 'global' }, id: value, qualified: false }
}

/**
 * The bare preset id one identity names, whichever layer it belongs to.
 * @param identity - a preset id, or a layer-qualified preset identity.
 * @returns the preset's directory name.
 */
export function presetIdOf(identity: string): string {
  return identityParts(identity).id
}

/**
 * What a session records for one standing mount: the bare id for the global
 * layer, which reads back as global, and the qualified identity for a project
 * preset, which is the only way a resumed session resolves the layer it ran.
 * @param identity - the mount's layer-qualified identity.
 * @returns the recorded preset identity.
 */
function recordedIdentity(identity: string): string {
  return identity.startsWith(GLOBAL_IDENTITY_PREFIX)
    ? identity.slice(GLOBAL_IDENTITY_PREFIX.length)
    : identity
}

/**
 * Resolve one mode write into the steps to store: the request's steps when it
 * declares any, the stored flow when the request states no mode, an empty list
 * for a free declaration, and `undefined` when nothing declares a mode. The
 * steps are validated by the rule discovery applies, so a stored flow can
 * never be one discovery would refuse. A declared kind outside `work` and
 * `free` is refused rather than read as `work`.
 * @param presetId - the preset being written, named by any refusal.
 * @param request - the requested mode fields.
 * @param current - the stored preset on a rewrite, absent on a create.
 * @returns the work-mode steps, `[]` for a declared free mode, or undefined
 * for no declaration at all.
 * @throws {RemoteError} `agent-preset/invalid` when the declaration is unusable.
 */
function resolveAuthoredFlow(
  presetId: string,
  request: AgentPresetWriteRequest,
  current: AgentPreset | undefined,
): readonly FlowStep[] | undefined {
  const invalid = (reason: string): RemoteError<'agent-preset/invalid'> =>
    new RemoteError('agent-preset/invalid', `agent-presets: invalid mode "${presetId}": ${reason}`, {
      agentPreset: presetId,
      reason,
    })
  // Widened deliberately: the Remote wire reaches this service directly, so a
  // caller can state a kind the request type does not admit, and coercing it
  // into `work` would store a mode the caller never asked for.
  const declared: string | undefined = request.modeKind
  if (declared === undefined) {
    // A rewrite that states steps without restating the kind keeps the stored
    // work mode; the kind and the steps are one declaration, and re-stating
    // both to change one of them invites the two to disagree.
    if (request.steps !== undefined) {
      const problem = flowProblem(request.steps)
      if (problem !== undefined) throw invalid(problem)
      return request.steps
    }
    // Otherwise a rewrite keeps what the preset declares, and a create that
    // says nothing declares no mode.
    const stored = current?.modeKind
    if (stored === 'work') return current?.flow?.steps
    return stored === 'free' ? [] : undefined
  }
  if (declared === 'free') {
    if (request.steps !== undefined && request.steps.length > 0) {
      throw invalid('a free mode declares no steps; drop them or use modeKind: "work"')
    }
    return []
  }
  if (declared !== 'work') {
    throw invalid(`modeKind must be "work" or "free" (got ${JSON.stringify(declared)})`)
  }
  const steps = request.steps
  if (steps === undefined || steps.length === 0) {
    throw invalid('modeKind: "work" requires the flow steps')
  }
  const problem = flowProblem(steps)
  if (problem !== undefined) throw invalid(problem)
  return steps
}

/** The user-writable slice of this plugin's config. */
export interface AgentPresetSettings {
  /** Preset mounted when a session names none. */
  default?: string
}

/** Runtime schema for the user-writable slice. */
export const AgentPresetSettingsSchema: z<AgentPresetSettings> = z.object({
  default: z.string(),
})

export { COMPOSITION_FILE, discoverPresets, scanRoot, SHIPPED_PRESET_ROOT } from './discovery.ts'
export {
  METADATA_FILE, readPresetMetadata, renderPresetMetadata, type PresetMetadata,
} from './metadata.ts'
export {
  flowProblem, readPresetMode, type FlowDefinition, type FlowStep, type FlowStepCluster,
  type PresetModeKind, type PresetModeRead,
} from './mode.ts'
export {
  inactiveRows, leakedServices, livePresetMounts, mountPreset, serviceForAgent, standingMountFor,
  type JoinedPresetMount, type PresetMount,
} from './mount.ts'
export {
  copyComposition, deleteComposition, readComposition, renderPresetDocument, writableRoot,
  writePresetDocument,
} from './authoring.ts'
export { agentPresetProjectionDefinition } from './session.ts'
export type { AgentPreset, Config, PresetRoot, PresetTrust } from './preset.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentPresets: AgentPresets
  }
}

/**
 * Registry over the deployment's agent presets.
 *
 * Discovery is unmemoized: `list()` and `resolve()` re-read the roots on every
 * call so a preset authored while the process runs is visible immediately,
 * and a preset deleted underneath a picker disappears from the next read.
 */
export class AgentPresets extends TypertRemoteService {
  static inject = ['loader', 'sessionProjections']

  /** Runtime schema for the preset roster. */
  static Config = z.object({
    default: z.string().required(),
    roots: z.array(z.object({
      path: z.string().required(),
      trust: z.union(['system', 'user'] as const).default('user'),
    })).default([]),
    includeShippedRoot: z.boolean().default(true),
    includeUserRoot: z.boolean().default(true),
  }) as z<Config>

  /**
   * The GLOBAL roots discovery and authoring scan: the package's shipped root
   * unless `includeShippedRoot` is false, then every configured root in order,
   * then the harness-home user root unless `includeUserRoot` is false.
   *
   * Derived once, because a root set that changed between `list()` and the
   * `copy()` acting on its answer would author into a directory the caller
   * never saw. The shipped root comes FIRST and the user root LAST because an
   * earlier root wins a duplicate id: a shipped preset shadows any directory
   * that claimed its name, and a configured root still shadows a locally
   * authored one.
   *
   * This is the layer every caller sees. A project layer is derived per call
   * from the caller's working directory and appended AFTER these roots, so
   * these stay the constant half of every effective root set.
   */
  private readonly resolvedRoots: readonly PresetRoot[]

  /**
   * Where a row's package name resolves from: the base URL of the composition
   * this roster was loaded by, which is inside the installed harness.
   *
   * Discovery needs it because a preset's own directory is the wrong base for
   * a package name — a locally authored preset lives under the user's home,
   * where Node's upward `node_modules` walk never reaches the harness's
   * dependencies. The mount already resolves rows this way; holding the same
   * base here is what lets health answer the question before a session does.
   */
  private readonly harnessBase: string

  /**
   * The user layer over `config.default`, present only while a settings
   * provider is composed. Held rather than snapshotted so a hot-reloaded
   * document takes effect without a restart.
   */
  private settings: SettingsScope<AgentPresetSettings> | undefined

  /**
   * The settings service behind {@link settings}, held for the one write this
   * service makes: clearing a user default it has just deleted.
   */
  private settingsService: SettingsService | undefined

  /**
   * The service's own untraced context. Methods invoked through the traceable
   * proxy see `this.ctx` rebound to the CALLER's context, which carries a
   * shadow; a subtree minted from it resolves every service through that
   * shadow's fiber instead of each entry's own inject store, so preset rows
   * would fail on the very services they declare. Standing mounts must hang
   * off the untraced original (the `jobs-local` selfCtx precedent).
   */
  private readonly selfCtx: Context

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'agentPresets')
    this.selfCtx = ctx
    const { baseUrl } = ctx
    if (baseUrl === undefined) {
      // Self-contained misconfiguration, so it fails at load: without a base
      // the roster can neither resolve a row nor tell a healthy preset from
      // one naming a package that is gone, and the silent alternative is the
      // exact failure this check exists to report.
      throw new Error(
        'agent-presets: the roster needs `ctx.baseUrl` to resolve the plugins a composition names; '
        + 'compose it under a Loader, or set the base on the context this plugin is applied to',
      )
    }
    this.harnessBase = baseUrl
    this.resolvedRoots = [
      ...config.includeShippedRoot ? [{ path: SHIPPED_PRESET_ROOT, trust: 'system' } satisfies PresetRoot] : [],
      ...config.roots,
      ...config.includeUserRoot ? [{ path: dshHomePath(USER_PRESET_DIR), trust: 'user' } satisfies PresetRoot] : [],
    ]
    // Deliberately not `settings.installSection`: that method exists to re-judge
    // what a consumer DERIVED from the source — memoized resolutions,
    // registration-level facts — across attach, detach, and change. Nothing
    // here is derived. `defaultId` reads through on every call, so both of its
    // hooks would be no-ops and the source thunk would restate this field.
    ctx.inject(['settings'], (settingsCtx) => {
      this.settings = settingsCtx.settings.register(
        SETTINGS_NAMESPACE,
        AgentPresetSettingsSchema,
        { base: { default: config.default } },
      )
      this.settingsService = settingsCtx.settings
      settingsCtx.effect(() => () => {
        this.settings = undefined
        this.settingsService = undefined
      }, 'agentPresets.settings()')
    })

    ctx.sessionProjections.register(agentPresetProjectionDefinition)

    // Advisory, not fatal. `agent/created` is serial and awaited, and a
    // rejecting listener fails creation, but this service must never veto it:
    // composing an agent outside the roster is legal — `recompose` binds exactly
    // such a bare agent below, and the ACP, SDK-server, and headless entry
    // points all create one. The internal catch swallows a failure of the
    // roster lookup or of the warning itself, so neither can veto creation.
    // The invariant companion is the check that fails loud, at assembly. Why an
    // unjoined agent matters at all has one home: the [Agent
    // Note](../../../../.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md).
    //
    // Known false positive: a session created bare and bound later by
    // `recompose` is warned about once, before its first bind. Shipped Web
    // sessions mount in `setup`, and children join through `composeFrom`
    // before publication.
    const warnWithoutPreset = (agent: Agent): void => {
      if (this.resolvedRoots.length === 0) return
      if (this.composedPreset(agent.ctx) !== undefined) return
      ctx.logger.warn(
        `agent "${agent.id}" was published without joining an agent preset; `
        + 'its tools, prompt sections, and skill catalog resolve against the empty global layer '
        + '(join through AgentPresets.mount() or composeFrom() in the agent factory setup)',
      )
    }
    ctx.on('agent/created', ({ agent }) => {
      try {
        warnWithoutPreset(agent)
      } catch {
        // Swallowed: this listener only emits a diagnostic, and a diagnostic
        // failure must never veto agent creation.
      }
    })

    // The durable record is the commit point. Its public notification carries
    // only the stable identity needed by clients, never the live Session.
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'agent-preset/selected') return
      ctx.emit('agent-preset/selected', session.id, event.data.agentPreset)
    })
  }

  /**
   * The preset id mounted when a caller names none.
   *
   * Read per call rather than cached: the settings document is hot-reloaded, so
   * changing the default takes effect on the next session created and leaves
   * every running session on the preset it was composed from.
   */
  get defaultId(): string {
    return this.settings?.get().default ?? this.config.default
  }

  /**
   * Every preset the effective roots currently supply.
   *
   * `cwd` names the caller's working directory: when the workspace registry is
   * composed and a workspace contains it, that workspace's project
   * `presets/` directory joins the scan as the FIRST root, so one project's
   * presets are visible only to callers working inside it and win a duplicate
   * id against the global layer every caller sees. Absent `cwd` — or a
   * directory no workspace contains — reads the global layer alone.
   * @param cwd - the caller's working directory, when it has one.
   * @returns the presets, first-root-wins per id.
   */
  async list(cwd?: string): Promise<AgentPreset[]> {
    return await discoverPresets((await this.layersFor(cwd)).roots, this.harnessBase)
  }

  /**
   * The roster off the Host: {@link list} projected to path-free rows, with
   * the default marked and this deployment's authoring capability beside it.
   *
   * Whether a client can open a preset's directory is the Host's own opener
   * capability, not a roster property — a caller needing both joins them.
   * @returns the rows and the authoring capability.
   */
  @Remote('list')
  async remoteExportList(): Promise<AgentPresetRoster> {
    return this.rosterOf(await this.list(), this.resolvedRoots)
  }

  /**
   * The roster for one working directory, each row carrying the layer it was
   * read from: the global layer plus the project layer of the workspace
   * containing `cwd`.
   *
   * This is the read a project-scoped surface uses, and the one the
   * `list` Remote cannot answer, because the wire carries no working
   * directory. It is read-only: naming a directory creates nothing.
   * @param request - the working directory whose project layer to include.
   * @returns the rows, each marked with its layer, and whether that caller has a writable root at all.
   */
  @Remote('rosterFor')
  async remoteExportRosterFor(request: AgentPresetRosterForRequest): Promise<AgentPresetRoster> {
    return await this.rosterFor(request.cwd)
  }

  /**
   * The roster for one working directory: the global layer plus the project
   * layer of the workspace containing `cwd`, projected exactly as
   * {@link remoteExportList} projects it, with each row marked by its layer.
   *
   * This is the read a project-scoped surface uses, and the one the
   * `list` Remote cannot answer, because the wire carries no working
   * directory. It is read-only: naming a directory creates nothing.
   * @param cwd - the working directory whose project layer to include.
   * @returns the rows, each marked with its layer, and whether that caller has a writable root at all.
   */
  async rosterFor(cwd: string): Promise<AgentPresetRoster> {
    const layers = await this.layersFor(cwd)
    return this.scopedRosterOf(await discoverPresets(layers.roots, this.harnessBase), layers)
  }

  /** Project one discovered roster onto path-free rows, each marked with its layer. */
  private scopedRosterOf(presets: readonly AgentPreset[], layers: PresetLayers): AgentPresetRoster {
    const defaultId = this.defaultId
    return {
      presets: presets.map(preset => {
        const layer = this.layerOf(preset, layers)
        return {
          ...presetRow(preset, defaultId),
          scope: layer.kind,
          ...layer.kind === 'project' ? { projectDir: layer.projectDir } : {},
        }
      }),
      authorable: hasWritableRoot(layers.roots),
    }
  }

  /** Project one discovered roster onto the wire rows and the layer's authoring capability. */
  private rosterOf(presets: readonly AgentPreset[], roots: readonly PresetRoot[]): AgentPresetRoster {
    const defaultId = this.defaultId
    return {
      presets: presets.map(preset => presetRow(preset, defaultId)),
      authorable: hasWritableRoot(roots),
    }
  }

  /**
   * The roots one read or write acts on: the project root of the workspace
   * containing `cwd`, then the global layer.
   *
   * The project layer comes FIRST because root order is precedence and a
   * project preset is the one its own callers should get: a project that
   * authors a preset under a name the global layer also supplies means its
   * callers to run the project's copy, and the qualified identity keeps the two
   * mountable side by side for every other caller. The project root carries
   * `user` trust: a preset found there was authored by a person just as one
   * under the harness home was.
   * @param cwd - the caller's working directory, when it has one.
   * @returns the effective roots in precedence order, with the project layer
   * they carry.
   */
  private async layersFor(cwd?: string): Promise<PresetLayers> {
    const root = cwd === undefined ? undefined : await this.projectPresetsDir(cwd)
    if (root === undefined) return { roots: this.resolvedRoots }
    return {
      roots: [{ path: root, trust: 'user' } satisfies PresetRoot, ...this.resolvedRoots],
      project: { dir: dirname(root), root },
    }
  }

  /**
   * The project preset root of the workspace containing `cwd`, or undefined
   * when this deployment composes no workspace registry or no workspace
   * contains that directory. Nothing is created.
   * @param cwd - the caller's working directory.
   * @returns the absolute `presets/` directory of that project.
   */
  private async projectPresetsDir(cwd: string): Promise<string | undefined> {
    const registry = this.selfCtx.get('workspaceRegistry')
    return registry === undefined ? undefined : await registry.projectPresetsDirForPath(cwd)
  }

  /**
   * The project preset root one write named by `cwd` must land in, refusing
   * loud: a caller that asked for a project write and named no project would
   * otherwise author into the global layer and see the preset appear for
   * everybody.
   * @param cwd - the working directory naming the project.
   * @param presetId - the preset being written, named by the refusal.
   * @returns the absolute `presets/` directory of that project.
   * @throws {RemoteError} `agent-preset/invalid` when no project root resolves.
   */
  private async requireProjectPresetsDir(cwd: string | undefined, presetId: string): Promise<string> {
    const project = cwd === undefined ? undefined : await this.projectPresetsDir(cwd)
    if (project === undefined) {
      const reason = cwd === undefined
        ? 'a project write names the working directory it belongs to, and this request states none'
        : `no workspace contains the working directory ${JSON.stringify(cwd)}`
      throw new RemoteError('agent-preset/invalid', `agent-presets: cannot write preset "${presetId}" into a project: ${reason}`, {
        agentPreset: presetId,
        reason,
      })
    }
    return project
  }

  /**
   * The writable root one resolved preset is deleted from: the project layer's
   * own `presets/` directory when the identity names a project, otherwise the
   * deployment's first `user` root — which is also what refuses a preset the
   * deployment did not author.
   * @param preset - the resolved preset.
   * @param presetKey - the layer-qualified identity it was resolved as.
   * @returns the absolute directory the preset's own directory lives in.
   */
  private owningRoot(preset: AgentPreset, presetKey: string): string {
    const { layer } = identityParts(presetKey)
    return layer.kind === 'project'
      ? join(layer.projectDir, PROJECT_PRESETS_DIR)
      : writableRoot(this.resolvedRoots, preset.id)
  }

  /**
   * Every preset's composition as flattened plugin rows, for plugin-listing
   * surfaces beside the roster's own picker.
   *
   * A preset with a live standing mount answers from its newest generation's
   * Loader entries — the composition new sessions join — even when the file
   * behind it has since been edited into an unreadable state: the mount is
   * what sessions actually run, so the broken verdict only applies to a
   * preset nothing composed. One never composed since boot answers from its
   * file, with `!!js` disabled gates evaluated against the Loader context so
   * both answers reflect the same host. Reading never mounts: an unmounted
   * preset is parsed, not composed, so listing a preset's plugins cannot
   * activate them early. A composition that stopped reading between
   * discovery's health verdict and this read is reported broken with the
   * raced reason rather than dropped.
   *
   * This read names no working directory, so the global layer is the one it can
   * enumerate; a project composition is answered from its live mount, which is
   * the only project-layer fact a deployment-wide read can know.
   * @returns one composition per global-layer preset in roster order, then each
   * live project-layer mount this runtime holds.
   */
  async compositionInventory(): Promise<AgentPresetComposition[]> {
    const defaultId = this.defaultId
    // The Loader's own expression scope: what a mount decision would consult.
    // An identifier this scope cannot resolve throws under `with`, and the
    // row stays `'conditional'`; only a gate whose identifiers resolve BOTH
    // here and under a mounted row's entry chain, with different values,
    // could report a wrong verdict — the shipped gates read `process` alone.
    const evaluateExpression = (expression: string): unknown => evaluate(this.ctx.loader.ctx, expression)
    // Mount records span every Cordis runtime in the process; only this
    // runtime's mounts describe this roster's presets.
    const rootFiber = this.ctx.root.fiber
    const mounts = livePresetMounts(rootFiber)
    const listed = new Set<string>()
    const found: AgentPresetComposition[] = []
    for (const preset of await this.list()) {
      const identity = {
        id: preset.id,
        trust: preset.trust,
        ...preset.name === undefined ? {} : { name: preset.name },
        isDefault: preset.id === defaultId,
      }
      listed.add(globalIdentity(preset.id))
      // Before the broken verdict: a mounted preset whose file was since
      // deleted or corrupted still runs its standing composition. Newest
      // generation last: mount records keep insertion order, and a
      // superseded generation's record precedes its replacement's.
      const mount = mounts.findLast(candidate => candidate.presetKey === globalIdentity(preset.id))
      if (mount !== undefined) {
        found.push({ ...identity, rows: mountedCompositionRows(mount.tree) })
        continue
      }
      if (preset.broken !== undefined) {
        found.push({ ...identity, broken: preset.broken, rows: [] })
        continue
      }
      const read = await fileComposition(preset.path, evaluateExpression)
      found.push('broken' in read
        ? { ...identity, broken: read.broken, rows: [] }
        : { ...identity, rows: read.rows })
    }
    // The project layer is per caller and this read names none, so a project
    // preset is answered from its live mount: that is the one thing a
    // deployment-wide inventory can know about it, and the alternative — a
    // project composition no surface lists — is exactly the gap this read
    // exists to close.
    for (const mount of mounts) {
      if (!mount.presetKey.startsWith(PROJECT_IDENTITY_PREFIX)) continue
      if (listed.has(mount.presetKey)) continue
      listed.add(mount.presetKey)
      found.push({
        id: presetIdOf(mount.presetKey),
        trust: 'user',
        isDefault: false,
        rows: mountedCompositionRows(mount.tree),
      })
    }
    return found
  }

  /**
   * Resolve one preset by identity.
   *
   * A qualified identity (`global:<id>`, `project:<projectDir>:<id>`) is pinned
   * to the layer it names. A bare id follows the caller: with a `cwd` the
   * project layer of that working directory is consulted first, and with no
   * `cwd` — how a recorded identity that carries no layer prefix is read back —
   * the global layer alone answers, which is the layer every such record was
   * written from.
   *
   * A broken preset resolves — deleting one, reading one, and reporting one
   * all need the row — and the mounting paths refuse it AFTER resolution
   * through {@link resolveMountable}.
   * @param id - the preset identity, or `undefined` for {@link defaultId}.
   * @param cwd - the caller's working directory, when it has one.
   * @returns the resolved preset.
   * @throws when no root supplies that preset.
   */
  async resolve(id?: string, cwd?: string): Promise<AgentPreset> {
    return (await this.resolveTarget(id, cwd)).preset
  }

  /**
   * {@link resolve} beside the identity a session records for the result: the
   * bare id for a global preset, the qualified identity for a project one, so a
   * later resume resolves the same layer even when the other layer supplies the
   * same id.
   * @param id - the preset identity, or `undefined` for {@link defaultId}.
   * @param cwd - the caller's working directory, when it has one.
   * @returns the resolved preset and the identity to record for it.
   * @throws when no root supplies that preset.
   */
  async resolveIdentity(
    id?: string,
    cwd?: string,
  ): Promise<{ readonly preset: AgentPreset; readonly agentPreset: string }> {
    const target = await this.resolveTarget(id, cwd)
    return { preset: target.preset, agentPreset: recordedIdentity(target.presetKey) }
  }

  /**
   * Resolve one identity to its preset and its layer.
   * @param id - the preset identity, or `undefined` for {@link defaultId}.
   * @param cwd - the caller's working directory, when it has one.
   * @returns the resolved preset and its layer-qualified identity.
   * @throws when the named layer supplies no such preset.
   */
  private async resolveTarget(
    id: string | undefined,
    cwd: string | undefined,
  ): Promise<{ preset: AgentPreset; presetKey: string }> {
    const wanted = id ?? this.defaultId
    const { layer, id: presetId, qualified } = identityParts(wanted)
    if (layer.kind === 'project') {
      const root = join(layer.projectDir, PROJECT_PRESETS_DIR)
      const preset = await this.findIn([{ path: root, trust: 'user' } satisfies PresetRoot], presetId)
      return { preset, presetKey: projectIdentity(layer.projectDir, preset.id) }
    }
    const layers: PresetLayers = qualified ? { roots: this.resolvedRoots } : await this.layersFor(cwd)
    const preset = await this.findIn(layers.roots, presetId)
    return { preset, presetKey: this.identityOf(preset, layers) }
  }

  /**
   * The layer-qualified identity of one preset resolved from these layers: the
   * project layer's when the preset sits in the project root they carry, the
   * global layer's otherwise.
   * @param preset - the resolved preset.
   * @param layers - the roots it was resolved from.
   * @returns the identity a mount and a session record are keyed by.
   */
  private identityOf(preset: AgentPreset, layers: PresetLayers): string {
    const layer = this.layerOf(preset, layers)
    return layer.kind === 'project'
      ? projectIdentity(layer.projectDir, preset.id)
      : globalIdentity(preset.id)
  }

  /**
   * The layer one resolved preset came from: the project layer when the preset
   * sits in the project root these layers carry, the global layer otherwise.
   * @param preset - the resolved preset.
   * @param layers - the roots it was resolved from.
   * @returns the layer naming the preset's own directory.
   */
  private layerOf(preset: AgentPreset, layers: PresetLayers): PresetLayer {
    const project = layers.project
    return project !== undefined && dirname(preset.path) === join(project.root, preset.id)
      ? { kind: 'project', projectDir: project.dir }
      : { kind: 'global' }
  }

  /**
   * Resolve one bare preset id from one root set.
   * @param roots - the roots to discover from, in precedence order.
   * @param wanted - the bare preset id.
   * @returns the resolved preset.
   * @throws {RemoteError} `agent-preset/not-found` when no root supplies it.
   */
  private async findIn(roots: readonly PresetRoot[], wanted: string): Promise<AgentPreset> {
    const presets = await discoverPresets(roots, this.harnessBase)
    const found = presets.find(preset => preset.id === wanted)
    if (found === undefined) {
      const available = presets.map(preset => preset.id)
      throw new RemoteError(
        'agent-preset/not-found',
        `agent-presets: preset "${wanted}" not found (available: ${available.join(', ') || 'none'})`,
        { agentPreset: wanted, available },
      )
    }
    return found
  }

  /**
   * Resolve one preset that is about to compose an agent, refusing a broken
   * one with its discovery-reported reason. Failing here rather than inside
   * the loader keeps the answer the same for every unloadable shape — ghost
   * directory, unparsable YAML, rowless list — and spends no mount attempt
   * on a composition discovery already read as unusable.
   * @param id - the preset identity, or `undefined` for {@link defaultId}.
   * @param cwd - the caller's working directory, when it has one.
   * @returns the resolved, mountable preset and the identity to compose under.
   * @throws when the preset is unknown or discovery reports it broken.
   */
  private async resolveMountable(
    id: string | undefined,
    cwd: string | undefined,
  ): Promise<{ preset: AgentPreset; presetKey: string }> {
    const target = await this.resolveTarget(id, cwd)
    if (target.preset.broken !== undefined) {
      throw new RemoteError(
        'agent-preset/invalid',
        `agent-presets: preset "${target.preset.id}" failed to mount: ${target.preset.broken}`,
        { agentPreset: target.preset.id, reason: target.preset.broken },
      )
    }
    return target
  }

  /**
   * Standing mounts by layer-qualified preset identity, single-flight so two
   * agents racing the first use of one preset share one composition.
   *
   * The identity rather than the bare id is the key because two layers — the
   * global one and any project's — may each hold a preset of the same id, and
   * those are two different compositions that must not share a mount. A settled
   * failure is removed so a later session retries a preset whose file has been
   * fixed; a settled success serves until the composition FILE visibly changes
   * — each generation records its file stamp, and a stale stamp starts the next
   * generation for sessions created afterwards. Sessions already joined keep
   * the generation they run on; a superseded one is never disposed while the
   * process lives (reclaimed only by whole-tree teardown), so editing files
   * is bounded by how often compositions change, not by session count.
   */
  private readonly standing = new Map<string, Promise<StandingMount>>()

  /**
   * Parent bindings of the agents this roster composed, keyed by the agent's
   * scope key. The binding is dsh-scope's only re-link capability; holding it
   * here makes this service the sole authority that can move an agent between
   * standing compositions. WeakMap: entries die with their agents.
   */
  private readonly bindings = new WeakMap<ScopeKey, ScopeParentBinding>()

  /**
   * Compose one agent from a preset: ensure the preset's standing mount, then
   * parent the agent's scope key to it so the mount's registrations and
   * listeners cover this agent.
   *
   * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
   * the agent creation back, so a broken preset never yields a half-composed
   * session. The working directory comes from the agent's own live session
   * header, so a preset id that both layers supply resolves to the project's
   * copy for an agent of that project; a caller that already resolved the
   * layers passes the qualified identity instead.
   * @param agentCtx - the agent's scope context.
   * @param id - the preset identity, or `undefined` for {@link defaultId}.
   * @returns the preset that was composed, for the caller to record.
   * @throws when the preset is unknown or its composition is unusable.
   */
  async mount(agentCtx: Context, id?: string): Promise<AgentPreset> {
    const agentKey = scopeOf(agentCtx)
    if (agentKey === undefined) {
      throw new Error('agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset')
    }
    const target = await this.resolveMountable(id, this.cwdOf(agentCtx))
    const standing = await this.ensureStanding(target.preset, target.presetKey)
    // The one bind of this agent's ancestry. The binding is the only re-link
    // authority, held privately so nothing outside this roster can move a
    // composed agent to another preset; a later recompose layer re-links
    // through it under the caller-owned blank-session contract.
    this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
    return target.preset
  }

  /**
   * The working directory one composing agent owns, read from its live session
   * header. Absent on a context with no agent — an embedder mounting directly —
   * which resolves the global layer exactly as a caller naming no directory does.
   * @param agentCtx - the context being composed.
   * @returns the working directory, when the agent has one.
   */
  private cwdOf(agentCtx: Context): string | undefined {
    // The context proxy refuses an unknown property read outright rather than
    // answering undefined, and `agent` is an own property only on an Agent's
    // own context, so the presence check comes first.
    if (!Object.hasOwn(agentCtx, 'agent')) return undefined
    return agentCtx.agent?.session.header.cwd
  }

  /**
   * Join one agent to the SAME standing composition another already runs on.
   *
   * This is how a child agent inherits its parent's capabilities. It is a bind,
   * not a mount: the parent's generation is already composed, so the child gets
   * that exact instance — the same plugin objects, the same tool registrations,
   * the same prompt sections. Re-resolving the parent's preset by id instead
   * would re-read the roster, and a composition file edited since the parent
   * started would hand the child a DIFFERENT generation than the one its
   * parent's history was produced under (and a preset deleted since would fail
   * the child outright while its parent keeps running).
   *
   * Synchronous, and with no composition failure mode of its own — it reads no
   * roster, mounts nothing, and touches no file — which is what lets a child
   * creation window use it: the two in-process subagent drivers compose their
   * children inside a synchronous `setup`. It still rejects a caller error, as
   * the `@throws` below record.
   *
   * A parent that joined no preset — a rosterless deployment — yields no join
   * and no error: there, the model-facing rows sit in the host composition and
   * the child already sees them through the global layer.
   * @param agentCtx - the joining agent's scope context.
   * @param parentCtx - the scope context of the agent whose composition to join.
   * @returns the preset identity joined, or undefined when the parent joined
   * none. A project-layer parent yields its qualified identity, which is what
   * pins the child to the same layer when its own log is read back.
   * @throws when `agentCtx` carries no scope, or has already joined a preset.
   */
  composeFrom(agentCtx: Context, parentCtx: Context): string | undefined {
    const agentKey = scopeOf(agentCtx)
    if (agentKey === undefined) {
      throw new Error('agent-presets: refusing to compose an unscoped context; the scope key is what joins an agent to its preset')
    }
    const standing = standingMountFor(parentCtx)
    if (standing === undefined) return undefined
    this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
    return recordedIdentity(standing.presetKey)
  }

  /**
   * The preset one live agent runs on.
   *
   * Read from the live scope chain rather than from the session, so it answers
   * for an agent whose session has not recorded a preset yet — a child agent
   * whose durable header is being built from its parent's composition.
   * @param agentCtx - the agent's scope context.
   * @returns the preset identity, or undefined when the agent joined none.
   */
  composedPreset(agentCtx: Context): string | undefined {
    const standing = standingMountFor(agentCtx)
    return standing === undefined ? undefined : recordedIdentity(standing.presetKey)
  }

  /**
   * The GLOBAL layer this roster scans, which is not `config.roots`: the
   * package's shipped root unless `includeShippedRoot` is false, every
   * configured root in order, then the harness-home user root unless
   * `includeUserRoot` is false. Read this — not the config field — to answer
   * whether a roster is composed at all, so one derivation decides it. A
   * project layer is per caller, so it is never part of this reading.
   */
  get roots(): readonly PresetRoot[] {
    return this.resolvedRoots
  }

  /** Whether this deployment has a root locally authored presets go to. */
  get authorable(): boolean {
    return hasWritableRoot(this.resolvedRoots)
  }

  /**
   * Read one preset's composition text.
   * @param id - the preset identity.
   * @param cwd - the caller's working directory, when it has one; it selects
   * the layer a bare id resolves in, exactly as {@link resolve} does.
   * @returns the composition exactly as stored.
   * @throws when no configured root supplies that preset.
   */
  async read(id: string, cwd?: string): Promise<string> {
    return await readComposition(await this.resolve(id, cwd))
  }

  /**
   * One preset's composition text with the roster row it belongs to.
   *
   * The wire carries no working directory, and this read answers for the
   * deployment-wide layer: a bare id resolves globally, and a project preset is
   * read by the qualified identity its session recorded.
   * @param agentPreset - the preset identity.
   * @returns the composition beside its trust and published metadata.
   * @throws {RemoteError} `gateway/bad-request` for an empty id, or
   * `agent-preset/not-found` when no configured root supplies it.
   */
  @Remote('read')
  async readDocument(agentPreset: string): Promise<AgentPresetDocument> {
    validatePresetId(agentPreset, 'agentPreset')
    const preset = await this.resolve(agentPreset)
    return {
      agentPreset,
      trust: preset.trust,
      content: await readComposition(preset),
      ...preset.name === undefined ? {} : { name: preset.name },
      ...preset.description === undefined ? {} : { description: preset.description },
    }
  }

  /**
   * Create a locally authored preset by copying an existing one whole.
   *
   * Copy is the only authoring write. Composition text never crosses this
   * seam: the source is named by id and its directory is copied as it stands,
   * so the copy is exactly as loadable as its source and authoring grants no
   * capability the roster did not already carry. The copy is NOT mounted to
   * validate — a source that mounts today yields a copy that mounts today.
   *
   * The copy lands in the deployment's first `user` root. {@link save} is the
   * authoring write that can name the caller's project root instead.
   * @param from - the preset the copy starts from; shipped presets are the
   * primary source, so any trust is accepted.
   * @param id - the new preset's id, which becomes its directory name.
   * @param name - display name for the copy; absent falls back to the id.
   * @throws when the source is unknown, the id is unusable or already taken,
   * or the deployment configures no writable root.
   */
  async copy(from: string, id: string, name?: string): Promise<void> {
    const source = await this.resolve(from)
    await this.copyFrom(this.resolvedRoots, writableRoot(this.resolvedRoots, id), source, id, name)
  }

  /**
   * {@link copy} with the source already resolved and its display text decided.
   * @param roots - the roots the id is checked against and the copy is
   * resolved from, in precedence order.
   * @param root - the absolute writable root the copy lands in.
   * @param source - the resolved preset the copy starts from.
   * @param id - the new preset's id, which becomes its directory name.
   * @param name - display name for the copy; absent falls back to the id in
   * the picker rather than to the source's name.
   * @param description - description the copy publishes; absent keeps the
   * source's own.
   * @returns the absolute path of the new preset directory.
   * @throws when the id is unusable or already taken.
   */
  private async copyFrom(
    roots: readonly PresetRoot[],
    root: string,
    source: AgentPreset,
    id: string,
    name?: string,
    description?: string,
  ): Promise<string> {
    // The roster check refuses ids any effective root supplies — shipped and
    // project ones included, since a directory named like one of them is
    // shadowed by it. The disk check inside copyComposition only sees the
    // target root.
    if ((await discoverPresets(roots, this.harnessBase)).some(preset => preset.id === id)) {
      throw presetExists(id)
    }
    const dir = await copyComposition(root, source, id, name, description)
    // A settled mount under this id can only be stale (its preset was deleted
    // from disk outside `remove`); the new preset must not inherit it. Every
    // session already joined keeps the generation it runs on regardless.
    this.forgetStanding(id)
    return dir
  }

  /**
   * Drop every settled mount of one preset id, in whichever layer holds one.
   *
   * An authoring write never touches a composition file, so a dropped mount
   * only costs the next session a remount; keeping a stale entry would serve a
   * generation belonging to a preset that no longer occupies the id.
   * @param id - the bare preset id whose mounts to drop.
   */
  private forgetStanding(id: string): void {
    for (const key of this.standing.keys()) {
      if (presetIdOf(key) === id) this.standing.delete(key)
    }
  }

  /**
   * Copy one preset through the Remote API.
   * @param from - the source preset id.
   * @param id - the new preset id.
   * @param name - the copy's optional display name.
   * @returns once the copy is stored.
   * @throws {RemoteError} with the corresponding stable preset code and
   * details when the copy is refused.
   */
  @Remote('copy')
  async remoteExportCopy(from: string, id: string, name?: string): Promise<void> {
    validatePresetId(from, 'from')
    validatePresetId(id, 'agentPreset')
    await this.copy(from, id, name)
  }

  /**
   * Create or rewrite one mode: its display text and its declared flow.
   *
   * A NEW preset needs `from`, the existing preset whose composition is
   * copied whole; a rewrite omits it and keeps the composition the preset
   * already has. Neither path carries composition text — the fields a caller
   * can state are exactly the mode, never what it mounts — so authoring grants
   * no capability the source roster did not already carry.
   *
   * On a rewrite, absent fields keep what is stored: a caller changing only
   * the steps does not have to restate the name, and a `free` declaration
   * drops the stored flow. On a create, `from`'s description carries over
   * unless the request states one. A rewrite writes into the directory that
   * holds the preset it resolved, which must be the target root's own.
   *
   * The request's `target` names the layer: the deployment's `user` root, or —
   * with the `cwd` it belongs to — the caller's project root, where the preset
   * is then visible to that project's callers alone. For either layer the
   * roots the request reads include the project root of `cwd` when there is
   * one, so a rewrite finds the preset where the caller sees it; the write
   * itself then refuses a preset that does not live under the named layer
   * instead of shadowing it with a second directory elsewhere.
   * @param request - the mode to store, and the source for a new one.
   * @throws {RemoteError} `agent-preset/invalid` when the fields are unusable
   * or a project target names no project, `agent-preset/read-only` when the
   * target is not the user's to change, or `agent-preset/not-found` when
   * `from` names no preset.
   */
  async save(request: AgentPresetWriteRequest): Promise<void> {
    const { id, from } = request
    const layers = await this.layersFor(request.cwd)
    // A create copies the source's whole directory, so its display text is
    // what the copy publishes unless the request states otherwise.
    const source = from === undefined ? undefined : (await this.resolveTarget(from, request.cwd)).preset
    const current = source === undefined ? (await this.resolveTarget(id, request.cwd)).preset : undefined
    if (current !== undefined && current.trust !== 'user') {
      throw notWritable(id, 'it ships with the deployment')
    }
    // The one root this write lands in. A named project target must resolve, so
    // a caller working outside every workspace is told rather than silently
    // authoring into the global layer; the default stays the first `user` root
    // of the global layer, which is the directory the roster has always
    // written to.
    const root = request.target === 'project'
      ? await this.requireProjectPresetsDir(request.cwd, id)
      : writableRoot(this.resolvedRoots, id)
    const flow = resolveAuthoredFlow(id, request, current)
    // An absent field keeps what the preset already says — a rewrite carries
    // the stored display text and roster `order` forward, because a rewrite
    // changes what the mode says, never where it sorts. A mode created
    // without a name is named by its id, the picker's own fallback; a name
    // stated as blanks reads as absent, because the renderer would drop it
    // and the write would then report success over an unchanged file.
    const stated = request.name?.trim()
    const name = stated === undefined || stated === '' ? current?.name ?? id : stated
    const description = request.description ?? (current ?? source)?.description
    const content = renderPresetDocument({
      name,
      ...description === undefined ? {} : { description },
      ...current?.order === undefined ? {} : { order: current.order },
    }, flow)
    let created: string | undefined
    if (source !== undefined) {
      // The copy carries the whole directory; only the authorable half is
      // replaced below, and the copy's own display text is written there.
      created = await this.copyFrom(layers.roots, root, source, id, name, description)
    }
    try {
      // The write target is the preset this request resolved, so a rewrite
      // lands in the directory that holds it instead of another root's
      // directory of the same name, which would shadow it.
      const target = current ?? (await this.resolveTarget(id, request.cwd)).preset
      /* v8 ignore next -- the non-empty `name` above always renders display text, so the document is never undefined */
      if (content !== undefined) await writePresetDocument(root, target, content)
    } catch (error) {
      // One create is a copy plus a document; a copy whose document never
      // landed would stay on the roster as a mode carrying the source's
      // description and no declaration, so it goes with the failure.
      if (created !== undefined) await rm(created, { recursive: true, force: true })
      throw error
    }
    // A settled mount under this id can only be stale — the composition is
    // untouched either way, and a session already joined keeps its generation.
    this.forgetStanding(id)
  }

  /**
   * Create or rewrite one mode through the Remote API.
   * @param request - the mode to store, and the source for a new one.
   * @returns once the mode is stored.
   * @throws {RemoteError} with the corresponding stable preset code and
   * details when the write is refused.
   */
  @Remote('savePreset')
  async remoteExportSavePreset(request: AgentPresetWriteRequest): Promise<void> {
    validatePresetId(request.id, 'agentPreset')
    if (request.from !== undefined) validatePresetId(request.from, 'from')
    await this.save(request)
  }

  /**
   * Delete a locally authored preset.
   *
   * `cwd` names the caller's working directory, which widens the layers this
   * resolves against exactly as {@link list} does: a project preset is deleted
   * from its own project root, and a global one still from the global layer.
   * Naming the preset by its qualified identity deletes that layer's copy
   * without consulting a working directory at all.
   * @param id - the preset identity.
   * @param cwd - the caller's working directory, when it has one.
   * @throws when the preset is unknown or ships with the deployment.
   */
  async remove(id: string, cwd?: string): Promise<void> {
    const target = await this.resolveTarget(id, cwd)
    await deleteComposition(this.owningRoot(target.preset, target.presetKey), target.preset)
    // Only this layer's settled mount goes: sessions already on it keep the
    // generation they run on, and the same id in another layer is a different
    // preset that this delete never touched.
    this.standing.delete(target.presetKey)
    // Storing a default that does not exist YET is deliberate — the roster is a
    // live directory, so a name absent now may exist by the time a session asks
    // for it, and `resolve` reports it then. A default this call just deleted is
    // not that case: nothing will ever supply it again, and left in place every
    // session created without an explicit pick would fail to start. Clearing it
    // exposes the deployment's own default underneath, which is the layering.
    if (this.settings?.get().default !== id) return
    await this.settingsService?.mutate(
      SETTINGS_NAMESPACE,
      [{ op: 'unset', path: ['default'] }],
    )
  }

  /**
   * Delete one preset through the Remote API.
   * @param id - the preset id.
   * @returns once the preset is deleted.
   * @throws {RemoteError} with the corresponding stable preset code and
   * details when deletion is refused.
   */
  @Remote('deletePreset')
  async remoteExportDelete(id: string): Promise<void> {
    validatePresetId(id, 'agentPreset')
    await this.remove(id)
  }

  /**
   * One agent's instance of a service its preset mounted.
   *
   * A preset publishes services behind `isolate` realms, which are invisible
   * outside the group that declares them — including to the host. This is how a
   * caller holding the agent reads one anyway: a request that is ABOUT a
   * session but arrives from outside it, which is every browser RPC.
   *
   * Read addressing only. A host row that `inject`s a service cannot use this,
   * because injection resolves before any session exists and has no agent to
   * key by; such a service belongs on the host plane instead.
   * @param agent - the agent whose composition to look inside.
   * @param name - the service name as the preset's rows resolve it.
   * @returns the agent's instance, or undefined when its preset mounts none.
   */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    return serviceForAgent(this.ctx, agent, name)
  }

  /**
   * Re-link one agent to a different preset's standing composition.
   *
   * Only valid while the agent has produced nothing: swapping tools mid
   * conversation would leave logged tool calls the new composition cannot
   * make. The CALLER owns that check — this method does not read session
   * history.
   *
   * The swap is a parent re-link, not an unmount: standing mounts are shared
   * and permanent, so the old composition stays for its other agents and the
   * new one is ensured BEFORE the link moves. An unknown or unusable preset
   * therefore throws with the agent exactly as it was — there is no torn-down
   * state to restore. The re-link runs through the binding this roster kept
   * from the agent's mount — dsh-scope's only re-link authority. An agent
   * that never composed one has nothing to re-link: the switch is then the
   * agent's first bind, exactly a mount. A committed re-link emits
   * `tools/change` because changing the parent scope changes the Agent's
   * resolved tool set without adding or removing registry entries.
   * @param agentCtx - the agent's scope context.
   * @param id - the preset to compose the agent from instead.
   * @returns the preset now installed.
   * @throws when the preset is unknown or its composition is unusable.
   */
  async recompose(agentCtx: Context, id: string): Promise<AgentPreset> {
    const agentKey = scopeOf(agentCtx)
    if (agentKey === undefined) {
      throw new Error('agent-presets: refusing to recompose an unscoped context')
    }
    const target = await this.resolveMountable(id, this.cwdOf(agentCtx))
    const standing = await this.ensureStanding(target.preset, target.presetKey)
    const binding = this.bindings.get(agentKey)
    if (binding === undefined) {
      this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))
    } else {
      binding.rebind(standing.key)
    }
    // Reparenting changes every scope-layered tool view without adding or
    // removing a registration. Publish the registry's normal invalidation so
    // Agent-owned overlays can reconcile with the new ancestry.
    try {
      this.ctx.emit('tools/change')
    } catch (error: unknown) {
      this.ctx.logger.warn(`agent-presets: tools/change listener failed after recomposing an Agent: ${String(error)}`)
    }
    return target.preset
  }

  /**
   * Serializes {@link select} per session. Two concurrent selects would both
   * pass the blank check, and the second re-link would then find the record
   * the first already replaced — leaving two compositions registered into one
   * agent layer. A client's `busy` flag is not enforcement: the wire is
   * reachable directly.
   *
   * Entries hold a failure-swallowing guard rather than the turn itself, so a
   * refused switch does not reject the next caller's chain.
   */
  private readonly switches = new Map<string, Promise<unknown>>()

  /**
   * Compose a blank session's agent from a different preset and record it.
   * @param agent - the session's live agent, resolved from the wire identity.
   * @param agentPreset - the preset to compose the agent from instead.
   * @returns the preset id that was recorded.
   * @throws {RemoteError} with `gateway/bad-request`, `agent-preset/locked`,
   * `agent-preset/not-found`, or `agent-preset/invalid` when refused.
   */
  @Remote('select')
  async select(agent: Agent, agentPreset: string): Promise<string> {
    validatePresetId(agentPreset, 'agentPreset')
    const queued = this.switches.get(agent.id) ?? Promise.resolve()
    const turn = queued.then(() => this.swap(agent, agentPreset))
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try {
      return await turn
    } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /** One queued switch: re-check, recompose, then record what the agent runs. */
  private async swap(agent: Agent, agentPreset: string): Promise<string> {
    // Re-read inside the queue: an earlier switch may have run, and a
    // conversation may have started, since this call was queued. A turn is one
    // model-loop execution; standalone plugin events never open one, so a
    // session that has only run commands is still blank.
    const boundary = this.selfCtx.sessionProjections.stateOf(agent.session, 'turnBoundary')
    if (boundary !== undefined
      && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
      throw new RemoteError(
        'agent-preset/locked',
        `session "${agent.id}" has already started; its agent preset is fixed`,
        { sessionId: agent.id, agentPreset },
      )
    }
    const preset = await this.recompose(agent.ctx, agentPreset)
    // Recorded only after the swap committed: the log states what the agent
    // runs, and a rejected mount leaves the previous composition. The recorded
    // value is the identity that was composed, so a project preset keeps its
    // layer through a resume.
    const recorded = this.composedPreset(agent.ctx) ?? preset.id
    agent.session.append('agent-preset/selected', { agentPreset: recorded })
    return recorded
  }

  /**
   * The standing scope key of one preset, for a host reader with no agent.
   *
   * A cold transcript read resolves tool presenters against the composition
   * the session recorded, and the standing mount makes that possible without
   * resuming anything: ensuring the mount composes plugins but starts no
   * agent, no session, and no turn.
   * @param id - the preset identity, or `undefined` for {@link defaultId}.
   * @param cwd - the caller's working directory, when it has one; a caller
   * holding a recorded identity passes that identity instead.
   * @returns the standing scope key readers pass as a registry view scope.
   * @throws when the preset is unknown or its composition is unusable.
   */
  async standingKeyFor(id?: string, cwd?: string): Promise<ScopeKey> {
    const target = await this.resolveMountable(id, cwd)
    return (await this.ensureStanding(target.preset, target.presetKey)).key
  }

  /**
   * Resolve (or create, single-flight) the standing mount of one preset.
   *
   * Keyed by the layer-qualified identity, so the same id in two layers is two
   * compositions. The file stamp is read from the preset's own composition
   * file, which is the resolved layer's: a project copy changing never
   * refreshes the global mount, and the other way round.
   * @param preset - the resolved preset to mount.
   * @param identity - the layer-qualified identity the mount is keyed by.
   * @returns the standing mount serving that identity.
   */
  private async ensureStanding(preset: AgentPreset, identity: string): Promise<StandingMount> {
    const pending = this.standing.get(identity)
    if (pending !== undefined) {
      const mounted = await pending
      // Files are the only composition editor (authoring is copy/delete), so
      // the stamp is what notices an edit: a changed file starts the next
      // generation here, for this and later sessions. An unreadable stamp
      // serves the current generation — a mount must survive its file
      // disappearing, and failing the session over a stat would not.
      const current = await compositionStamp(preset.path)
      if (current === undefined || sameStamp(mounted.stamp, current)) return mounted
      // TODO: reclaim the superseded generation once the last agent joined to
      // it is gone. The subtree is not inert — `dsh-skill-filesystem` watches its
      // roots — and the settings-page authoring flow turns "a composition
      // changed" into a per-save event. This needs a joined-agent count on
      // StandingMount, incremented in `mount`/`composeFrom`/`recompose` and
      // decremented when the agent's scope key dies.
      // Guarded delete: a caller that raced this one may have already started
      // the next generation, and dropping THAT pointer would fork a third.
      if (this.standing.get(identity) === pending) this.standing.delete(identity)
      return this.ensureStanding(preset, identity)
    }
    const created = (async (): Promise<StandingMount> => {
      const key: ScopeKey = { agentPreset: identity }
      const scope = createScope(this.selfCtx, key)
      try {
        // Stamped before the file is read: an edit racing the mount makes the
        // stamp stale rather than silently current, so the next session
        // refreshes instead of trusting a composition older than its stamp.
        const stamp = await compositionStamp(preset.path)
        if (stamp === undefined) {
          const reason = `composition file is unreadable: ${preset.path}`
          throw new RemoteError(
            'agent-preset/invalid',
            `agent-presets: preset "${preset.id}" failed to mount: ${reason}`,
            { agentPreset: preset.id, reason },
          )
        }
        await mountPreset(scope.ctx, preset, identity)
        return { key, scope, stamp }
      } catch (error) {
        this.standing.delete(identity)
        await scope.dispose()
        throw error
      }
    })()
    this.standing.set(identity, created)
    return created
  }
}

/** The composition file identity one standing generation was mounted from. */
interface CompositionStamp {
  /** Modification time in milliseconds, as `stat` reports it. */
  readonly mtimeMs: number
  /** File size in bytes, the tiebreak for edits within one mtime tick. */
  readonly size: number
}

/** Read one composition file's stamp, or undefined when it cannot be statted. */
async function compositionStamp(path: string): Promise<CompositionStamp | undefined> {
  try {
    const { mtimeMs, size } = await stat(path)
    return { mtimeMs, size }
  } catch {
    // Deleted, replaced by an unreadable entry, or otherwise unstattable all
    // mean the same to the caller: the file offers no identity to compare.
    return undefined
  }
}

/** Whether two stamps name the same file state. */
function sameStamp(a: CompositionStamp, b: CompositionStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

/** One preset's standing composition. */
interface StandingMount {
  /** Scope key agents are parented to; also the mount's registration scope. */
  readonly key: ScopeKey
  /** Disposal boundary; held for whole-tree teardown, never per-session. */
  readonly scope: Scope
  /** Stamp of the composition file this generation was mounted from. */
  readonly stamp: CompositionStamp
}

export default AgentPresets
