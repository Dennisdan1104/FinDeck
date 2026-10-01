/**
 * The background-run ledger's decision core: what a turn boundary does with
 * the runs a table has submitted. A detached run writes a record file under
 * `<asset_root>/runs/`; the engine reads the record for every ledger entry and
 * feeds the parsed bodies here, so the ordering, staleness, and supplement
 * decisions stay a pure function of the state plus what the files said.
 *
 * A finished run (`ok` / `error`) is consumed: its summary becomes a system
 * transcript note the whole table sees, and the speaker that submitted it gets
 * one supplement turn — several runs from the same speaker ride one
 * supplement. A record that cannot be read, or a run still `running` past the
 * staleness limit, is noted as lost and dropped from the ledger. Everything
 * else stays in the ledger for the next boundary.
 *
 * @module @deepseek-ai/dsh-roundtable/pending-runs
 */

import { insertSupplement, type PendingRun, type RoundtableState } from './state-machine.ts'

/** Terminal statuses a run record can carry. */
const TERMINAL_STATUSES = ['ok', 'error'] as const

/** Characters of a run's request and response that a summary note carries. */
const PREVIEW_CHARS = 400

/**
 * A run record as read back from `<asset_root>/runs/<run_id>.json`. Every
 * field is `unknown` because the file is a durable boundary another process
 * writes; the summary reads only the keys it needs and falls back to the
 * ledger entry for the rest.
 */
export interface RunRecordBody {
  readonly run_id?: unknown
  readonly kind?: unknown
  readonly request?: unknown
  readonly status?: unknown
  readonly ts_start?: unknown
  readonly duration_s?: unknown
  readonly response?: unknown
  readonly error?: unknown
}

/**
 * One ledger entry with its record read once: `body` is the parsed record, or
 * null when the file is missing, unreadable, or not a JSON object — the
 * ledger's "lost" case.
 */
export interface PendingRunObservation {
  readonly entry: PendingRun
  readonly body: RunRecordBody | null
}

/** What one boundary check decided. */
export interface ConsumedPendingRuns {
  /** The new controller state: the kept ledger, with one supplement queued per finished speaker. */
  readonly state: RoundtableState
  /** Entries still running and not stale, in submission order; the ledger to keep. */
  readonly pendingRuns: PendingRun[]
  /** System transcript notes to record, in consumption order (one per finished or lost run). */
  readonly notes: string[]
  /**
   * One supplement per speaker with finished runs, in submission order; each
   * `summary` joins that speaker's finished run notes.
   */
  readonly supplements: { readonly speaker: string; readonly summary: string }[]
}

/**
 * Consume the ledger at a turn boundary.
 *
 * Terminal runs are consumed in the order observed: each produces one system
 * note, and their speaker is queued for exactly one supplement turn, after the
 * speaker that just finished and before the speakers still waiting. Stale runs
 * (record unreadable, or `running` past `stalenessS`) produce a loss note and
 * no supplement. Runs still in flight stay in the ledger and are reported back
 * so the caller can persist them.
 * @param state - the state after the finished speaker stepped down.
 * @param observations - the ledger in submission order, each with its record read.
 * @param options - the boundary's clock (`now`, epoch millis) and staleness limit in seconds.
 * @returns the next state, the kept ledger, the notes to record, and the supplement summaries.
 */
export function consumePendingRuns(
  state: RoundtableState,
  observations: readonly PendingRunObservation[],
  options: { readonly now: number; readonly stalenessS: number },
): ConsumedPendingRuns {
  const pendingRuns: PendingRun[] = []
  const notes: string[] = []
  /** Finished-run notes per speaker, in submission order. */
  const finished = new Map<string, string[]>()
  /** Speakers owed a supplement, in ledger (submission) order. */
  const owed: string[] = []
  for (const { entry, body } of observations) {
    if (body !== null && body.status === 'running') {
      if (isStale(entry, body, options)) notes.push(lostNote(entry, options.stalenessS))
      else pendingRuns.push(entry)
      continue
    }
    if (body === null || !TERMINAL_STATUSES.includes(body.status as typeof TERMINAL_STATUSES[number])) {
      // An unreadable record, or a status this build does not know: the run
      // can never be consumed, so it leaves the ledger as lost.
      notes.push(lostNote(entry, options.stalenessS))
      continue
    }
    const note = runNote(entry, body)
    notes.push(note)
    const earlier = finished.get(entry.speaker)
    if (earlier === undefined) {
      finished.set(entry.speaker, [note])
      owed.push(entry.speaker)
    } else {
      earlier.push(note)
    }
  }
  let next: RoundtableState = { ...state, pendingRuns }
  // Insert in reverse so the queue reads submission order: the earliest
  // finished speaker takes the floor first.
  for (const speaker of [...owed].reverse()) next = insertSupplement(next, speaker)
  return {
    state: next,
    pendingRuns,
    notes,
    supplements: owed.map(speaker => ({ speaker, summary: (finished.get(speaker) ?? []).join('\n\n') })),
  }
}

/** Whether a run still marked `running` is past the boundary's staleness limit. */
function isStale(entry: PendingRun, body: RunRecordBody, options: { readonly now: number; readonly stalenessS: number }): boolean {
  const started = typeof body.ts_start === 'string' ? Date.parse(body.ts_start) : Number.NaN
  const submitted = Number.isNaN(started) ? Date.parse(entry.submittedAt) : started
  if (Number.isNaN(submitted)) return false
  return (options.now - submitted) / 1000 > options.stalenessS
}

/** The summary note one finished run contributes to the shared transcript. */
function runNote(entry: PendingRun, body: RunRecordBody): string {
  const status = body.status === 'ok' ? 'ok' : 'error'
  const runId = typeof body.run_id === 'string' && body.run_id !== '' ? body.run_id : entry.runId
  const kind = typeof body.kind === 'string' ? body.kind : 'verb'
  const lines = [
    `后台 run 已完成：${runId}`,
    `类型：${kind}`,
    kind === 'pipeline' ? `流水线：${pipelineName(body.request)}` : `verb：${requestVerb(body.request, entry.verb)}`,
    `状态：${status}`,
  ]
  if (typeof body.duration_s === 'number') lines.push(`耗时：${String(body.duration_s)}s`)
  lines.push(`请求：${preview(body.request)}`)
  lines.push(status === 'ok' ? `响应（截断至 ${String(PREVIEW_CHARS)} 字符）：${responsePreview(body)}` : `错误：${errorText(body)}`)
  return lines.join('\n')
}

/** The note a run that can never be consumed leaves behind. */
function lostNote(entry: PendingRun, stalenessS: number): string {
  return `后台 run 已失联：${entry.runId}（提交于 ${entry.submittedAt}，超过 ${String(stalenessS)} 秒仍未回写终态，或记录文件不可读）。结果不可用；需要的话请重新提交。`
}

/** The verb a request names, falling back to the ledger entry's own verb. */
function requestVerb(request: unknown, fallback: string): string {
  if (typeof request === 'object' && request !== null) {
    const verb = (request as Record<string, unknown>).verb
    if (typeof verb === 'string' && verb !== '') return verb
  }
  return fallback
}

/** The pipeline path a request names. */
function pipelineName(request: unknown): string {
  if (typeof request === 'object' && request !== null) {
    const path = (request as Record<string, unknown>).path
    if (typeof path === 'string' && path !== '') return path
  }
  return '(未知流水线)'
}

/** A run's response as the note carries it: the verb payload, else the whole response. */
function responsePreview(body: RunRecordBody): string {
  const response = body.response
  if (response === undefined) return '(无响应)'
  if (body.kind !== 'pipeline' && typeof response === 'object' && response !== null) {
    const result = (response as Record<string, unknown>).result
    if (result !== undefined) return preview(result)
  }
  return preview(response)
}

/** The run's failure reason, or a placeholder when the record carries none. */
function errorText(body: RunRecordBody): string {
  return typeof body.error === 'string' && body.error !== '' ? body.error : '(无错误消息)'
}

/** One JSON value as readable text, cut to the note's preview budget. */
function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
}
