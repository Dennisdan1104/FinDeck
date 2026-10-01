/** Plugins page body: user-managed plugin cards over the read-only inventory. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the 'settings.agentPreset' LocaleNamespaceMap merge, whose
// dictionaries the shipped-preset name resolution below reads.
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
// Inline-safe shared fold: shipped ids map to dictionary keys in one home.
import { presetDisplayText } from '@deepseek-ai/dsh-agent-presets/display'
import { PluginsPage, type PluginsPageInjected } from './PluginsPage.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginsPageInjected, PluginsPageProps } from './PluginsPage.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin inventory and user-managed plugin card copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote faces. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.pluginPatch']

/** Contribute the Plugins page body to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const list: PluginsPageInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  // Resolved per call over ui-agent-preset's dictionaries, so a language
  // switch re-resolves shipped names; user-authored metadata passes through.
  const agentPresetCopy = ctx.locale.bind('settings.agentPreset')
  const presetName: PluginsPageInjected['presetName'] = preset =>
    presetDisplayText(preset, agentPresetCopy).name
  const listPatch: PluginsPageInjected['listPatch'] = async () => {
    const result = await ctx.remote.pluginPatch.read()
    if (!result.ok) throw new Error(`pluginPatch.read failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const writePatch: PluginsPageInjected['writePatch'] = async (id, disabled) => {
    const result = await ctx.remote.pluginPatch.write({ id, disabled })
    if (!result.ok) throw new Error(`pluginPatch.write failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const injected = (): PluginsPageInjected => ({
    list, presetName, listPatch, writePatch,
  })

  // The body declares the system region's seat, so the configuration views
  // stack inside the disclosure it owns.
  ctx.slots.inject('settings.plugins.body', () => ctx.slots.register({
    name: 'settings.plugins.body',
    id: 'plugins-body',
    order: 0,
    locale: NS,
    inject: injected,
    children: { 'settings.plugins.system': { kind: 'list', scope: 'root' } },
  }, PluginsPage))
}
