/**
 * Validation of roundtable values that arrive as durable JSON: one archived
 * transcript entry, and one tool activity line inside it.
 *
 * Both the closed-table archive and the live-room file read these back, and
 * both fail loud on a malformed body — a corrupt table is reported rather than
 * served half-valid.
 *
 * @module @deepseek-ai/dsh-roundtable/parse
 */

import type {
  RoundtableEntry,
  RoundtableFlowItem,
  RoundtableToolActivity,
  RoundtableToolStatus,
} from './identities.ts'

const TOOL_STATUSES: readonly RoundtableToolStatus[] = ['running', 'ok', 'error', 'interrupted']

/**
 * Validate one tool activity line.
 * @param value - the parsed JSON value.
 * @returns the line unchanged.
 * @throws when the value is not an object carrying a name and a known status.
 */
export function parseToolActivity(value: unknown): RoundtableToolActivity {
  if (typeof value !== 'object' || value === null) throw new Error('a tool activity line must be an object')
  const { key, name, arguments: args, summary, status } = value as Record<string, unknown>
  if (typeof name !== 'string' || name === '') throw new Error('a tool activity line must carry a non-empty name')
  if (typeof status !== 'string' || !TOOL_STATUSES.some(known => known === status)) {
    throw new Error('a tool activity line must carry a known status')
  }
  const resolved: RoundtableToolStatus = TOOL_STATUSES.find(entry => entry === status) ?? 'ok'
  return {
    key: typeof key === 'string' ? key : '',
    name,
    arguments: typeof args === 'string' ? args : '',
    summary: typeof summary === 'string' ? summary : '',
    status: resolved,
  }
}

/**
 * Validate one item of a turn's activity timeline.
 * @param value - the parsed JSON value.
 * @returns the item unchanged.
 * @throws when the item carries an unknown kind, a non-string reasoning text,
 *   or a malformed tool activity line.
 */
export function parseFlowItem(value: unknown): RoundtableFlowItem {
  if (typeof value !== 'object' || value === null) throw new Error('a flow item must be an object')
  const { kind } = value as Record<string, unknown>
  if (kind === 'reasoning') {
    const text = (value as { text?: unknown }).text
    if (typeof text !== 'string') throw new Error('a reasoning flow item must carry text')
    return { kind: 'reasoning', text }
  }
  if (kind === 'tool') {
    return { kind: 'tool', tool: parseToolActivity((value as { tool?: unknown }).tool) }
  }
  throw new Error('a flow item must carry a known kind')
}

/**
 * Validate one transcript entry.
 * @param value - the parsed JSON value.
 * @returns the entry unchanged.
 * @throws when the kind is unknown, the display fields are not strings, or a
 *   tool activity line or flow item inside it is malformed.
 */
export function parseTranscriptEntry(value: unknown): RoundtableEntry {
  if (typeof value !== 'object' || value === null) throw new Error('a transcript entry must be an object')
  const { kind, name, text, at } = value as Record<string, unknown>
  if (kind !== 'user' && kind !== 'speaker' && kind !== 'system') {
    throw new Error('a transcript entry must carry a known kind')
  }
  if (typeof name !== 'string' || typeof text !== 'string' || typeof at !== 'string') {
    throw new Error('a transcript entry must carry name/text/at strings')
  }
  const tools = (value as { tools?: unknown }).tools
  const flow = (value as { flow?: unknown }).flow
  if (tools === undefined && flow === undefined) return value as RoundtableEntry
  if (tools !== undefined && !Array.isArray(tools)) throw new Error('a transcript entry\'s tools must be an array')
  if (flow !== undefined && !Array.isArray(flow)) throw new Error('a transcript entry\'s flow must be an array')
  return {
    ...value as RoundtableEntry,
    ...tools === undefined ? {} : { tools: tools.map(parseToolActivity) },
    ...flow === undefined ? {} : { flow: flow.map(parseFlowItem) },
  }
}
