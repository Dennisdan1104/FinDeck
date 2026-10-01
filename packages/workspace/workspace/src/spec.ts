/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema validates the shipped format at the
 * durability boundary and is the direct source of a future RPC wire projection.
 * @module @deepseek-ai/dsh-workspace/src/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from './types.ts'

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceId = z.string().transform(value => value as WorkspaceId)

/**
 * Durable shape of one workspace record. `path` is the `fs.realpath` canon
 * stamped at create; `sessionIds` is the ordered ownership account (array
 * order is display order); timestamps are ISO-8601 strings. `projectDir` is an
 * optional custom project directory stored as given; absent means the derived
 * default `<home>/projects/<id>/`, so the field needs no write-back on read.
 */
export const workspaceRecord = z.object({
  path: z.string(),
  title: z.string(),
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
  projectDir: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>

/**
 * Recoverable two-write mutation marker. The marker is persisted before the
 * record/order pair can diverge, so startup can distinguish an interrupted
 * registry operation from unexplained medium corruption.
 */
const workspacePendingMutation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create'), workspaceId }),
  z.object({ operation: z.literal('delete'), workspaceId }),
])

/**
 * Durable registry state. `initialized` distinguishes a valid empty registry
 * from one that still needs the header-only history bootstrap;
 * `workspaceIds` is the authoritative display order. `archivedSessionIds` is
 * the registry-global archive set layered over workspace accounting: an
 * archived session keeps its `sessionIds` slot (unarchiving must restore the
 * position), so the set never participates in the one-owner accounting
 * invariant. `archivedAt` is the same set's retention clock — session id to
 * the ISO-8601 instant that id entered the set — which the startup sweep reads
 * to discard an archive older than the configured retention. Defaulted so
 * records written before either field parse unchanged; an id the clock does not
 * name (an archive written before the clock existed) starts its window at the
 * first boot that reads it.
 */
export const workspaceDomainState = z.object({
  initialized: z.boolean(),
  workspaceIds: z.array(workspaceId),
  archivedSessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))).default([]),
  archivedAt: z.record(z.string(), z.string()).default({}),
  pendingMutation: workspacePendingMutation.optional(),
})

/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>

/**
 * The workspace domain spec: one `workspaces` table keyed by
 * {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
 * this through `ctx.storage.domain`; the spec object is the single source of
 * the domain's identity, version, and schemas.
 *
 * Version 2 covers {@link workspaceRecord} including the optional
 * `projectDir`: every field added since the version stamp is optional, so a
 * record written by an earlier build parses unchanged and needs no write-back.
 * The default `single` layout rejects any stored version other than this one
 * (`storage-json` and `storage-sqlite`), the domain layer has no migration
 * hook, and `compatibleVersions` is honored by `per-record` layouts only — so
 * an additive optional field must NOT bump the version, or every existing
 * installation would fail to open its own registry.
 */
export const workspaceDomainSpec = defineDomain({
  name: 'workspace',
  version: 2,
  global: {
    schema: workspaceDomainState,
    initial: { initialized: false, workspaceIds: [], archivedSessionIds: [], archivedAt: {} },
  },
  tables: { workspaces: domainTable<WorkspaceId, WorkspaceRecord>(workspaceRecord) },
})
