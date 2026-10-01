/**
 * Build-static first-party Session format migration catalog.
 *
 * Two assemblies share one chain and differ only in the V3→V4 edge's child evidence:
 *
 * - `sessionFormatCatalog` is the static inventory. Its header path (`readHeader`) and its
 *   current-generation restore need no child evidence, so listing, header classification,
 *   and reads of an already-current artifact use it directly.
 * - `createSessionFormatCatalogWithChildren(children)` binds one parent's children. The
 *   V3→V4 edge is not self-sufficient — its unbound declaration refuses a body rather than
 *   assuming the parent has no children — so **every body read of a historical generation
 *   must use this assembly**, because a v0/v1/v2/v3 source reaches V4 through that edge.
 *
 * A persistence `open` path therefore decodes the parent's source generation with
 * `historicalSessionFormatCatalog`, collects `collectParentChildEvidence`, and restores
 * through `createSessionFormatCatalogWithChildren`. Passing an empty array is how a caller
 * states "this parent recorded no children"; omitting the array is not expressible.
 */

export { sessionFormatCatalog, sessionFormatCatalogOptions } from './generated.ts'
export { collectParentChildEvidence, createSessionFormatCatalogWithChildren } from './children.ts'
export { historicalSessionFormatCatalog } from './historical.ts'
export { SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
