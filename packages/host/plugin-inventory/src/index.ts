/** Read-only projection of the current Cordis Loader plugin entries. */

import { readFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, FiberState } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Brand an existing Loader-tree entry id at the owning boundary. */
function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/**
 * Resolved package version per module specifier; a cached `undefined` records
 * an unresolvable specifier (virtual entries like `cordis:include`) so every
 * snapshot does not retry it.
 */
const versionCache = new Map<string, Promise<string | undefined>>()

/** Read the version of the package owning `entryUrl`, or undefined for bare builtins. */
async function versionOfEntryUrl(entryUrl: string): Promise<string | undefined> {
  let dir = dirname(fileURLToPath(entryUrl))
  const root = parse(dir).root
  while (dir !== root) {
    try {
      const manifest: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      if (
        typeof manifest === 'object' && manifest !== null && 'version' in manifest &&
        typeof (manifest as { version?: unknown }).version === 'string'
      ) return (manifest as { version: string }).version
    } catch {
      // No readable manifest at this level; keep walking toward the root.
    }
    dir = dirname(dir)
  }
  return undefined
}

/**
 * Read the version the resolved module's owning package declares. Resolution
 * goes through the Loader's own module graph (its base URL and Node-internal
 * resolver, matching how each entry imported at boot), so this answers for
 * everything the deployment actually loaded; the walk up from the entry file
 * stops at the first package manifest.
 */
function moduleVersion(ctx: Context, moduleName: string): Promise<string | undefined> {
  const cached = versionCache.get(moduleName)
  if (cached !== undefined) return cached
  const read = (async (): Promise<string | undefined> => {
    const internal = ctx.loader.internal
    const baseUrl = ctx.baseUrl
    try {
      if (internal !== undefined && baseUrl !== undefined) {
        // Node's module internals changed their resolver signature mid-24.x;
        // tag, not major, selects the call shape (see loader-shape.compat).
        const resolved = internal.version === 'v2'
          ? internal.resolveSync(baseUrl, { specifier: moduleName, attributes: {} })
          : internal.resolveSync(moduleName, baseUrl, {})
        return await versionOfEntryUrl(resolved.url)
      }
      return await versionOfEntryUrl(import.meta.resolve(moduleName))
    } catch {
      // `cordis:` builtins and other unresolvable specifiers carry no version.
      return undefined
    }
  })()
  versionCache.set(moduleName, read)
  return read
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  constructor(ctx: Context) {
    super(ctx, 'pluginInventory')
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with per-preset
   * compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const rows: (Omit<PluginInventoryEntry, 'version'> & { version?: string })[] = []
    for (const entry of this.ctx.loader.entries()) {
      if (entry.options.group) continue
      rows.push({
        entryId: pluginEntryId(entry.id),
        moduleName: entry.options.name,
        enabled: !entry.disabled,
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      })
    }
    const entries = await Promise.all(rows.map(async (row) => {
      const version = await moduleVersion(this.ctx, row.moduleName)
      return version === undefined ? row : { ...row, version }
    }))
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { entries }
    const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
      composition => ({
        ...composition,
        rows: composition.rows.map(({ fiberState, ...row }) => ({
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
        })),
      }),
    )
    return { entries, agentPresets }
  }
}

export default PluginInventoryGateway
