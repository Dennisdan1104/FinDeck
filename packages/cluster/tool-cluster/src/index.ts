/**
 * Model-facing `cluster_run`: one task answered in parallel by several
 * perspective-assigned subagents, then combined by a separate aggregator
 * subagent. Members are independent — none sees the task's other answers — and
 * a member that fails becomes a labeled failure in the aggregator's input
 * rather than failing the call; the call fails only when every member fails.
 * Every child runs on the one `ctx.subagents` provider this plugin is
 * configured with, on the calling tool execution's cancellation signal, and
 * every run is disposed after its result settles. Named exports preserve loader
 * injection metadata.
 * @module @deepseek-ai/dsh-tool-cluster
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ClusterMemberOutcome, ClusterStrategy } from './types.ts'

// Projecting the types outlet onto the package root keeps the emitted
// `index.d.ts` edge that aggregate programs consume.
export type * from './types.ts'

export const name = 'tool-cluster'
export const inject = ['tools', 'subagents']

/** Cluster size bounds for a call's `perspectives` and the deployment default. */
const MIN_PERSPECTIVES = 2
const MAX_PERSPECTIVES = 8

/**
 * Perspectives a call gets when neither it nor the deployment names any: three
 * viewpoints that disagree by construction rather than three copies of one.
 */
const BUILT_IN_PERSPECTIVES: readonly string[] = [
  'analyst: decompose the task and reason from the evidence',
  'critic: attack the obvious answer and name what is weak, missing, or risky',
  'pragmatist: judge what is feasible, what it costs, and what to do first',
]

/** Cluster tool configuration: the provider to delegate on and the call defaults. */
export interface Config {
  /** The `ctx.subagents` provider name every member and the aggregator run on. */
  provider: string
  /**
   * Perspectives used when a call omits `perspectives`: 2-8 non-empty one-line
   * entries, each naming one member's viewpoint. Defaults to the built-in
   * analyst / critic / pragmatist set.
   */
  defaultPerspectives?: string[]
  /**
   * Combination strategy used when a call omits `strategy` (default
   * `synthesize`).
   */
  defaultStrategy?: ClusterStrategy
}

/** Schemastery configuration for the cluster tool consumer. */
export const Config: z<Config> = z.object({
  provider: z.string().required(),
  // Preserve omission: Schemastery's `[]` default for an omitted array would
  // otherwise read as "the deployment named no perspectives".
  defaultPerspectives: z.array(z.string()).default(undefined as unknown as string[]),
  defaultStrategy: z.union(['synthesize', 'vote'] as const).default('synthesize'),
})

/**
 * Validate one perspective list and return its trimmed entries.
 * @param source - the call argument or the deployment default.
 * @param origin - where the list came from, for the failure message.
 * @returns the trimmed perspectives, in the given order.
 * @throws when the list holds fewer than {@link MIN_PERSPECTIVES} or more than
 *   {@link MAX_PERSPECTIVES} entries, or when an entry is blank.
 */
function assertPerspectives(source: readonly string[], origin: string): string[] {
  if (source.length < MIN_PERSPECTIVES || source.length > MAX_PERSPECTIVES) {
    throw new Error(
      `${origin} must name ${MIN_PERSPECTIVES}-${MAX_PERSPECTIVES} perspectives (got ${source.length})`,
    )
  }
  return source.map((perspective, index) => {
    const trimmed = perspective.trim()
    if (trimmed.length === 0) throw new Error(`${origin}: perspective ${index + 1} is empty`)
    return trimmed
  })
}

/** Join the text blocks of a child's output; other block kinds carry no answer text. */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Describe a non-`completed` stop reason, keeping the provider diagnostic and
 * whatever partial answer the child left behind.
 * @param result - the child's terminal result.
 * @returns the failure text, or `undefined` when the child completed.
 */
function failureText(result: SubagentResult): string | undefined {
  let headline: string
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      headline = 'the run was cancelled'
      break
    case 'error':
      headline = 'the run failed'
      break
    case 'max-tokens':
      headline = 'the run hit its token limit before finishing'
      break
    case 'refusal':
      headline = 'the child declined the task'
      break
    // Merge-extensible stop-reason map: a backend may add terminal reasons.
    // An unknown reason is a failure, never a finished answer.
    default:
      headline = `the run ended abnormally (${String(result.stopReason)})`
  }
  const diagnostic = result.diagnostic === undefined ? '' : ` (${result.diagnostic})`
  const partial = textOf(result.output).trim()
  return `${headline}${diagnostic}${partial.length === 0 ? '' : `; partial output: ${partial}`}`
}

/**
 * Collect one started run's terminal result and release it.
 * @param run - the published run.
 * @returns `settled` with the child's result, or `failed` with the failure that
 *   replaced it. A disposal failure never overwrites a collected result.
 */
async function collectRun(run: SubagentRun): Promise<
  | { readonly kind: 'settled'; readonly result: SubagentResult }
  | { readonly kind: 'failed'; readonly detail: string }
> {
  const [settled] = await Promise.allSettled([run.result])
  // Dispose is idempotent and independent of result settlement.
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (settled.status === 'rejected') {
    return { kind: 'failed', detail: `the run failed: ${String(settled.reason)}` }
  }
  if (disposal.status === 'rejected') {
    return { kind: 'failed', detail: `the run finished but its cleanup failed: ${String(disposal.reason)}` }
  }
  return { kind: 'settled', result: settled.value }
}

/**
 * The message one member receives: the shared task plus its own viewpoint.
 * @param task - the shared task statement.
 * @param perspective - the member's assigned viewpoint.
 * @returns the member's prompt text.
 */
function memberPrompt(task: string, perspective: string): string {
  return [
    'You are one independent member of a cluster answering a single task. Other members answer it in '
    + 'parallel from different perspectives; you cannot see them, their answers, or the caller.',
    `Your assigned perspective: ${perspective}`,
    '',
    'Task:',
    task,
    '',
    'Answer from your assigned perspective alone, in plain text: your conclusion first, then the '
    + 'evidence or reasoning that supports it. Do not ask questions — nothing will reply, and do not '
    + 'wait for the other members.',
  ].join('\n')
}

/** Strategy clause the aggregator receives for `synthesize`. */
const SYNTHESIZE_INSTRUCTION =
  'Merge the member answers into one consolidated answer for the caller: keep every conclusion the '
  + 'evidence supports, resolve disagreements on the strength of their arguments rather than by '
  + 'counting members, and state plainly where the members still disagree. Return plain text.'

/** Strategy clause the aggregator receives for `vote`. */
const VOTE_INSTRUCTION =
  'Each member reached its own conclusion. Return the majority conclusion, the vote distribution '
  + '(how many members backed each conclusion), and every dissenting conclusion with its reason. '
  + 'Return plain text.'

/**
 * The message the aggregator receives: the task, the strategy, and every member
 * result in member order, with failures marked as failures.
 * @param task - the shared task statement.
 * @param strategy - how the answers must be combined.
 * @param outcomes - the settled member contributions.
 * @returns the aggregator's prompt text.
 */
function aggregatorPrompt(
  task: string,
  strategy: ClusterStrategy,
  outcomes: readonly ClusterMemberOutcome[],
): string {
  const answers = outcomes
    .map(outcome => outcome.ok
      ? `[${outcome.perspective}]\n${outcome.output}`
      : `[${outcome.perspective}] FAILED — ${outcome.diagnostic}`)
    .join('\n\n')
  return [
    `You are the aggregator for a cluster of ${outcomes.length} members that each answered one task `
    + 'from a distinct perspective.',
    '',
    'Task:',
    task,
    '',
    strategy === 'vote' ? VOTE_INSTRUCTION : SYNTHESIZE_INSTRUCTION,
    'Some members may have failed; weigh only the answers present and never invent a missing '
    + 'member\'s view.',
    '',
    'Member answers:',
    answers,
  ].join('\n')
}

/**
 * Run one cluster member to settlement and dispose its run. A member failure
 * never rejects: it is reported as a labeled failure so the other members'
 * answers survive.
 * @param runtime - the subagent registry to start on.
 * @param provider - the configured provider name.
 * @param parent - the calling agent that owns the delegation.
 * @param signal - the calling tool execution's cancellation signal.
 * @param task - the shared task statement.
 * @param perspective - the trimmed viewpoint this member is assigned.
 * @returns the member's answer, or the failure that stands in for it.
 */
async function runMember(
  runtime: SubagentRuntime,
  provider: string,
  parent: Agent,
  signal: AbortSignal,
  task: string,
  perspective: string,
): Promise<ClusterMemberOutcome> {
  let run: SubagentRun
  try {
    run = await runtime.start(provider, {
      label: `cluster member: ${perspective}`,
      prompt: [{ type: 'text', text: memberPrompt(task, perspective) }],
      parent,
      signal,
    })
  } catch (error: unknown) {
    // A rejected start published no run, so there is nothing to dispose and the
    // failure belongs to this member alone; its siblings keep running.
    return { perspective, ok: false, diagnostic: `the member run did not start: ${String(error)}` }
  }
  const collected = await collectRun(run)
  if (collected.kind === 'failed') {
    return { perspective, ok: false, diagnostic: collected.detail }
  }
  const failure = failureText(collected.result)
  if (failure !== undefined) return { perspective, ok: false, diagnostic: failure }
  const output = textOf(collected.result.output).trim()
  if (output.length === 0) return { perspective, ok: false, diagnostic: 'the member returned no text' }
  return { perspective, ok: true, output }
}

/**
 * Run the aggregator child and return its answer text. Unlike a member, an
 * aggregator failure is the whole call's failure: nothing else can combine the
 * collected answers.
 * @param runtime - the subagent registry to start on.
 * @param provider - the configured provider name.
 * @param parent - the calling agent that owns the delegation.
 * @param signal - the calling tool execution's cancellation signal.
 * @param prompt - the composed aggregation prompt.
 * @throws when the aggregator cannot start, fails, or returns no text.
 * @returns the aggregated result text.
 */
async function runAggregator(
  runtime: SubagentRuntime,
  provider: string,
  parent: Agent,
  signal: AbortSignal,
  prompt: string,
): Promise<string> {
  const run = await runtime.start(provider, {
    label: 'cluster aggregator',
    prompt: [{ type: 'text', text: prompt }],
    parent,
    signal,
  })
  const collected = await collectRun(run)
  if (collected.kind === 'failed') {
    throw new Error(`the cluster aggregator produced no result — ${collected.detail}`)
  }
  const failure = failureText(collected.result)
  if (failure !== undefined) throw new Error(`the cluster aggregator produced no result: ${failure}`)
  const result = textOf(collected.result.output).trim()
  if (result.length === 0) throw new Error('the cluster aggregator returned no text')
  return result
}

/**
 * Register `cluster_run` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool and subagent registries.
 * @param config - deployment's provider and call defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const provider = config.provider
  // Direct apply() bypasses Schemastery's schema defaults; an omitted field is
  // resolved to its documented default here as well as through the Loader.
  const defaultPerspectives = config.defaultPerspectives === undefined
    ? [...BUILT_IN_PERSPECTIVES]
    : assertPerspectives(config.defaultPerspectives, 'tool-cluster: `defaultPerspectives`')
  const defaultStrategy: ClusterStrategy = config.defaultStrategy ?? 'synthesize'

  if (ctx.subagents.getProvider(provider) === undefined) {
    // A provider fiber may activate after this one; a misspelled provider
    // remains visible in this log and fails loud at the first call.
    ctx.logger.info(
      `tool-cluster: subagent provider "${provider}" not registered yet; cluster_run will fail until it appears`,
    )
  }

  const description =
    'Run one task through a cluster of subagents: several members, each assigned a different '
    + 'perspective, answer it in parallel without seeing each other, and one aggregator subagent '
    + 'combines their answers into a single result. Use it when a task needs several independent '
    + 'angles at once — a design decision, a review, an open question — and a single delegation '
    + 'would return one unopposed view. Every member receives the full task and only its own '
    + 'perspective. A member that fails is reported to the aggregator as failed and does not fail '
    + 'the call; the call fails only when every member fails. `strategy: synthesize` (the default) '
    + 'returns one consolidated answer, and `strategy: vote` returns the majority conclusion with '
    + 'the vote distribution. The whole cluster settles before this call returns, so it takes about '
    + 'as long as the slowest member plus the aggregation. Omit `perspectives` to use the default '
    + `set: ${defaultPerspectives.join('; ')}.`

  ctx.tools.register(defineTool({
    name: 'cluster_run',
    description,
    parameters: {
      task: {
        type: 'string',
        required: true,
        description:
          'The task every member answers. State it completely: members do not see this conversation '
          + 'and cannot ask follow-up questions.',
      },
      perspectives: {
        type: 'array',
        description:
          `One line per member naming the viewpoint that member must take (${MIN_PERSPECTIVES}-`
          + `${MAX_PERSPECTIVES} entries). Each member works from its own perspective alone and `
          + `cannot see the others. Omit to use the ${defaultPerspectives.length} default perspectives.`,
        items: { type: 'string' },
      },
      strategy: {
        type: 'string',
        enum: ['synthesize', 'vote'],
        description:
          'How the member answers are combined. `synthesize` merges them into one consolidated '
          + 'answer; `vote` returns the majority conclusion and the vote distribution. Defaults to '
          + '`synthesize` unless this deployment configured another default.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          strategy: { type: 'string', required: true, enum: ['synthesize', 'vote'] },
          result: { type: 'string', required: true },
          members: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                perspective: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['completed', 'failed'] },
                output: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const answered = value.members.filter(member => member.status === 'completed').length
        const members = value.members
          .map(member => `- [${member.status}] ${member.perspective}\n${member.output}`)
          .join('\n\n')
        return [{
          type: 'text',
          text: [
            `Cluster result (${value.strategy}, ${answered} of ${value.members.length} members answered):`,
            '',
            value.result,
            '',
            'Members:',
            '',
            members,
          ].join('\n'),
        }]
      },
    },
    // Members and the aggregator never mutate the parent session; the only
    // parent-owned writes are the provider's commutative catalog insertions.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // Non-agent callers provide no delegation owner.
        throw new Error('cluster_run requires a calling agent (exec.agent was undefined)')
      }
      const perspectives = args.perspectives === undefined
        ? defaultPerspectives
        : assertPerspectives(args.perspectives, 'cluster_run: `perspectives`')
      const strategy: ClusterStrategy = args.strategy ?? defaultStrategy

      const outcomes = await Promise.all(perspectives.map(perspective =>
        runMember(ctx.subagents, provider, parent, exec.signal, args.task, perspective)))
      // Cancellation owns the call: a cancelled cluster must not spend another
      // child on aggregation.
      exec.signal.throwIfAborted()

      const failed = outcomes.filter(outcome => !outcome.ok)
      if (failed.length === outcomes.length) {
        throw new Error(
          'every cluster member failed: '
          + failed.map(outcome => `${outcome.perspective}: ${outcome.diagnostic}`).join('; '),
        )
      }

      const result = await runAggregator(
        ctx.subagents,
        provider,
        parent,
        exec.signal,
        aggregatorPrompt(args.task, strategy, outcomes),
      )

      return {
        strategy,
        result,
        members: outcomes.map(outcome => outcome.ok
          ? { perspective: outcome.perspective, status: 'completed' as const, output: outcome.output }
          : { perspective: outcome.perspective, status: 'failed' as const, output: outcome.diagnostic }),
      }
    },
  }))
}
