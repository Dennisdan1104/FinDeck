/**
 * Face spec v1 reading and projection. Pure data transforms: no React, no
 * Cordis, no locale — the renderer and the standalone verification script share
 * these functions.
 *
 * `finance/face-spec/face.schema.json` is the document's authority; this module
 * re-derives only what a renderer must trust at runtime, because a face file is
 * written by another process (the AI or a pipeline step) and reaches the browser
 * as JSON text rather than as a typed value.
 */

import type { AssetFaceResult, RunVerbResult } from '@deepseek-ai/dsh-api-remotes/client'

/** Any JSON value a verb result may carry (`undefined` means the field is absent). */
export type FaceValue = RunVerbResult['result']

/** Any JSON value a verb result carries other than `undefined`. */
export type Json = Exclude<FaceValue, undefined>

/** Verb parameters, exactly as the bridge protocol defines them. */
export type VerbParams = { readonly [key: string]: Json }

/** One JSON object read out of a face document or a verb result. */
export type FaceRecord = { readonly [key: string]: Json }

/** One parsed face.json document as the Remote delivers it. */
export type RawFace = NonNullable<AssetFaceResult['face']>

/** Fields every block carries. */
interface BlockBase {
  /** Small heading the renderer paints above the block. */
  readonly title?: string
}

/** One scalar metric. */
export interface MetricCardBlock extends BlockBase {
  readonly type: 'metric-card'
  readonly verb: string
  readonly params?: VerbParams
  /** Formatting hint: `percent`, a `0.00`-style digit pattern, or `date`. */
  readonly format?: string
  /** Dot path into the verb result; absent means the component's own rule. */
  readonly extract?: string
}

/** One time series drawn as a self-made SVG polyline. */
export interface LineChartBlock extends BlockBase {
  readonly type: 'line-chart'
  readonly verb: string
  readonly params?: VerbParams
  /** X column name; absent means the first row column. */
  readonly x?: string
  /** Y column name; absent means the first numeric column after X. */
  readonly y?: string
}

/** One table of rows. */
export interface DataTableBlock extends BlockBase {
  readonly type: 'data-table'
  readonly verb: string
  readonly params?: VerbParams
  /** Columns to show, in this order; absent means every column. */
  readonly columns?: readonly string[]
  /** Row cap; absent means {@link DEFAULT_MAX_ROWS}. */
  readonly max_rows?: number
}

/** One block of text output. */
export interface LogViewBlock extends BlockBase {
  readonly type: 'log-view'
  readonly verb: string
  readonly params?: VerbParams
}

/** One status label. */
export interface StatusBadgeBlock extends BlockBase {
  readonly type: 'status-badge'
  readonly verb: string
  readonly params?: VerbParams
  readonly extract?: string
}

/** One button that triggers a verb. */
export interface ActionButtonBlock extends BlockBase {
  readonly type: 'action-button'
  readonly verb: string
  readonly params?: VerbParams
  /** When true, the click asks for confirmation first. */
  readonly confirm?: boolean
}

/** One field of a {@link ParamFormBlock}. */
export interface FormField {
  readonly name: string
  readonly label: string
  readonly type: 'number' | 'string' | 'boolean' | 'select'
  readonly default?: FaceValue
  readonly options?: readonly string[]
}

/** One form that collects parameters and then triggers a verb. */
export interface ParamFormBlock extends BlockBase {
  readonly type: 'param-form'
  readonly verb: string
  readonly params?: VerbParams
  readonly fields: readonly FormField[]
}

/** One embedded document from the version directory. */
export interface EmbedBlock extends BlockBase {
  readonly type: 'embed'
  readonly path: string
}

/** The v1 block union, discriminated by `type`. */
export type FaceBlock =
  | MetricCardBlock
  | LineChartBlock
  | DataTableBlock
  | LogViewBlock
  | StatusBadgeBlock
  | ActionButtonBlock
  | ParamFormBlock
  | EmbedBlock

/** The blocks that fetch data on mount; trigger blocks run only on a gesture. */
export type FaceDataBlock = MetricCardBlock | LineChartBlock | DataTableBlock | LogViewBlock | StatusBadgeBlock

/** One parsed, renderable face. */
export interface FaceSpec {
  readonly version: 1
  /** Face title; empty when the document states none. */
  readonly title: string
  readonly blocks: readonly FaceBlock[]
}

/** Row cap a `data-table` without `max_rows` renders. */
export const DEFAULT_MAX_ROWS = 50

/** Whether a block fetches its data on mount. */
export function isDataBlock(block: FaceBlock): block is FaceDataBlock {
  return block.type !== 'action-button' && block.type !== 'param-form' && block.type !== 'embed'
}

/** Read one JSON value as a plain object, or undefined for anything else. */
function asRecord(value: FaceValue): FaceRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/** Read one value as a non-empty string, or undefined. */
function asText(value: FaceValue | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Read one value as a positive integer, or undefined. */
function asCount(value: FaceValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Read one value as a string list, or undefined when it states none. */
function asTextList(value: FaceValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string')
  return items.length === 0 ? undefined : items
}

/** Copy the optional common fields a block may state. */
function commonFields(row: FaceRecord): BlockBase {
  const title = asText(row.title)
  return title === undefined ? {} : { title }
}

/**
 * Parse one block, tolerating nothing: a block whose required fields are
 * missing or ill-typed is dropped rather than rendered as a guess.
 * @param value - one element of the face's `blocks` array.
 * @returns the block, or undefined when it is not a v1 block.
 */
function parseBlock(value: FaceValue | undefined): FaceBlock | undefined {
  const row = asRecord(value)
  if (row === undefined) return undefined
  const type = row.type
  const params = asRecord(row.params)
  const shared = { ...commonFields(row), ...params === undefined ? {} : { params } }
  switch (type) {
    case 'metric-card': {
      const verb = asText(row.verb)
      if (verb === undefined) return undefined
      const format = asText(row.format)
      const extract = asText(row.extract)
      return {
        type,
        verb,
        ...shared,
        ...format === undefined ? {} : { format },
        ...extract === undefined ? {} : { extract },
      }
    }
    case 'status-badge': {
      const verb = asText(row.verb)
      if (verb === undefined) return undefined
      const extract = asText(row.extract)
      return { type, verb, ...shared, ...extract === undefined ? {} : { extract } }
    }
    case 'line-chart': {
      const verb = asText(row.verb)
      if (verb === undefined) return undefined
      const x = asText(row.x)
      const y = asText(row.y)
      return {
        type,
        verb,
        ...shared,
        ...x === undefined ? {} : { x },
        ...y === undefined ? {} : { y },
      }
    }
    case 'data-table': {
      const verb = asText(row.verb)
      if (verb === undefined) return undefined
      const columns = asTextList(row.columns)
      const maxRows = asCount(row.max_rows)
      return {
        type,
        verb,
        ...shared,
        ...columns === undefined ? {} : { columns },
        ...maxRows === undefined ? {} : { max_rows: maxRows },
      }
    }
    case 'log-view': {
      const verb = asText(row.verb)
      return verb === undefined ? undefined : { type, verb, ...shared }
    }
    case 'action-button': {
      const verb = asText(row.verb)
      if (verb === undefined) return undefined
      return { type, verb, ...shared, ...row.confirm === true ? { confirm: true } : {} }
    }
    case 'param-form': {
      const verb = asText(row.verb)
      if (verb === undefined) return undefined
      const fields = parseFields(row.fields)
      return fields === undefined ? undefined : { type, verb, ...shared, fields }
    }
    case 'embed': {
      const path = asText(row.path)
      return path === undefined ? undefined : { type, path, ...shared }
    }
    default:
      // The component set is closed: an unknown type is a future face this
      // renderer cannot draw, so the block is skipped rather than guessed at.
      return undefined
  }
}

/** Parse a form's fields; undefined when the list states no usable field. */
function parseFields(value: FaceValue | undefined): readonly FormField[] | undefined {
  if (!Array.isArray(value)) return undefined
  const fields: FormField[] = []
  for (const item of value) {
    const row = asRecord(item)
    if (row === undefined) continue
    const name = asText(row.name)
    const label = asText(row.label)
    const type = row.type
    if (name === undefined || label === undefined) continue
    if (type !== 'number' && type !== 'string' && type !== 'boolean' && type !== 'select') continue
    const options = asTextList(row.options)
    const fallback = row.default
    fields.push({
      name,
      label,
      type,
      ...fallback === undefined ? {} : { default: fallback },
      ...options === undefined ? {} : { options },
    })
  }
  return fields.length === 0 ? undefined : fields
}

/**
 * Parse a face.json document into the renderable form.
 * @param value - the parsed face as the Remote delivered it.
 * @returns the face, or null when the document is not a v1 face (no blocks
 *   array, or not one block this renderer can draw).
 */
export function parseFace(value: RawFace | null): FaceSpec | null {
  if (value === null) return null
  const blocksValue = value.blocks
  if (!Array.isArray(blocksValue)) return null
  const blocks: FaceBlock[] = []
  for (const raw of blocksValue) {
    const block = parseBlock(raw)
    if (block !== undefined) blocks.push(block)
  }
  if (blocks.length === 0) return null
  return { version: 1, title: asText(value.title) ?? '', blocks }
}

/** One dot-path segment: an identifier or an integer index (negative counts from the end). */
const SEGMENT = /^(?:[A-Za-z_][A-Za-z0-9_]*|-?[0-9]+)$/u
/** An integer index segment. */
const INDEX = /^-?[0-9]+$/u

/**
 * Walk one dot path into a JSON value: identifier segments index objects,
 * integer segments index arrays (negative from the end). A malformed path, a
 * missing key, or a walk off the end answers undefined rather than throwing —
 * the schema rejects malformed paths at generation time, so this is the
 * renderer's tolerance for a face that never passed the validator.
 * @param root - the value to walk, usually a verb result.
 * @param path - the dot path, e.g. `rows`, `head.0`, `tail.-1.date`.
 * @returns the value at the path, or undefined when the walk cannot continue.
 */
export function extractPath(root: FaceValue | undefined, path: string): FaceValue | undefined {
  if (path === '') return undefined
  let current: FaceValue | undefined = root
  for (const segment of path.split('.')) {
    if (!SEGMENT.test(segment)) return undefined
    if (current === undefined || current === null) return undefined
    if (Array.isArray(current)) {
      if (!INDEX.test(segment)) return undefined
      const index = Number(segment)
      const at = index < 0 ? current.length + index : index
      current = at < 0 || at >= current.length ? undefined : current[at]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = current[segment]
  }
  return current
}

/** Which key a component prefers when the face states no `extract`. */
export type ScalarPreference = 'numeric' | 'status'

/** Status keys a `status-badge` prefers, in order. */
const STATUS_KEYS = ['status', 'state', 'badge'] as const

/**
 * Resolve the one scalar a metric card or status badge shows.
 *
 * With an `extract` path the walk decides; without one the result itself is
 * used when it is already a scalar, and a dictionary result is searched by the
 * component's own preference order. A walk that lands on an object or array is
 * not a scalar: the caller renders the empty placeholder, never the raw value.
 * @param result - the data verb's result.
 * @param extract - the block's dot path, or undefined.
 * @param preference - the component's fallback key preference.
 * @returns the scalar value, or undefined when none is found.
 */
export function scalarOf(
  result: FaceValue | undefined,
  extract: string | undefined,
  preference: ScalarPreference,
): FaceValue | undefined {
  const candidate = extract === undefined ? implicitScalar(result, preference) : extractPath(result, extract)
  if (candidate === undefined || candidate === null) return undefined
  if (typeof candidate === 'object') return undefined
  return candidate
}

/** The scalar a result offers without an `extract` path. */
function implicitScalar(result: FaceValue | undefined, preference: ScalarPreference): FaceValue | undefined {
  if (result === undefined || result === null) return undefined
  if (typeof result !== 'object') return result
  if (Array.isArray(result)) return undefined
  if (preference === 'status') {
    for (const key of STATUS_KEYS) {
      const value = result[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return undefined
  }
  for (const value of Object.values(result)) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * Render one scalar for display, honouring the block's format hint.
 * @param value - the scalar resolved by {@link scalarOf}.
 * @param format - `percent`, a `0.00`-style digit pattern, `date`, or undefined.
 * @returns the display text, or null when there is no value to show.
 */
export function formatScalar(value: FaceValue | undefined, format?: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    // An ISO timestamp reads as a date once the hint asks for one.
    return format === 'date' && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : value
  }
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (format === 'percent') return `${(value * 100).toFixed(1)}%`
    const digits = format === undefined ? undefined : /^0\.(0+)$/u.exec(format)?.[1]?.length
    if (digits !== undefined) return value.toFixed(digits)
    return String(value)
  }
  return null
}

/**
 * The row array one result carries.
 *
 * Explicit row arrays win (`rows` as an array, `data`, `items`, or the result
 * itself); otherwise the `preview` window pair is read, earliest window first.
 * When both windows are present and `head` already covers every row, `tail`
 * would only repeat them, so `head` alone is returned.
 * @param result - the data verb's result.
 * @returns the rows, empty when the result carries none.
 */
export function rowsOf(result: FaceValue | undefined): readonly FaceRecord[] {
  const value = result
  if (value === undefined) return []
  const asRows = (candidate: unknown): readonly FaceRecord[] | undefined => {
    if (!Array.isArray(candidate)) return undefined
    const rows = candidate.map(asRecord).filter((row): row is FaceRecord => row !== undefined)
    return rows.length === 0 ? undefined : rows
  }
  const direct = asRows(value) ?? asRecord(value)?.['rows']
  const directRows = asRows(direct)
  if (directRows !== undefined) return directRows
  const record = asRecord(value)
  if (record === undefined) return []
  const head = asRows(record.head) ?? []
  const tail = asRows(record.tail) ?? []
  if (head.length === 0) return tail
  const total = typeof record.rows === 'number' ? record.rows : undefined
  return total !== undefined && head.length >= total ? head : [...head, ...tail]
}

/** One column name list for a table: an explicit list, or the first row's keys. */
function columnsOf(result: FaceValue | undefined, rows: readonly FaceRecord[]): readonly string[] {
  const stated = Array.isArray(asRecord(result)?.columns)
    ? asTextList(asRecord(result)?.columns)
    : undefined
  if (stated !== undefined) return stated
  return rows.length === 0 ? [] : Object.keys(rows[0] ?? {})
}

/** One table projection: the columns to show and the rows to fill. */
export interface TableData {
  readonly columns: readonly string[]
  readonly rows: readonly FaceRecord[]
}

/**
 * Project a verb result into the table one `data-table` block renders.
 * @param result - the data verb's result.
 * @param columns - the block's column selection; absent means every column.
 * @param maxRows - the block's row cap; absent means {@link DEFAULT_MAX_ROWS}.
 * @returns the columns (in block order, restricted to those the data carries)
 *   and the capped rows; `rows` reports the untruncated count.
 */
export function tableOf(
  result: FaceValue | undefined,
  columns: readonly string[] | undefined,
  maxRows: number | undefined,
): TableData & { readonly totalRows: number } {
  const rows = rowsOf(result)
  const available = columnsOf(result, rows)
  const selected = columns === undefined
    ? available
    : columns.filter(column => available.includes(column) || rows.some(row => column in row))
  const cap = maxRows ?? DEFAULT_MAX_ROWS
  return { columns: selected, rows: rows.slice(0, cap), totalRows: rows.length }
}

/** One chart projection: the plotted points and the labels its axis shows. */
export interface ChartData {
  /** Y values in row order. */
  readonly y: readonly number[]
  /** One X label per point, already stringified. */
  readonly xLabels: readonly string[]
  /** X values in row order, present only when the X column is numeric. */
  readonly x: readonly number[]
  /** Whether {@link x} is a real scale (false means row positions). */
  readonly numericX: boolean
  readonly min: number
  readonly max: number
}

/** Render one arbitrary data value as an axis label. */
function labelOf(value: FaceValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return ''
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : String(value)
}

/**
 * Project a verb result into the polyline one `line-chart` block draws.
 * @param result - the data verb's result.
 * @param xName - the block's X column; absent means the first row column.
 * @param yName - the block's Y column; absent means the first numeric column that is not X.
 * @returns the chart data, or null when the result carries no drawable point.
 */
export function chartOf(result: FaceValue | undefined, xName?: string, yName?: string): ChartData | null {
  const rows = rowsOf(result)
  const first = rows[0]
  if (first === undefined) return null
  const keys = Object.keys(first)
  const xKey = xName ?? keys[0] ?? ''
  const yKey = yName ?? keys.find(key => key !== xKey && typeof first[key] === 'number') ?? keys[1] ?? ''
  const y: number[] = []
  const xLabels: string[] = []
  const xValues: number[] = []
  let numericX = true
  for (const row of rows) {
    const value = row[yKey]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const xValue = row[xKey]
    const asNumber = typeof xValue === 'number' ? xValue : Number(xValue)
    if (typeof xValue !== 'number' && !(typeof xValue === 'string' && xValue !== '' && Number.isFinite(asNumber))) {
      numericX = false
    }
    y.push(value)
    xLabels.push(labelOf(xValue))
    xValues.push(numericX ? asNumber : xValues.length)
  }
  if (y.length === 0) return null
  return {
    y,
    xLabels,
    x: numericX ? xValues : [],
    numericX,
    min: Math.min(...y),
    max: Math.max(...y),
  }
}

/**
 * The text one `log-view` block shows: a string result verbatim, a record's
 * `text` (a report body) or `files` (a version directory's file list, one per
 * line), a line list joined, or a script verb's captured stdout. Anything else
 * is rendered as pretty-printed JSON so the block still shows something
 * readable.
 * @param result - the data verb's result.
 * @param stdout - the response's captured stdout, when the verb was a script.
 * @returns the display text.
 */
export function textOf(result: FaceValue | undefined, stdout: string | undefined): string {
  if (typeof result === 'string') return result
  const record = asRecord(result)
  if (record !== undefined) {
    if (typeof record.text === 'string') return record.text
    if (Array.isArray(record.files)) {
      return record.files.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    }
  }
  if (stdout !== undefined && stdout !== '') return stdout
  if (Array.isArray(result)) {
    return result.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
  }
  if (record !== undefined) {
    const nested = record.stdout
    if (typeof nested === 'string') return nested
    const lines = record.lines
    if (Array.isArray(lines)) return lines.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    return JSON.stringify(record, null, 2)
  }
  return ''
}

/** One data request a face's blocks share. */
export interface VerbRequest {
  readonly key: string
  readonly verb: string
  readonly params?: VerbParams
}

/** Stable JSON with sorted object keys, so equal parameters share one key. */
function stableJson(value: FaceValue | undefined): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

/**
 * The identity of one data request: verb plus parameters, key-order and
 * `undefined`-insensitive. The registry key and the renderer's lookup share it.
 * @param verb - the verb name.
 * @param params - the parameters, or undefined.
 * @returns the stable key.
 */
export function verbKey(verb: string, params: VerbParams | undefined): string {
  return `${verb}\u0000${stableJson(params)}`
}

/**
 * The distinct data requests a face issues: one entry per `asset` + `verb` +
 * `params` triple, so several blocks reading the same verb over the same
 * parameters cost one bridge call (verb-bridge.md §2).
 * @param blocks - the face's blocks.
 * @returns the distinct requests, in first-appearance order.
 */
export function verbRequests(blocks: readonly FaceBlock[]): readonly VerbRequest[] {
  const requests: VerbRequest[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    if (!isDataBlock(block)) continue
    const key = verbKey(block.verb, block.params)
    if (seen.has(key)) continue
    seen.add(key)
    requests.push({ key, verb: block.verb, ...block.params === undefined ? {} : { params: block.params } })
  }
  return requests
}
