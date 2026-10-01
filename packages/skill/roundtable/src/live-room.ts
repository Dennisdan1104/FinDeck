/**
 * The live room's durable copy. The roundtable room is process-local state —
 * one open table, its transcript, the controller state, and the material its
 * deep speakers have already read — and this module writes that state to
 * `<archiveDir>/live.json` after every change so a restarted host restores the
 * table instead of losing it.
 *
 * The write is atomic (tmp file + rename), and it is best-effort: a disk that
 * refuses the write logs and leaves the room running, because losing the copy
 * of an open table is not a reason to stop the table.
 *
 * The file holds only what a resumed room needs to keep speaking with the same
 * answers. The turn in flight is deliberately absent: a process that dies
 * mid-speech restores the room in a waiting state (see {@link restoreLiveRoom})
 * rather than resuming a half-written turn.
 *
 * @module @deepseek-ai/dsh-roundtable/live-room
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoundtableEntry, RoundtableTableConfig } from './identities.ts'
import type { PendingRun, RoundtableState, RoundtableTurn } from './state-machine.ts'
import { parseTranscriptEntry } from './parse.ts'

/** The live-room file's name under the archive root. */
export const LIVE_ROOM_FILE = 'live.json'

/** Shared read material one deep speaker may carry, trimmed oldest-first past this. */
export const LIVE_ROOM_SHARED_READ_BUDGET = 400_000

/** The live room's durable body: everything a resumed room needs to keep speaking. */
export interface LiveRoomRecord {
  readonly version: 1
  /** ISO instant the table was opened. */
  readonly openedAt: string
  readonly table: RoundtableTableConfig
  /** The controller state, the background-run ledger it carries included. */
  readonly state: RoundtableState
  readonly transcript: readonly RoundtableEntry[]
  /** What earlier deep speakers read, shared with later ones. */
  readonly sharedReads: readonly { readonly name: string; readonly arguments: string; readonly result: string }[]
}

/** The room as a restarted process resumes it: at the user, never mid-speech. */
export interface RestoredRoom {
  readonly table: RoundtableTableConfig
  readonly state: RoundtableState
  readonly transcript: readonly RoundtableEntry[]
  readonly openedAt: string
  readonly sharedReads: readonly { readonly name: string; readonly arguments: string; readonly result: string }[]
}

/**
 * Write the live room's durable copy, or remove it when no table is open.
 * @param dir - the archive root the file lives under.
 * @param record - the room to persist, or null for an empty room.
 */
export async function writeLiveRoom(dir: string, record: LiveRoomRecord | null): Promise<void> {
  const file = join(dir, LIVE_ROOM_FILE)
  if (record === null) {
    await rm(file, { force: true })
    return
  }
  await mkdir(dir, { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf-8')
  await rename(tmp, file)
}

/**
 * Read the live room back, or answer null when there is none to resume.
 *
 * A missing file is the ordinary "no table was open" answer. A file that
 * cannot be read or parsed throws: the caller logs it and starts with no table,
 * so one corrupt file never keeps the host from booting.
 * @param dir - the archive root the file lives under.
 * @returns the room to resume, or null when nothing was open.
 * @throws when a present file is unreadable or malformed.
 */
export async function readLiveRoom(dir: string): Promise<RestoredRoom | null> {
  const file = join(dir, LIVE_ROOM_FILE)
  if (!(await stat(file).then(entry => entry.isFile(), () => false))) return null
  const record = parseLiveRoom(JSON.parse(await readFile(file, 'utf-8')))
  return {
    table: record.table,
    // A room that was mid-round when the process died comes back waiting for
    // the user: the speaker generating then is gone and its partial with it.
    state: record.state.phase === 'round'
      ? { phase: 'wait-user-guide', queue: [], interrupted: null, turns: [], rounds: record.state.rounds }
      : record.state,
    transcript: record.transcript,
    openedAt: record.openedAt,
    sharedReads: record.sharedReads,
  }
}

/**
 * Trim shared read material to the durable budget, dropping the OLDEST reads
 * first (later speakers reuse the most recent material, and a dropped read is
 * simply fetched again).
 * @param reads - the reads in the order they were made.
 * @returns the newest reads that fit the budget.
 */
export function boundSharedReads(
  reads: readonly { readonly name: string; readonly arguments: string; readonly result: string }[],
): { readonly name: string; readonly arguments: string; readonly result: string }[] {
  let used = 0
  const kept: { name: string; arguments: string; result: string }[] = []
  for (let index = reads.length - 1; index >= 0; index -= 1) {
    const read = reads[index]
    /* v8 ignore next -- the loop index stays inside the array it walks */
    if (read === undefined) continue
    used += read.result.length
    if (used > LIVE_ROOM_SHARED_READ_BUDGET && kept.length > 0) break
    kept.push({ name: read.name, arguments: read.arguments, result: read.result })
  }
  return kept.reverse()
}

/** Defensive parse of the live-room body; any malformed field fails the file. */
function parseLiveRoom(data: unknown): LiveRoomRecord {
  if (typeof data !== 'object' || data === null) throw new Error('the live roundtable record is not an object')
  const record = data as Record<string, unknown>
  if (record.version !== 1) {
    throw new Error(`the live roundtable record has unsupported version ${JSON.stringify(record.version)}`)
  }
  if (typeof record.openedAt !== 'string' || record.openedAt === '') {
    throw new Error('the live roundtable record must carry an openedAt instant')
  }
  const table = parseTable(record.table)
  if (typeof record.state !== 'object' || record.state === null) {
    throw new Error('the live roundtable record must carry a controller state')
  }
  const state = record.state as Record<string, unknown>
  if (state.phase !== 'wait-user-open' && state.phase !== 'round' && state.phase !== 'wait-user-guide') {
    throw new Error('the live roundtable record carries an unknown phase')
  }
  if (state.interrupted !== null && typeof state.interrupted !== 'string') {
    throw new Error('the live roundtable record carries a malformed interrupted speaker')
  }
  if (!Array.isArray(record.transcript)) {
    throw new Error('the live roundtable record must carry a transcript array')
  }
  const transcript = record.transcript.map((entry) => {
    try {
      return parseTranscriptEntry(entry)
    } catch (error: unknown) {
      throw new Error(`the live roundtable record has a malformed transcript entry: ${String(error)}`)
    }
  })
  const reads = record.sharedReads
  if (!Array.isArray(reads)) {
    throw new Error('the live roundtable record must carry a sharedReads array')
  }
  const sharedReads = reads.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('a shared read must be an object')
    }
    const { name, arguments: args, result } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof args !== 'string' || typeof result !== 'string') {
      throw new Error('a shared read must carry name/arguments/result strings')
    }
    return { name, arguments: args, result }
  })
  return {
    version: 1,
    openedAt: record.openedAt,
    table,
    state: {
      phase: state.phase,
      queue: parseSpeakers(state.queue, 'queue'),
      interrupted: state.interrupted,
      turns: parseTurns(state.turns),
      rounds: parseRounds(state.rounds),
      ...parsePendingRuns(state.pendingRuns),
    },
    transcript,
    sharedReads,
  }
}

/** One persisted table configuration, seed included. */
function parseTable(value: unknown): RoundtableTableConfig {
  if (typeof value !== 'object' || value === null) throw new Error('the live roundtable record must carry a table')
  const { depth, rosterId, provider, model } = value as Record<string, unknown>
  if (depth !== 'shallow' && depth !== 'deep') throw new Error('the live roundtable record carries an unknown depth')
  if (typeof rosterId !== 'string' || rosterId === '') {
    throw new Error('the live roundtable record\'s table.rosterId must be a non-empty string')
  }
  if (typeof provider !== 'string' || provider === '') {
    throw new Error('the live roundtable record\'s table.provider must be a non-empty string')
  }
  if (typeof model !== 'string' || model === '') {
    throw new Error('the live roundtable record\'s table.model must be a non-empty string')
  }
  const seed = (value as { seed?: unknown }).seed
  if (seed === undefined) return { depth, rosterId, provider, model }
  if (typeof seed !== 'object' || seed === null
    || typeof (seed as { sessionId?: unknown }).sessionId !== 'string'
    || typeof (seed as { title?: unknown }).title !== 'string'
    || typeof (seed as { file?: unknown }).file !== 'string') {
    throw new Error('the live roundtable record\'s table.seed must carry sessionId/title/file strings')
  }
  return { depth, rosterId, provider, model, seed: seed as NonNullable<RoundtableTableConfig['seed']> }
}

/** A list of speaker ids. */
function parseSpeakers(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`the live roundtable record's state.${field} must be a list of speaker ids`)
  }
  return value as string[]
}

/**
 * The background-run ledger a state carries. A missing key is the ordinary
 * "this table submitted no runs" answer and yields no field; a present key
 * must be a complete ledger, so a corrupt one never half-restores.
 */
function parsePendingRuns(value: unknown): { pendingRuns?: PendingRun[] } {
  if (value === undefined) return {}
  if (!Array.isArray(value)) {
    throw new Error('the live roundtable record\'s state.pendingRuns must be an array')
  }
  return {
    pendingRuns: value.map((run) => {
      if (typeof run !== 'object' || run === null) throw new Error('a pending run must be an object')
      const { runId, recordPath, asset, verb, speaker, submittedAt } = run as Record<string, unknown>
      if (typeof runId !== 'string' || typeof recordPath !== 'string' || typeof asset !== 'string'
        || typeof verb !== 'string' || typeof speaker !== 'string' || typeof submittedAt !== 'string') {
        throw new Error('a pending run must carry runId/recordPath/asset/verb/speaker/submittedAt strings')
      }
      return { runId, recordPath, asset, verb, speaker, submittedAt }
    }),
  }
}

/** One round's completed turns. */
function parseTurns(value: unknown): RoundtableTurn[] {
  if (!Array.isArray(value)) throw new Error('the live roundtable record\'s turns must be an array')
  return value.map((turn) => {
    if (typeof turn !== 'object' || turn === null) throw new Error('a recorded turn must be an object')
    const { speaker, outcome } = turn as Record<string, unknown>
    if (typeof speaker !== 'string' || (outcome !== 'spoke' && outcome !== 'skipped')) {
      throw new Error('a recorded turn must carry a speaker id and a known outcome')
    }
    return { speaker, outcome }
  })
}

/** The completed rounds. */
function parseRounds(value: unknown): RoundtableTurn[][] {
  if (!Array.isArray(value)) throw new Error('the live roundtable record\'s rounds must be an array')
  return value.map(turns => parseTurns(turns))
}
