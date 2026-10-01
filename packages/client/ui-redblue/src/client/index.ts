/**
 * The red/blue prompt editors card: one `settings.general.item` row in
 * the System settings section, reading and writing the `rbcheck` settings
 * namespace through the settings Remote.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RedblueCard } from './RedblueCard.tsx'
import { en, zh, type RedblueLocaleKey } from './locales.ts'

export type { RedblueLocaleKey } from './locales.ts'
export type { RedblueCardProps } from './RedblueCard.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Red/blue prompt editor card copy. */
    'settings.redblue': RedblueLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.redblue'

/** The settings namespace this card edits. */
const RB_NS = 'rbcheck'

/** Required services: slot surfaces, locale, and the settings Remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/** Register the card's dictionary and its General-section row. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-redblue: dictionaries')

  const stringOf = (value: unknown): string => typeof value === 'string' ? value : ''
  const load = async (): Promise<{ redPrompt: string; bluePrompt: string }> => {
    const result = await ctx.remote.settings.describe()
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    const section = result.value.namespaces.find(namespace => namespace.ns === RB_NS)
    const value = (section?.value ?? {}) as { redPrompt?: unknown; bluePrompt?: unknown }
    return { redPrompt: stringOf(value.redPrompt), bluePrompt: stringOf(value.bluePrompt) }
  }
  const save = async (prompts: { redPrompt: string; bluePrompt: string }): Promise<string | undefined> => {
    const result = await ctx.remote.settings.update(RB_NS, prompts, undefined)
    if (result.ok) return undefined
    return `${result.error.message} (${result.error.code})`
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'redblue-prompts',
    order: 20,
    locale: NS,
    inject: () => ({ load, save }),
  }, RedblueCard))
}
