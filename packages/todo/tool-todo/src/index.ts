/**
 * Model-facing whole-list replacement plus a read-back of the standing plan.
 * Each write appends a `todo/write` snapshot to the calling agent's session;
 * replay is last-write-wins, that list persists across turns until the next
 * write replaces it, and UIs render from session events. `todo_read` serves the
 * same `todos` projection the UI renders, so the model can recover the exact
 * plan after context compaction without rewriting it from memory. A non-agent
 * caller has no owning list and is rejected. Named exports preserve loader
 * injection metadata.
 * @module @deepseek-ai/dsh-tool-todo
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TodoItem } from './types.ts'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@deepseek-ai/dsh-session-projection'
// The `todos` projection-key declaration lives in src/types.ts (its one home);
// this re-export projects the type face onto the package root AND keeps the
// module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the SessionProjectionMap merge.
export type * from './types.ts'

export const name = 'tool-todo'
export const inject = ['tools', 'sessionProjections']

/** The valid {@link TodoItem} statuses, as a runtime set for input narrowing. */
const STATUSES = ['pending', 'in_progress', 'completed'] as const

/** Model-facing todo tool configuration. */
export interface Config {
  /**
   * Required deployment choice for whether several todos may be `in_progress` at once. True suits
   * agents that run work concurrently — subagents, background commands, workflow fan-out — and the
   * description then instructs the model to mark every actively worked task. False restores the
   * single-active discipline: the description asks for exactly one, and a call marking more is
   * rejected.
   */
  allowParallelInProgress: boolean
}

/** Schemastery configuration for the todo tool consumer. */
export const Config: z<Config> = z.object({
  allowParallelInProgress: z.boolean().required(),
})

const DESCRIPTION_HEAD =
  'Record and update a structured task list for the current work. Send the ENTIRE '
  + 'list every call — it REPLACES the previous list (there are no partial updates, '
  + 'no per-item edits). Use it to plan multi-step work and show progress: add one '
  + 'todo per concrete step before you start. '

// The progress view persists across turns (see the todo-progress lifetime Agent
// Note), so the discipline has to say what changes it: the model's own writes
// are the only thing that moves the list, and an explicitly empty list is the
// only thing that clears it. Stating the lifetime also makes the list the
// model's own running statement of where the work stands, which is what lets it
// move a task back to `pending` when a later step discovers the plan changed.
const DESCRIPTION_LIFETIME =
  'The user follows this list as your progress, and it persists across turns until '
  + 'you change it: update it the moment a step lands, rewrite the WHOLE list whenever '
  + 'the plan changes — including moving a task back to `pending` — and send an empty '
  + 'list once the whole plan is abandoned, which is the only way to clear it. After a '
  + 'context compaction use `todo_read` to recover the exact standing list rather than '
  + 'rebuilding it from memory. '

const DESCRIPTION_PARALLEL =
  'Mark every todo being actively worked '
  + 'on `in_progress` — several at once when work genuinely runs in parallel (e.g. '
  + 'concurrent subagents or background commands), one for sequential work; while '
  + 'work remains, at least one task should be `in_progress`. '

const DESCRIPTION_SINGLE =
  'Keep AT MOST ONE todo `in_progress` at a '
  + 'time; while work remains, exactly one active task should be `in_progress`. '

const DESCRIPTION_TAIL =
  'Mark a todo '
  + '`completed` the moment it is done (do not batch completions), and allow no '
  + '`in_progress` item only once all work is complete. Skip the list for trivial '
  + 'single-step tasks. Statuses: `pending` (not started), `in_progress` (being '
  + 'worked on now), `completed` (finished).'

/**
 * The model-facing description for one activation. The active-status clause is the only part that
 * varies, because it is the only instruction the parallel policy changes.
 * @param allowParallel - whether several todos may be `in_progress` at once.
 * @returns the composed tool description.
 */
function describe(allowParallel: boolean): string {
  return DESCRIPTION_HEAD
    + DESCRIPTION_LIFETIME
    + (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE)
    + DESCRIPTION_TAIL
}

/**
 * Validate the value constraints the ParameterSchemaSpec can't express and build the canonical {@link
 * TodoItem}[]: trimmed non-empty unique content, and at most one `in_progress` item unless the
 * deployment allows parallel work. The registry has already enforced the status enum and rejected
 * unknown item keys (`additionalProperties: false` — the logged snapshot must equal what the model
 * believes it wrote, so a nested/extended item shape fails loud at the schema boundary instead of
 * silently flattening); the cast below records that guarantee.
 * @param raw - the model-supplied list, already schema-checked.
 * @param allowParallel - whether several items may be `in_progress` at once.
 * @returns the canonical list.
 */
function toTodoList(raw: { content: string; status: string }[], allowParallel: boolean): TodoItem[] {
  const todos: TodoItem[] = []
  const seen = new Set<string>()
  let active = 0
  for (const item of raw) {
    const content = item.content.trim()
    if (content.length === 0) {
      throw new Error('invalid todo: `content` must be a non-empty string')
    }
    if (seen.has(content)) {
      throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`)
    }
    seen.add(content)
    if (item.status === 'in_progress') active++
    todos.push({ content, status: item.status as TodoItem['status'] })
  }
  if (!allowParallel && active > 1) {
    throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`)
  }
  return todos
}

/** Wire payload schema of the `todos` projection (whole list or pre-first-write null). */
const todosProjectionSchema: ZodType<TodoItem[] | null> = zod.union([
  zod.array(zod.object({
    content: zod.string(),
    status: zod.union([zod.literal('pending'), zod.literal('in_progress'), zod.literal('completed')]),
  })),
  zod.null(),
])

/**
 * Register the `todo_write` and `todo_read` tools on `ctx.tools` and the
 * `todos` unit on `ctx.sessionProjections`.
 * @param ctx - registrant context carrying the tool and session-projection registries.
 * @param config - deployment's explicit todo policy.
 */
export function apply(ctx: Context, config: Config): void {
  const allowParallel = config.allowParallelInProgress
  // Standing-plan fold: the latest whole todo/write list, replaced only by a
  // later write and kept unchanged across turn boundaries (an empty list is the
  // explicit clear); null before the first write; every other event returns the
  // same state reference. stateVersion 3 invalidates persisted projection-cache
  // rows folded under the former turn-boundary clear.
  ctx.sessionProjections.register<'todos', TodoItem[] | null>({
    key: 'todos',
    stateSchema: todosProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'todo/write') return event.data.todos
      return state
    },
    wire: { viewSchema: todosProjectionSchema, view: state => state },
    stateVersion: 3,
  })
  ctx.tools.register(defineTool({
    name: 'todo_write',
    description: describe(allowParallel),
    parameters: {
      todos: {
        type: 'array',
        required: true,
        description: 'The COMPLETE task list, replacing any previous list.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true, description: 'What the task is — a short imperative line.' },
            status: {
              type: 'string',
              required: true,
              enum: [...STATUSES],
              description: 'pending (not started) | in_progress (now) | completed (done).',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          todos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: [...STATUSES] },
              },
            },
          },
          counts: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              pending: { type: 'integer', required: true },
              inProgress: { type: 'integer', required: true },
              completed: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`,
      }],
    },
    execute(args, exec) {
      const todos = toTodoList(args.todos, allowParallel)
      if (!exec.agent) {
        // The list is per-agent-session state; a non-agent caller (no owning
        // session) has nowhere to write it. Reject rather than silently no-op.
        throw new Error('todo_write requires an owning agent session')
      }
      exec.agent.session.append('todo/write', { todos })
      const count = (status: TodoItem['status']): number => todos.filter(t => t.status === status).length
      return Promise.resolve({
        todos: todos.map(todo => ({ content: todo.content, status: todo.status })),
        counts: {
          pending: count('pending'),
          inProgress: count('in_progress'),
          completed: count('completed'),
        },
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Update todo list', kind: 'other', rawInput: args.todos }),
  }))

  ctx.tools.register(defineTool({
    name: 'todo_read',
    description:
      'Read the current todo list back without changing it. Use it when earlier writes have fallen out of '
      + 'view (context compaction, a long turn) and you need the exact standing plan instead of a '
      + 'reconstruction from memory. It returns the same list the user sees; a session that has not written '
      + 'a list yet reads as none, so re-plan with todo_write rather than polling.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          present: { type: 'boolean', required: true },
          todos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: [...STATUSES] },
              },
            },
          },
          counts: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              pending: { type: 'integer', required: true },
              inProgress: { type: 'integer', required: true },
              completed: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.present
          ? [
            `Current todo list: ${value.counts.pending} pending, ${value.counts.inProgress} in progress, ${value.counts.completed} completed.`,
            ...value.todos.map(todo => `- [${todo.status}] ${todo.content}`),
          ].join('\n')
          : 'No todo list has been written for this session yet.',
      }],
    },
    isConcurrencySafe: () => true,
    execute(_args, exec) {
      if (!exec.agent) {
        // The projection is per-agent-session state; a non-agent caller has no
        // list to read. Reject rather than serve a foreign or empty view.
        throw new Error('todo_read requires an owning agent session')
      }
      const todos = ctx.sessionProjections.stateOf(exec.agent.session, 'todos')
      if (todos === undefined) {
        // This plugin registered the unit above, so an absent registration
        // means the registry the tool was built against is not the live one.
        throw new Error('todo_read: the todos projection unit is not registered')
      }
      const count = (status: TodoItem['status']): number => todos === null ? 0 : todos.filter(t => t.status === status).length
      return Promise.resolve({
        present: todos !== null,
        todos: todos === null ? [] : todos.map(todo => ({ content: todo.content, status: todo.status })),
        counts: {
          pending: count('pending'),
          inProgress: count('in_progress'),
          completed: count('completed'),
        },
      })
    },
    presentCall: () => ({ card: 'generic', title: 'Read todo list', kind: 'read', rawInput: '' }),
  }))
}
