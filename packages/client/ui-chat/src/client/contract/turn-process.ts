import type { ChatNode } from './chat-nodes.ts'

/** Current process range and finalized answer boundary derived from one Turn. */
export interface TurnProcessSpec {
  readonly turn: number
  /** Stable control-node anchor source, including currently ineligible evidence. */
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  /** Reply-bearing durable Assistant messages before the final answer. */
  readonly messageCount: number
  /** Durable non-subagent Tool calls recorded by this Turn. */
  readonly toolCallCount: number
  /** Tool calls whose configured name identifies a subagent delegation. */
  readonly subagentCount: number
}

const TURN_PROCESS_INDEPENDENT_KIND_LIST = [
  'system-prompt',
  'user',
  'steering',
  'turn-process',
  'turn-error',
  'turn-max-tokens',
  'turn-tail',
] as const satisfies readonly ChatNode['kind'][]

/** Chat Node kinds that remain independent of a Turn's process disclosure. */
export const TURN_PROCESS_INDEPENDENT_KINDS: ReadonlySet<string> = new Set(
  TURN_PROCESS_INDEPENDENT_KIND_LIST,
)

/**
 * Compare immutable Turn-process specifications by their published fields.
 * @param left - previous specification.
 * @param right - next specification.
 * @returns whether both values describe the same process presentation.
 */
export function sameTurnProcessSpec(left: TurnProcessSpec, right: TurnProcessSpec): boolean {
  return left.turn === right.turn
    && left.controlAnchorSeq === right.controlAnchorSeq
    && left.processStartSeq === right.processStartSeq
    && left.answerAnchorSeq === right.answerAnchorSeq
    && left.answerStep === right.answerStep
    && left.inlineReasoning === right.inlineReasoning
    && left.messageCount === right.messageCount
    && left.toolCallCount === right.toolCallCount
    && left.subagentCount === right.subagentCount
}

/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

/**
 * Keep live, stopped, and failed Turns open.
 * @param node - Node carrying the owning Turn.
 * @returns whether whole-Turn collapse is unavailable.
 */
export function turnProcessAlwaysOpen(node: ChatNode | undefined): boolean {
  const location = node?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return false
  const reason = location.turn.end?.data.reason.kind
  return location.turn.status === 'open' || reason === 'aborted' || reason === 'error'
}

/** Lifecycle one process segment reports at its head. */
export type TurnProcessSegmentState = 'running' | 'done' | 'none'

/** Tool-call families one process action run aggregates. */
export interface TurnProcessToolCounts {
  /** `read`, `read_image`, `glob`, `grep`, and the read-only inspection tools. */
  readonly browse: number
  readonly webSearch: number
  readonly webFetch: number
  /** `bash` and `pwsh`. */
  readonly shell: number
  /** `write` and `edit`. */
  readonly fileWrite: number
  readonly subagent: number
  readonly other: number
}

/** One aggregate family of {@link TurnProcessToolCounts}. */
export type TurnProcessToolFamily = keyof TurnProcessToolCounts

/** Lifecycle of one aggregated Tool call as its row presents it. */
export type TurnProcessCallState = 'running' | 'ok' | 'error'

/** One file mutation an action run presents as a chip. */
export interface TurnProcessFileChange {
  /** Node key of the owning Tool row, stable across updates. */
  readonly key: string
  readonly path: string
  readonly added: number
  readonly removed: number
  readonly state: TurnProcessCallState
}

/** One member row of an aggregated action run. */
export type TurnProcessMember =
  | { readonly kind: 'call'; readonly key: string }
  | ({ readonly kind: 'file' } & TurnProcessFileChange)

/** One uninterrupted run of Tool calls between the Turn's other process rows. */
export interface TurnProcessActionRun {
  /** First member key: the row's flow position, React key, and stable identity. */
  readonly key: string
  readonly members: readonly TurnProcessMember[]
  readonly counts: TurnProcessToolCounts
  /** Whether a member call has not settled; the row's only default-open case. */
  readonly running: boolean
}
