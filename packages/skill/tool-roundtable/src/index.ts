/**
 * Model-facing tools over the durable roundtable transcript archive the
 * `dsh-roundtable` engine writes when a table closes: `roundtable_list`
 * serves the recent tables' headers (when, which roster, how deep, which
 * model, how many turns, the opening topic), and `roundtable_read` serves one
 * table's complete transcript — every user message, speaker turn, citation,
 * and system note. The agent uses them to recall what a roundtable concluded
 * and to cite it in reports; the engine and these tools share only the
 * directory contract (`dsh-roundtable/archive`).
 *
 * @module @deepseek-ai/dsh-tool-roundtable
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { listRoundtableArchives, readRoundtableArchive, roundtableArchiveDir } from '@deepseek-ai/dsh-roundtable/archive'
import type { RoundtableArchiveRecord } from '@deepseek-ai/dsh-roundtable/archive'

export const name = 'tool-roundtable'
export const inject = ['tools']

/** Listing cap when the caller asks for nothing. */
const DEFAULT_LIMIT = 10
/** Hard ceiling for one listing call. */
const MAX_LIMIT = 50

/** Model-facing roundtable-archive tool configuration. */
export interface Config {
  /**
   * Archive root; defaults to `<harness home>/roundtables`, the same default
   * the roundtable engine writes to.
   */
  readonly archiveDir?: string
}

/** Validate and default the roundtable-archive tool configuration. */
export const Config: z<Config> = z.object({
  archiveDir: z.string(),
})

/** One transcript entry's model-facing row: who, when, what, and what it cited. */
function entryWire(entry: RoundtableArchiveRecord['transcript'][number]): {
  kind: string
  name: string
  at: string
  text: string
  reasoning?: string
  citations?: string[]
  tools?: string[]
  truncated?: boolean
  interrupted?: boolean
} {
  if (entry.kind !== 'speaker') return { kind: entry.kind, name: entry.name, at: entry.at, text: entry.text }
  return {
    kind: entry.kind,
    name: entry.name,
    at: entry.at,
    text: entry.text,
    ...entry.reasoning === undefined || entry.reasoning === '' ? {} : { reasoning: entry.reasoning },
    ...entry.citations !== undefined && entry.citations.length > 0
      ? { citations: entry.citations.map(citation => `${citation.tool}: ${citation.label}`) }
      : {},
    ...entry.tools === undefined || entry.tools.length === 0
      ? {}
      : { tools: entry.tools.map(tool => `${tool.name}${tool.summary === '' ? '' : ` ${tool.summary}`} (${tool.status})`) },
    ...entry.truncated === true ? { truncated: true } : {},
    ...entry.interrupted === true ? { interrupted: true } : {},
  }
}

/**
 * Register the two archive tools.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment's archive-root choice.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const archiveDir = resolve(config.archiveDir ?? roundtableArchiveDir())

  ctx.tools.register(defineTool({
    name: 'roundtable_list',
    description:
      'List recent closed roundtable tables: when each ran, which roster and model it seated, how deep it '
      + 'went, how many speaker turns it recorded, and the topic that opened it. Use it to recall which '
      + 'roundtables this user has run, then `roundtable_read` the relevant one for the full transcript.',
    parameters: {
      limit: { type: 'number', description: `Maximum tables to return (1-${String(MAX_LIMIT)}); defaults to ${String(DEFAULT_LIMIT)}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          tables: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                opened_at: { type: 'string' },
                closed_at: { type: 'string', required: true },
                depth: { type: 'string', required: true },
                roster_id: { type: 'string', required: true },
                roster_name: { type: 'string', required: true },
                model: { type: 'string', required: true },
                turns: { type: 'integer', required: true },
                topic: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tables.length === 0
          ? `No archived roundtables in ${value.dir} yet — a table archives when it is closed after speaking.`
          : value.tables.map(table =>
            `- ${table.id} [${table.depth}, ${table.turns} turns] ${table.roster_name} (${table.model}) closed ${table.closed_at}${table.topic === '' ? '' : ` — ${table.topic}`}`,
          ).join('\n'),
      }],
    },
    async execute(args) {
      const limit = args.limit === undefined ? DEFAULT_LIMIT : Math.min(Math.max(Math.trunc(args.limit), 1), MAX_LIMIT)
      const tables = await listRoundtableArchives(archiveDir, limit)
      return {
        dir: archiveDir,
        tables: tables.map(table => ({
          id: table.id,
          ...table.openedAt === null ? {} : { opened_at: table.openedAt },
          closed_at: table.closedAt,
          depth: table.depth,
          roster_id: table.rosterId,
          roster_name: table.rosterName,
          model: table.model,
          turns: table.turns,
          topic: table.topic,
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List roundtable archives', kind: 'read', rawInput: args.limit ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'roundtable_read',
    description:
      'Read one archived roundtable table in full: the table configuration (roster, depth, model) and the '
      + 'complete transcript — every user message, every speaker turn with its text, its thinking, and its '
      + 'citations, and the system notes (skips, failures, seatings). Use it to recall exactly what a '
      + 'roundtable concluded and cite it in a report.',
    parameters: {
      id: { type: 'string', required: true, description: 'Archive id from `roundtable_list`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', required: true },
          table: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              opened_at: { type: 'string' },
              closed_at: { type: 'string', required: true },
              depth: { type: 'string', required: true },
              roster_id: { type: 'string', required: true },
              roster_name: { type: 'string', required: true },
              provider: { type: 'string', required: true },
              model: { type: 'string', required: true },
            },
          },
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true },
                name: { type: 'string', required: true },
                at: { type: 'string', required: true },
                text: { type: 'string', required: true },
                reasoning: { type: 'string' },
                citations: { type: 'array', items: { type: 'string' } },
                tools: { type: 'array', items: { type: 'string' } },
                truncated: { type: 'boolean' },
                interrupted: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Roundtable ${value.table.roster_name} (${value.table.depth}, ${value.table.model}), closed ${value.table.closed_at}:`,
          ...value.entries.map(entry => {
            const citations = entry.citations === undefined || entry.citations.length === 0
              ? ''
              : ` [cited: ${entry.citations.join('; ')}]`
            const truncated = entry.truncated === true ? ' [research truncated]' : ''
            const interrupted = entry.interrupted === true ? ' [interrupted mid-turn]' : ''
            const tools = entry.tools === undefined || entry.tools.length === 0
              ? ''
              : ` [tools: ${entry.tools.join('; ')}]`
            const reasoning = entry.reasoning === undefined ? '' : `\n[thought] ${entry.reasoning}`
            return `[${entry.kind}] ${entry.name}: ${entry.text}${citations}${tools}${truncated}${interrupted}${reasoning}`
          }),
        ].join('\n'),
      }],
    },
    async execute(args) {
      const record = await readRoundtableArchive(archiveDir, args.id)
      return {
        dir: archiveDir,
        table: {
          ...record.openedAt === null ? {} : { opened_at: record.openedAt },
          closed_at: record.closedAt,
          depth: record.table.depth,
          roster_id: record.table.rosterId,
          roster_name: record.table.rosterName,
          provider: record.table.provider,
          model: record.table.model,
        },
        entries: record.transcript.map(entryWire),
      }
    },
    presentCall: args => ({ card: 'generic', title: `Read roundtable ${args.id}`, kind: 'read', rawInput: args.id }),
  }))
}
