/**
 * The asset-hub primary page: one `settings.section` row over the
 * `assetOverview` Remote namespace. The assets tab reads the v2
 * `assetLibrary()` snapshot, a face detail view runs verbs through the bridge,
 * and the page can hand one asset to a fresh AI session.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the `ctx.sessions` merge the hand-off entry drives.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  AssetFaceResult, AssetLibrary, AssetOverview,
} from '@deepseek-ai/dsh-api-remotes/client'
import { AssetsPage, type AssetsPageProps } from './AssetsPage.tsx'
import { en, zh, type AssetsLocaleKey } from './locales.ts'

export type { AssetsLocaleKey } from './locales.ts'
export type { AssetsPageProps } from './AssetsPage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Asset-hub page copy. */
    'ui.assets': AssetsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui.assets'

/** Required services: slot surfaces, locale, the sessions domain, and the mounted Remote faces. */
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.assetOverview', 'remote.agentPresets']

/** Register the page's dictionary and its `research-assets` settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-assets: dictionaries')

  const t = ctx.locale.bind(NS)
  const loadLibrary = async (): Promise<AssetLibrary> => {
    const result = await ctx.remote.assetOverview.assetLibrary()
    if (!result.ok) {
      throw new Error(`assetOverview.assetLibrary failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const loadOverview = async (): Promise<AssetOverview> => {
    const result = await ctx.remote.assetOverview.overview()
    if (!result.ok) {
      throw new Error(`assetOverview.overview failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const loadFace = async (asset: string, version?: number): Promise<AssetFaceResult> => {
    const result = await ctx.remote.assetOverview.assetFace({ asset, ...version === undefined ? {} : { version } })
    if (!result.ok) {
      throw new Error(`${result.error.message} (${result.error.code})`)
    }
    return result.value
  }
  const loadFile = async (asset: string, version: number, path: string): Promise<string> => {
    const result = await ctx.remote.assetOverview.assetFile({ asset, version, path })
    if (!result.ok) {
      throw new Error(`${result.error.message} (${result.error.code})`)
    }
    return result.value.content
  }
  /**
   * Forward one verb request and report the protocol's own answer. A transport
   * failure is folded into the protocol's error branch, so the renderer keeps
   * reading `status` as the only verdict (verb-bridge.md §2).
   */
  const runVerb: AssetsPageProps['runVerb'] = async (request) => {
    const result = await ctx.remote.assetOverview.runVerb(request)
    if (result.ok) return result.value
    return {
      status: 'error',
      asset: request.asset,
      version: request.version ?? null,
      verb: request.verb,
      duration_s: 0,
      error: `${result.error.message} (${result.error.code})`,
    }
  }
  /**
   * Hand one asset to a fresh session: the host's seed text (asset name, version
   * directory, manifest, lineage, verbs) becomes the session's first prompt, so
   * the agent it starts drives the very asset the user was looking at. Opening
   * the session is also what leaves this page — the shell returns to the
   * conversation for a changed current session.
   */
  const askAi = async (asset: string): Promise<void> => {
    const brief = await ctx.remote.assetOverview.assetBrief({ asset })
    if (!brief.ok) {
      throw new Error(`${brief.error.message} (${brief.error.code})`)
    }
    const sessionId = await ctx.sessions.create({})
    ctx.sessions.open(sessionId)
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined) {
      throw new Error('the new session is not addressable yet')
    }
    const submission = session.beginSubmission({ mode: 'queue', text: brief.value.seed, attachments: [] })
    const result = await session.prompt(
      [{ type: 'text', text: brief.value.seed }],
      'queue',
      undefined,
      submission.requestId,
    )
    if (!result.ok) {
      submission.abandon()
      throw new Error(`${result.error.message} (${result.error.code})`)
    }
  }

  const saveFlow: AssetsPageProps['saveFlow'] = async (request) => {
    const result = await ctx.remote.agentPresets.savePreset(request)
    if (result.ok) return undefined
    return `${result.error.message} (${result.error.code})`
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'research-assets',
    order: 1,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ loadLibrary, loadOverview, loadFace, runVerb, loadFile, askAi, saveFlow }),
  }, AssetsPage))
}
