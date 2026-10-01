/**
 * Model-facing `web_search` and `web_fetch` tools over `ctx.web`. This package owns schemas,
 * validation, prompt guidance, limits, and presentation, never concrete providers. Enablement
 * controls tool registration; an enabled tool remains visible when its provider is unavailable
 * and fails with a structured error at execution time. Every field is also a `tool-web` settings
 * namespace, and a committed change re-registers the tools from the newly resolved section.
 * @module @deepseek-ai/dsh-tool-web
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import { applyWebSearchTool, WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from './search.ts'
import { applyWebFetchTool } from './fetch.ts'

export { WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS, applyWebSearchTool, formatSearchOutput, presentSearchCall, presentSearchResult, searchMetaFromValue, searchMetaFromResult } from './search.ts'
export type { WebSearchMeta } from './search.ts'
export { applyWebFetchTool, formatFetchOutput, parseFetchArgs, presentFetchCall, presentFetchResult, fetchMetaFromValue, fetchMetaFromResult } from './fetch.ts'
export type { WebFetchMeta } from './fetch.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-web'

/** Services required by the web tool suite. */
export const inject = ['tools', 'web', 'systemPrompt']

/** Default cooperative tool-call timeout budget (ms) for the web tools. */
export const DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000

/**
 * Default cap on one `web_fetch` output and on source characters converted
 * synchronously. This leaves headroom above the local provider's default
 * 100,000-character body cap while bounding custom providers and rendered output.
 */
export const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 200_000

/** Plugin config: which web tools to register, search bounds, per-tool budgets, and the fetch output cap. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  searchMaxResults?: number
  /** Upper bound on queries accepted by one `web_search` call. */
  searchMaxQueries?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  fetchMaxOutputChars?: number
}

export const Config: z<Config> = z.object({
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
  searchMaxResults: z.number().default(WEB_SEARCH_MAX_RESULTS),
  searchMaxQueries: z.number().default(WEB_SEARCH_MAX_QUERIES),
  fetchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  searchTimeoutMs: z.number().default(DEFAULT_WEB_TOOL_TIMEOUT_MS),
  fetchMaxOutputChars: z.number().default(DEFAULT_FETCH_MAX_OUTPUT_CHARS),
})

/** Complete config after schemastery applies every field default. */
type ResolvedConfig = Required<Config>

/** Settings namespace carrying which web tools are registered and their bounds. */
export const TOOL_WEB_SETTINGS_NAMESPACE = 'tool-web'

/** Configured count, timeout, and character caps must be positive integers. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-web: ${name} must be a positive integer`)
  }
}

/** Reject a section holding a bound these tools could not act on. */
function assertResolvedConfig(config: ResolvedConfig): void {
  assertPositiveInteger('searchMaxResults', config.searchMaxResults)
  assertPositiveInteger('searchMaxQueries', config.searchMaxQueries)
  assertPositiveInteger('fetchTimeoutMs', config.fetchTimeoutMs)
  assertPositiveInteger('searchTimeoutMs', config.searchTimeoutMs)
  assertPositiveInteger('fetchMaxOutputChars', config.fetchMaxOutputChars)
}

/**
 * Register the enabled web tools. `search`/`fetch` default to true; a product
 * that wants only one disables the other in config. Each tool's cooperative
 * timeout budget (`fetchTimeoutMs`/`searchTimeoutMs`, default 30000) is resolved
 * here and attached to the tool as `ToolDefinition.timeoutMs` for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 *
 * The same fields are registered as the `tool-web` settings namespace. Every
 * value this package consumes reaches a tool schema description, a prompt
 * section, or an output cap fixed at registration, so a committed change
 * re-registers the tools from the newly resolved section rather than mutating
 * captions the model may already have read.
 *
 * @param ctx - context whose tool and system-prompt registries receive the registrations.
 * @param config - the composition entry serving as the base layer and the fallback.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let disposers: (() => void)[] = []
  const unregister = (): void => {
    for (const dispose of disposers.splice(0)) dispose()
  }
  const register = (): void => {
    // schemastery (Config) has already filled every defaulted field.
    const resolved = current() as ResolvedConfig
    assertResolvedConfig(resolved)
    unregister()
    const next: (() => void)[] = []
    if (resolved.search) {
      next.push(applyWebSearchTool(
        ctx, resolved.searchMaxResults, resolved.searchMaxQueries, resolved.searchTimeoutMs, resolved.fetch,
      ))
    }
    if (resolved.fetch) next.push(applyWebFetchTool(ctx, resolved.fetchTimeoutMs, resolved.fetchMaxOutputChars))
    disposers = next
  }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, TOOL_WEB_SETTINGS_NAMESPACE, Config, config, {
      validate: (value) => { assertResolvedConfig(value as ResolvedConfig) },
      setSource: (source) => { current = source },
      onChange: () => { register() },
    })
  })
  register()
  ctx.effect(() => () => { unregister() }, 'tool-web: tool registrations')
}
