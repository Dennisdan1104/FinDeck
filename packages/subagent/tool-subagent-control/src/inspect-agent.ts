/**
 * The globally named `agent_inspect` tool: one subagent's working state, folded
 * from its own durable session log. It answers the question `list_agents`
 * cannot — what is that child actually doing right now: its standing todo
 * list, turn and step counts, token usage, the tail of its latest assistant
 * text, and the tools it has been calling. Delegation stays blind to
 * intermediate steps by design; this tool is the read-only window into them,
 * so a parent can judge progress (or a finished one-shot's result) without
 * steering the child.
 *
 * Authorization follows listing: the target must appear in the caller's
 * descendant tree (`ctx.subagents.listDescendants`), and the log read goes
 * through the live-preferred `ctx.sessionQuery` service.
 * @module @deepseek-ai/dsh-tool-subagent-control/inspect-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
// Type-only: load the `todo/write` event and `ctx.sessionQuery` service merges.
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-session-query'

export const name = 'tool-subagent-inspect-agent'
export const inject = ['tools', 'subagents', 'agents', 'sessionQuery']

/** Characters of the latest assistant text served (roughly 1000 tokens). */
const LAST_TEXT_MAX_CHARS = 4000

/** How many most-recent tool-call names are served, in call order. */
const RECENT_TOOLS_LIMIT = 8

/** One folded todo item, exactly the shape `todo_write` snapshots. */
interface FoldedTodo {
  readonly content: string
  readonly status: string
}

/** What the child's session log folds into, for the model. */
interface FoldedSession {
  readonly turns: number
  readonly steps: number
  readonly todo: { readonly present: boolean; readonly items: readonly FoldedTodo[] }
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly modelCalls: number }
  readonly lastAssistantText: string
  readonly recentTools: readonly string[]
}

/** Fold one raw session log into the inspection view. */
function foldSession(events: readonly SessionEvent[]): FoldedSession {
  let turns = 0
  let steps = 0
  let todos: readonly FoldedTodo[] | null = null
  let inputTokens = 0
  let outputTokens = 0
  let modelCalls = 0
  let lastAssistantText = ''
  const toolNames: string[] = []
  for (const event of events) {
    switch (event.type) {
      case 'turn/end':
        turns += 1
        break
      case 'step/end':
        steps += 1
        break
      case 'todo/write':
        // Same standing-plan lifetime the `todos` projection applies: the last
        // write wins and a later turn does not clear it.
        todos = event.data.todos.map(todo => ({ content: todo.content, status: todo.status }))
        break
      case 'assistant/message': {
        modelCalls += 1
        if (event.data.usage !== undefined) {
          inputTokens += event.data.usage.inputTokens
          outputTokens += event.data.usage.outputTokens
        }
        lastAssistantText = event.data.message.content
          .filter((block): block is { type: 'text'; text: string } =>
            typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
          .map(block => block.text)
          .join('')
        break
      }
      case 'tool/call':
        toolNames.push(event.data.name)
        break
      // Merge-extensible event map: unknown informational types fold as no-ops.
      default:
        break
    }
  }
  return {
    turns,
    steps,
    todo: { present: todos !== null, items: todos === null ? [] : [...todos] },
    usage: { inputTokens, outputTokens, modelCalls },
    lastAssistantText: lastAssistantText.length > LAST_TEXT_MAX_CHARS
      ? `${lastAssistantText.slice(lastAssistantText.length - LAST_TEXT_MAX_CHARS)}…[truncated head]`
      : lastAssistantText,
    recentTools: toolNames.slice(-RECENT_TOOLS_LIMIT),
  }
}

/** Live status through the Agent registry, with the same wording `list_agents` uses. */
function statusOf(agents: { get(id: SessionId): Agent | undefined }, id: SessionId): 'running' | 'idle' | 'ready' {
  const agent = agents.get(id)
  if (agent === undefined) return 'ready'
  return agent.status === 'running' ? 'running' : 'idle'
}

/**
 * Register the `agent_inspect` tool.
 * @param ctx - context carrying the tool registry, subagent service, live Agent
 *   registry, and the session-query service the log read goes through.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'agent_inspect',
    description:
      'Inspect one of your subagents\' working state, folded from its own session: its standing todo list '
      + '(done/in-progress/pending), turn and step counts, cumulative token usage, the tail of its latest '
      + 'assistant text, and its most recent tool calls. Use it to judge whether a delegated task is on '
      + 'track, stuck, or done — without steering it (`send_message` steers; this only reads). One-shot '
      + 'children can be inspected too: their latest assistant text is the result they settled with.',
    parameters: {
      agent_id: { type: 'string', required: true, description: 'Subagent session id from `list_agents` (children or descendants).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          label: { type: 'string' },
          mode: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['running', 'idle', 'ready'] },
          turns: { type: 'integer', required: true },
          steps: { type: 'integer', required: true },
          todo_present: { type: 'boolean', required: true },
          todo_items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true },
              },
            },
          },
          input_tokens: { type: 'integer', required: true },
          output_tokens: { type: 'integer', required: true },
          model_calls: { type: 'integer', required: true },
          last_assistant_text: { type: 'string', required: true },
          recent_tools: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.id} [${value.status}] ${value.label ?? ''} (${value.mode}; ${String(value.turns)} turns, ${String(value.steps)} steps, ${String(value.model_calls)} model calls, ${String(value.input_tokens)}+${String(value.output_tokens)} tokens)`,
          value.todo_present
            ? `todo: ${value.todo_items.map(item => `[${item.status}] ${item.content}`).join(' | ')}`
            : 'todo: (none written by this subagent)',
          ...(value.recent_tools.length > 0 ? [`recent tools: ${value.recent_tools.join(', ')}`] : []),
          value.last_assistant_text === '' ? '(no assistant output yet)' : `latest output (tail): ${value.last_assistant_text}`,
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        throw new Error('agent_inspect requires a calling agent (exec.agent was undefined)')
      }
      const targetId = args.agent_id as SessionId
      // Authorization = the caller's own descendant tree; the listing is the
      // same authority send_message/interrupt_agent route through.
      const descendants = await ctx.subagents.listDescendants(parent.id, exec.signal)
      const target = descendants.find(entry => entry.id === targetId)
      if (target === undefined) {
        throw new Error(`agent_inspect: "${args.agent_id}" is not one of your subagents — list them with list_agents`)
      }
      if (target.kind === 'diagnostic') {
        throw new Error(`agent_inspect: "${args.agent_id}" cannot be read right now (${target.reason})`)
      }
      const snapshot = await ctx.sessionQuery.readSession(target.id)
      const folded = foldSession(snapshot.events)
      return {
        id: target.id,
        ...target.label === undefined ? {} : { label: target.label },
        mode: target.mode,
        status: statusOf(ctx.agents, target.id),
        turns: folded.turns,
        steps: folded.steps,
        todo_present: folded.todo.present,
        todo_items: folded.todo.items.map(item => ({ content: item.content, status: item.status })),
        input_tokens: folded.usage.inputTokens,
        output_tokens: folded.usage.outputTokens,
        model_calls: folded.usage.modelCalls,
        last_assistant_text: folded.lastAssistantText,
        recent_tools: [...folded.recentTools],
      }
    },
    presentCall: args => ({ card: 'generic', title: `Inspect subagent ${args.agent_id}`, kind: 'read', rawInput: args.agent_id }),
  }))
}
