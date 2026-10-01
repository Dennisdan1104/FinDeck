/**
 * Durable roundtable transcripts. The engine writes one JSON archive per
 * closed table under `<harness home>/roundtables/`; readers (the
 * `tool-roundtable` package, humans, later reports) list and read them back.
 * The on-disk layout is this module's one contract: file name
 * `<closed-at epoch millis>-<rosterId>.json`, body a {@link RoundtableArchiveRecord}.
 * An in-memory table is archived only when it is closed with at least one
 * transcript entry, so an abandoned empty opening writes nothing.
 *
 * @module @deepseek-ai/dsh-roundtable/archive
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {
  RoundtableArchiveRecord,
  RoundtableArchiveSeed,
  RoundtableArchiveSummary,
  RoundtableEntry,
} from './identities.ts'
import { parseTranscriptEntry } from './parse.ts'

// The record/summary TYPES live in identities.ts (a types-only module the
// browser face can reference); this module re-exports them so archive
// consumers keep one import site.
export type {
  RoundtableArchiveRecord,
  RoundtableArchiveSeed,
  RoundtableArchiveSummary,
  RoundtableArchiveTable,
} from './identities.ts'

/** The default archive root, `<harness home>/roundtables`. */
export function roundtableArchiveDir(): string {
  return dshHomePath('roundtables')
}

/** Valid archive file ids: `<epoch millis>-<roster id>`; doubles as the traversal guard. */
export const ARCHIVE_ID_PATTERN = /^\d{13}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Characters of the first user message a summary serves. */
const TOPIC_MAX_CHARS = 80

/**
 * Write one archive atomically (tmp file + rename) and name it by close time.
 * @param dir - the archive root.
 * @param record - the closed table's complete record.
 * @returns the archive id (file name without extension).
 */
export async function writeRoundtableArchive(
  dir: string,
  record: RoundtableArchiveRecord,
): Promise<string> {
  const closedMs = Date.parse(record.closedAt)
  if (!Number.isFinite(closedMs)) {
    throw new Error(`roundtable archive: closedAt is not an ISO instant: ${record.closedAt}`)
  }
  const id = `${closedMs}-${record.table.rosterId}`
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${id}.json`)
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf-8')
  await rename(tmp, file)
  return id
}

/**
 * Every well-formed archive, newest first.
 *
 * The file names lead with the close instant (13 epoch-millis digits), so a
 * descending name scan bounds the reads to the `limit` newest candidates; the
 * order the summaries are returned in is then re-sorted by each record's own
 * `closedAt`, so a file whose name and body disagree still lists where its
 * record belongs.
 * @param dir - the archive root.
 * @param limit - maximum rows to return.
 * @returns summaries in newest-first order; an absent directory reads empty.
 */
export async function listRoundtableArchives(
  dir: string,
  limit: number,
): Promise<RoundtableArchiveSummary[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const records: { id: string; record: RoundtableArchiveRecord }[] = []
  for (const name of names.sort().reverse()) {
    if (records.length >= limit) break
    if (!name.endsWith('.json')) continue
    const id = name.slice(0, -'.json'.length)
    if (!ARCHIVE_ID_PATTERN.test(id)) continue
    records.push({ id, record: await readRoundtableArchive(dir, id) })
  }
  return newestFirst(records).map(({ id, record }) => summarize(id, record))
}

/** The listing order the history column renders: `closedAt` descending, id as the tiebreak. */
function newestFirst<T extends { readonly id: string; readonly record: RoundtableArchiveRecord }>(
  records: readonly T[],
): T[] {
  return [...records].sort((left, right) => left.record.closedAt === right.record.closedAt
    ? right.id.localeCompare(left.id)
    : right.record.closedAt.localeCompare(left.record.closedAt))
}

/**
 * Read one archive; malformed content fails loud rather than serving a partial
 * table.
 * @param dir - the archive root.
 * @param id - archive id (file name without extension).
 * @returns the complete archived record.
 * @throws when the id is malformed, the file is absent, or the body is not a
 *   version-1 record.
 */
export async function readRoundtableArchive(dir: string, id: string): Promise<RoundtableArchiveRecord> {
  if (!ARCHIVE_ID_PATTERN.test(id)) {
    throw new Error(`roundtable archive id must be "<epoch-millis>-<roster-id>", got "${id}"`)
  }
  const data: unknown = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf-8'))
  return parseArchiveRecord(id, data)
}

/** Defensive parse of one archive body; any malformed field fails the whole file. */
function parseArchiveRecord(id: string, data: unknown): RoundtableArchiveRecord {
  if (typeof data !== 'object' || data === null) throw new Error(`roundtable archive "${id}" is not an object`)
  const record = data as Record<string, unknown>
  if (record.version !== 1) throw new Error(`roundtable archive "${id}" has unsupported version ${JSON.stringify(record.version)}`)
  const table = record.table
  if (typeof table !== 'object' || table === null) throw new Error(`roundtable archive "${id}" has no table`)
  const { depth, rosterId, rosterName, provider, model } = table as Record<string, unknown>
  if (depth !== 'shallow' && depth !== 'deep') throw new Error(`roundtable archive "${id}" has an unknown depth`)
  if (typeof rosterId !== 'string' || rosterId === '') throw new Error(`roundtable archive "${id}" table.rosterId must be a non-empty string`)
  if (typeof rosterName !== 'string' || rosterName === '') throw new Error(`roundtable archive "${id}" table.rosterName must be a non-empty string`)
  if (typeof provider !== 'string' || provider === '') throw new Error(`roundtable archive "${id}" table.provider must be a non-empty string`)
  if (typeof model !== 'string' || model === '') throw new Error(`roundtable archive "${id}" table.model must be a non-empty string`)
  const seed = (table as { seed?: unknown }).seed
  if (seed !== undefined
    && (typeof seed !== 'object' || seed === null
      || typeof (seed as { sessionId?: unknown }).sessionId !== 'string'
      || typeof (seed as { title?: unknown }).title !== 'string')) {
    throw new Error(`roundtable archive "${id}" table.seed must carry sessionId and title strings`)
  }
  if (typeof record.closedAt !== 'string' || record.openedAt !== null && typeof record.openedAt !== 'string') {
    throw new Error(`roundtable archive "${id}" openedAt/closedAt must be ISO strings (openedAt may be null)`)
  }
  if (!Array.isArray(record.transcript)) throw new Error(`roundtable archive "${id}" transcript must be an array`)
  const transcript: RoundtableEntry[] = []
  for (const entry of record.transcript) {
    try {
      transcript.push(parseTranscriptEntry(entry))
    } catch (error: unknown) {
      throw new Error(`roundtable archive "${id}" has a malformed transcript entry: ${String(error)}`)
    }
  }
  return {
    version: 1,
    openedAt: record.openedAt,
    closedAt: record.closedAt,
    table: {
      depth,
      rosterId,
      rosterName,
      provider,
      model,
      ...seed === undefined ? {} : { seed: seed as RoundtableArchiveSeed },
    },
    transcript,
  }
}

/** The listing row of one archive: header fields plus turn count and topic. */
function summarize(id: string, record: RoundtableArchiveRecord): RoundtableArchiveSummary {
  const firstUser = record.transcript.find(entry => entry.kind === 'user')
  return {
    id,
    openedAt: record.openedAt,
    closedAt: record.closedAt,
    depth: record.table.depth,
    rosterId: record.table.rosterId,
    rosterName: record.table.rosterName,
    model: record.table.model,
    turns: record.transcript.filter(entry => entry.kind === 'speaker').length,
    topic: firstUser === undefined
      ? ''
      : firstUser.text.length > TOPIC_MAX_CHARS ? `${firstUser.text.slice(0, TOPIC_MAX_CHARS)}…` : firstUser.text,
    ...record.table.seed === undefined ? {} : { seedTitle: record.table.seed.title },
  }
}
