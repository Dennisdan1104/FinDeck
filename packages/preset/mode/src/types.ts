/**
 * Pure types of the session-mode domain: the ONE home of the `mode`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis, dsh-tools, dsh-agent). Client code imports ONLY the client
 * namespace (repo discipline), so `./client` re-exports this single source
 * with zero duplication.
 *
 * @module @deepseek-ai/dsh-mode/types
 */

/** Host fold state for the session-mode projection. */
export interface ModeUnitState {
  /** The prompt-level mode in force: the preset id whose persona the session runs, or null under a rosterless deployment. */
  readonly mode: string | null
  /** Declared flow steps in declaration order; the last entry is the current step. */
  readonly steps: readonly string[]
  /** Whether the session-level AI-cluster preference is on; false when the session never turned it on. */
  readonly cluster: boolean
}

/**
 * The `mode` projection's wire value. `mode` follows the composition preset —
 * the creation header, a blank session's selection, and every switch recorded
 * as `agent-preset/selected` — plus the `mode/switched` records earlier builds
 * wrote; `steps` is the declared trail — the step ids of a work mode's flow, or
 * the free-form labels a free mode declared. `step` is the current step: the
 * last declaration, or null before the first. `cluster` is the session-level
 * AI-cluster preference: false until the session turns it on.
 */
export interface ModeProjection {
  readonly mode: string | null
  readonly step: string | null
  readonly steps: readonly string[]
  readonly cluster: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host session-mode fold state. */
    mode: ModeUnitState
  }
  interface SessionProjectionMap {
    /** Session mode and declared flow-step trail folded from mode events. */
    mode: ModeProjection
  }
}
