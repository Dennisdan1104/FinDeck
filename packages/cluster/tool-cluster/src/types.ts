/**
 * Public type face of the cluster consumer: the combination strategy and one
 * member's settled contribution. Types only — the plugin entry is
 * `@deepseek-ai/dsh-tool-cluster`.
 * @module @deepseek-ai/dsh-tool-cluster/types
 */

/**
 * How the aggregator combines the member answers.
 *
 * `synthesize` merges them into one consolidated answer; `vote` reports the
 * majority conclusion with the vote distribution.
 */
export type ClusterStrategy = 'synthesize' | 'vote'

/**
 * One cluster member's settled contribution, either its answer text or the
 * failure that stands in for it.
 */
export type ClusterMemberOutcome =
  | {
    /** The viewpoint this member was assigned. */
    readonly perspective: string
    /** The member answered. */
    readonly ok: true
    /** The member's answer text. */
    readonly output: string
  }
  | {
    /** The viewpoint this member was assigned. */
    readonly perspective: string
    /** The member did not answer. */
    readonly ok: false
    /** Why the member produced no usable answer. */
    readonly diagnostic: string
  }
