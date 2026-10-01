/** Parent-specific child evidence binding and the parent-log source it is collected from. */

import { SessionFormatError, createSessionFormatCatalog, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type {
  SessionFormatArtifact,
  SessionFormatCatalog,
  SessionFormatEvent,
  SessionFormatJsonValue,
} from '@deepseek-ai/dsh-session-format'
import { createSessionFormatV3ToV4, sessionFormatV3ToV4 } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { sessionFormatCatalogOptions } from './generated.ts'

/**
 * Assemble a catalog whose V3→V4 edge knows one parent's historical children.
 * @param children - complete child evidence retained unchanged for the catalog's lifetime; an empty array declares no children.
 * @returns a catalog with independent restore state per artifact and unchanged current-format readers.
 */
export function createSessionFormatCatalogWithChildren(children: readonly SessionFormatJsonValue[]): SessionFormatCatalog {
  const migration = createSessionFormatV3ToV4(children)
  return createSessionFormatCatalog({
    ...sessionFormatCatalogOptions,
    migrations: sessionFormatCatalogOptions.migrations.map(edge => edge === sessionFormatV3ToV4 ? migration : edge),
  })
}

/**
 * Collect one parent's child evidence from the parent's own decoded V3 log.
 *
 * A `subagent/catalog` event is a durable discovery fact the parent wrote itself, so it
 * already carries the identity the V3→V4 edge needs: `childId` and `childCreatedAt`. The
 * evidence therefore declares only identity, with `descriptorCount: 0` and a null
 * `descriptor`, which states "the parent recorded this child, no separate descriptor
 * evidence was read". The edge then confirms each declared child against the parent's own
 * catalog facts and appends nothing, so a parent that recorded its children loses none of
 * them and no fact is invented.
 *
 * The verdict for the persistence `open` path: `session-persistence-jsonl` collects this
 * array from the parent's *source* generation rows — before it runs the adjacent chain —
 * and passes the result to {@link createSessionFormatCatalogWithChildren} for the body
 * migrate step. Only events after the source inherited cut count, because that is the
 * boundary the edge itself uses for facts belonging to this parent. A parent with no such
 * facts yields `[]`, and the caller must pass that empty array explicitly: an absent or
 * wrong array is the failure this prerequisite exists to prevent, so nothing downstream
 * may default it.
 *
 * Reading a child's own log for descriptor evidence (`historicalChildCatalogSource`) stays
 * available to callers that already open children; it is deliberately not performed here,
 * because a parent's own facts are authoritative for its ownership and re-opening children
 * would recurse into the migration this evidence is being collected for.
 *
 * @param artifact - decoded source artifact of the parent whose V3→V4 edge needs its children.
 * @returns one identity-only evidence entry per recorded child fact after the inherited cut, in log order.
 */
export function collectParentChildEvidence(artifact: SessionFormatArtifact): readonly SessionFormatJsonValue[] {
  const evidence: SessionFormatJsonValue[] = []
  for (const event of artifact.events) {
    if (event.type !== 'subagent/catalog' || event.seq < artifact.inheritedEventCount) continue
    const fact = catalogIdentity(event)
    evidence.push({ childId: fact['childId'], childCreatedAt: fact['childCreatedAt'], descriptorCount: 0, descriptor: null })
  }
  return evidence
}

/** Read the identity fields the edge consumes from one recorded parent catalog fact. */
function catalogIdentity(event: SessionFormatEvent): { readonly childId: string; readonly childCreatedAt: number } {
  const data = event.data
  if (!isSessionFormatJsonObject(data)) {
    throw new SessionFormatError(`subagent/catalog ${event.seq} data must be an object`)
  }
  const childId = data['childId']
  if (typeof childId !== 'string' || childId.length === 0) {
    throw new SessionFormatError(`subagent/catalog ${event.seq} requires a nonempty childId`)
  }
  return { childId, childCreatedAt: sessionFormatCount(data['childCreatedAt'], `subagent/catalog ${event.seq} childCreatedAt`) }
}
