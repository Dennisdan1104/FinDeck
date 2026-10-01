/**
 * Durable session catalogs: one model-facing user-role message listing a
 * consumer's entries, republished in full when those entries change.
 *
 * A consumer owns its entry record, its message prose, and the tool it lists;
 * this module owns the publication decision they share — the digest over
 * durable entries, the scan of the session log for what the session already
 * published, and the choice between no change, a first publication, and a
 * complete replacement.
 *
 * @module @deepseek-ai/dsh-skill/session-catalog
 */

import { createHash } from 'node:crypto'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'

/**
 * One catalog's durable identity: the message-source kind its messages carry,
 * the fields that decide a republish, the reader that validates a durable
 * record back into entries, and the two publications it renders.
 * @typeParam Entry - durable entry record this catalog's messages carry.
 */
export interface SessionCatalog<Entry> {
  /** Message-source kind every message of this catalog carries. */
  readonly kind: string
  /** Diagnostic name of this catalog; the unreadable-sequence error reads `<name> catalog`. */
  readonly name: string
  /**
   * Fields of one entry that decide a republish. The surrounding message prose
   * is written for the model and must not select a publication.
   * @param entry - one entry about to be published.
   * @returns the canonical field values digested for this catalog.
   */
  readonly digestOf: (entry: Entry) => readonly unknown[]
  /**
   * Entries of one durable source record, or undefined when that record is not
   * a usable catalog.
   * @param source - message source read from the session log or a step's batch.
   * @returns the recorded entries, or undefined when the record is unreadable.
   */
  readonly readEntries: (source: unknown) => readonly Entry[] | undefined
  /**
   * Render this session's first publication of the catalog.
   * @param entries - the entries to list, in catalog order.
   * @returns the durable user message carrying this catalog.
   */
  readonly render: (entries: readonly Entry[]) => UserMessage
  /**
   * Render a complete replacement for an earlier publication.
   * @param entries - the replacing entries, in catalog order.
   * @returns the durable user message carrying the replacement.
   */
  readonly renderUpdate: (entries: readonly Entry[]) => UserMessage
}

/** What one session already published of a catalog, as its log records it. */
interface CatalogHistory {
  /** Whether any readable catalog of this kind is in the log. */
  readonly published: boolean
  /** Digest of the newest catalog entry list the model can still see. */
  readonly visibleDigest?: string
}

/**
 * Normalize one catalog description and bound its rendered length.
 * @param value - raw description of the entry's own source record.
 * @param maxLength - inclusive character bound of the returned description.
 * @returns the single-line description, truncated with a trailing `...`.
 */
export function catalogDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

/**
 * Digest one catalog's entry list. JSON per entry rather than a separator
 * character: every separator is itself a legal field character, so only
 * quoting makes the boundary exact.
 * @param catalog - the catalog whose entries are digested.
 * @param entries - the entries to digest, in catalog order.
 * @returns the hex digest of the canonical entry list.
 */
function digestCatalogEntries<Entry>(catalog: SessionCatalog<Entry>, entries: readonly Entry[]): string {
  const canonical = entries.map(entry => JSON.stringify(catalog.digestOf(entry))).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * What one session's log already published of a catalog.
 *
 * The log can hold a resumed, forked, or externally written seed, and seed
 * validation only guarantees a source object with a non-empty `kind`; no
 * per-kind field is checked there. An unreadable record is therefore treated as
 * "not this catalog" rather than as a publication, so a foreign record never
 * fails every later turn of that session.
 * @param catalog - the catalog whose publications are looked up.
 * @param session - the session whose log is scanned, newest event first.
 * @returns whether anything was published, and the newest visible entry digest.
 * @throws when the log does not hold an event at a sequence number below its own length.
 */
function catalogHistory<Entry>(catalog: SessionCatalog<Entry>, session: Session): CatalogHistory {
  const visible = new Set(session.surface.nodes)
  let published = false
  for (let index = session.seq - 1; index >= 0; index -= 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event === undefined) {
      throw new Error(`${catalog.name} catalog cannot read seq ${String(index)} below the current Session length`)
    }
    if (event.type !== 'user/message' || event.data.source.kind !== catalog.kind) continue
    const entries = catalog.readEntries(event.data.source)
    if (entries === undefined) continue
    const digest = digestCatalogEntries(catalog, entries)
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

/**
 * Entries of the first message in one claimed step that carries a catalog.
 * @param catalog - the catalog whose messages are looked up.
 * @param messages - the step's claimed message batch.
 * @returns that message and its entries, or undefined when the batch has none.
 */
function catalogMessage<Entry>(
  catalog: SessionCatalog<Entry>,
  messages: readonly UserMessage[],
): { message: UserMessage; entries: readonly Entry[] } | undefined {
  for (const message of messages) {
    if (message.source.kind !== catalog.kind) continue
    const entries = catalog.readEntries(message.source)
    if (entries !== undefined) return { message, entries }
  }
  return undefined
}

/**
 * The messages one step should carry for a catalog, or undefined when the step
 * is already correct.
 *
 * Three cases leave the step untouched: the catalog the model can still see
 * already digests to the current entries, a catalog already claimed by this
 * step does, and an empty catalog the session never published. Otherwise a
 * first publication appends and a changed catalog replaces the message this
 * step already claimed.
 * @param catalog - the catalog being published.
 * @param session - the calling session, read for what it already published.
 * @param messages - the step's claimed message batch.
 * @param entries - the entries this step's catalog should carry.
 * @returns the step's replacement message list, or undefined to keep the step as it is.
 */
export function publishSessionCatalog<Entry>(
  catalog: SessionCatalog<Entry>,
  session: Session,
  messages: readonly UserMessage[],
  entries: readonly Entry[],
): readonly UserMessage[] | undefined {
  const digest = digestCatalogEntries(catalog, entries)
  const history = catalogHistory(catalog, session)
  const existing = catalogMessage(catalog, messages)
  if (history.visibleDigest === digest) {
    return existing === undefined
      ? undefined
      : messages.filter(message => message.id !== existing.message.id)
  }
  if (existing !== undefined && digestCatalogEntries(catalog, existing.entries) === digest) return undefined
  if (!history.published && entries.length === 0) {
    return existing === undefined
      ? undefined
      : messages.filter(message => message.id !== existing.message.id)
  }
  const publication = history.published ? catalog.renderUpdate(entries) : catalog.render(entries)
  return existing === undefined
    ? [...messages, publication]
    : messages.map(message => message.id === existing.message.id ? publication : message)
}
