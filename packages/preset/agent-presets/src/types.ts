/** Client-safe payloads and event declarations owned by the agent-preset domain. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FlowDefinition, FlowStepCluster, PresetModeKind } from './mode.ts'
import type { PresetTrust } from './preset.ts'

export type { PresetTrust } from './preset.ts'
export type { FlowDefinition, FlowStep, FlowStepCluster, PresetModeKind } from './mode.ts'

/**
 * One roster row as a client reads it. Path-free: a preset is addressed by id
 * everywhere off the Host, and the composition's location is the Host's own.
 */
export interface AgentPresetRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string
  /** Mode classification the preset declared; absent means `free`. */
  readonly modeKind?: PresetModeKind
  /** The declared work-mode flow; present exactly when {@link modeKind} is `work`. */
  readonly flow?: FlowDefinition
  /**
   * Layer this row was read from: `project` when the read named a working
   * directory whose project root supplied it, `global` otherwise. Absent on a
   * deployment-wide read (`list`), which can answer only the global layer.
   */
  readonly scope?: 'global' | 'project'
  /** Absolute project directory this row's layer belongs to; present exactly when {@link scope} is `project`. */
  readonly projectDir?: string
}

/** The roster one deployment currently supplies, with its authoring capability. */
export interface AgentPresetRoster {
  /** Every preset the configured roots supply, first-root-wins per id. */
  readonly presets: readonly AgentPresetRow[]
  /** Whether this deployment has a root locally authored presets go to. */
  readonly authorable: boolean
}

/** Roster read naming the working directory whose project layer to include. */
export interface AgentPresetRosterForRequest {
  /** Working directory identifying the project; the read creates nothing. */
  readonly cwd: string
}

/** One flow step as the mode-authoring callers declare it. */
export interface AgentPresetStep {
  /** Machine id; kebab-case, unique within the flow. */
  readonly id: string
  /** Display name. */
  readonly label: string
  /** `'default'` follows the session model; otherwise `provider/model`. */
  readonly model: string
  /** What this step is for; optional, and appended to the flow's step entry. */
  readonly prompt?: string
  /** The AI-cluster declaration: when present, this step is executed by the cluster. */
  readonly cluster?: FlowStepCluster
}

/**
 * Which preset root one authoring write lands in: the deployment's `user` root,
 * or the project root of the working directory that names the write.
 */
export type PresetWriteTarget = 'user' | 'project'

/**
 * One mode-authoring request: create from a copy, or rewrite a stored mode.
 *
 * The composition is deliberately absent. Authoring carries no composition
 * text, so these are the complete fields a caller can state — everything a
 * mode IS, apart from which plugins it mounts.
 *
 * Optional fields accept an explicit `undefined` because this type crosses
 * the Remote wire: a JSON caller that states the key with no value is asking
 * for the stored value to stand, and must not be handed to `exactOptional-
 * PropertyTypes` spreads that would write `undefined` as a tested value.
 */
export interface AgentPresetWriteRequest {
  /** Id of the preset to create or rewrite; also its directory name. */
  readonly id: string
  /** Existing preset whose composition a NEW preset is copied from; absent rewrites an existing one. */
  readonly from?: string | undefined
  /** Display name; absent keeps the stored one on a rewrite and the id on a create. */
  readonly name?: string | undefined
  /** One sentence on what the preset is for; absent keeps the stored one on a rewrite. */
  readonly description?: string | undefined
  /** `work` declares the flow below; absent keeps a rewrite's stored kind. */
  readonly modeKind?: PresetModeKind | undefined
  /** The work-mode steps, in order; replaces a rewrite's stored flow. */
  readonly steps?: readonly AgentPresetStep[] | undefined
  /**
   * Which preset root receives the write: the deployment's `user` root (the
   * default), or the project root of the workspace containing {@link cwd}.
   * A `project` write without a project refuses rather than falling back.
   */
  readonly target?: PresetWriteTarget | undefined
  /**
   * Working directory identifying the project a `project` write targets, and
   * widening the presets a rewrite or a copy-existence check sees. Absent
   * leaves the write on the global layer, where no project preset is visible.
   */
  readonly cwd?: string | undefined
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No configured root supplies the requested id. */
    'agent-preset/not-found': { readonly agentPreset: string; readonly available: readonly string[] }
    /** The id is unusable, already taken, or its composition cannot be installed. */
    'agent-preset/invalid': { readonly agentPreset: string; readonly reason: string }
    /** The preset ships with the deployment and is not the user's to change. */
    'agent-preset/read-only': { readonly agentPreset: string; readonly reason: string }
    /** The session's conversation has started, so its composition is fixed. */
    'agent-preset/locked': { readonly sessionId: SessionId; readonly agentPreset: string }
  }
}

/** One preset's composition text beside the row it belongs to. */
export interface AgentPresetDocument {
  /** The preset the composition belongs to. */
  readonly agentPreset: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** The composition exactly as stored. */
  readonly content: string
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentPreset: string | null
  }
  interface SessionProjectionMap {
    /** Preset the Session runs, or null when the deployment composes none. */
    agentPreset: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

export {}
