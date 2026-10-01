/**
 * The roundtable primary page (U6): one `settings.section` row over the
 * `roundtable` Remote, replacing the ui-pages placeholder for `roundtable`
 * (removed in the same change, per the 5.2-5 disposition rule) — plus the
 * `sidebar.section` entry that replaces the workspaces region with the
 * roundtable archive history while the page is open.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the standard workspaces/sessions hook shares this page receives
// for the deep table's continue-a-conversation picker, and the shell's
// 'sidebar.section' SlotMap merge the history column registers under.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-shell/client'
import type { RoundtableRoomView } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the table's configuration is declared by the Host package that
// owns it, and this page is the same package's public browser face.
import type { RoundtableTableConfig } from '@deepseek-ai/dsh-roundtable/types'
import { RoundtablePage, type RoundtableArchiveView, type RoundtableModelOption, type RoundtablePageProps, type RoundtableRosterView } from './RoundtablePage.tsx'
import { RoundtableHistory, type RoundtableHistoryProps, type RoundtableHistoryRow } from './RoundtableHistory.tsx'
import { en, zh, type RoundtableLocaleKey } from './locales.ts'

export type { RoundtableLocaleKey } from './locales.ts'
export type { RoundtablePageProps } from './RoundtablePage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Roundtable page copy. */
    'ui.roundtable': RoundtableLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ui.roundtable'

/** Required services: slot surfaces, locale, and the mounted Remote faces. */
export const inject = ['slots', 'locale', 'remote', 'remote.roundtable', 'remote.session']

/** Register the page's dictionary and its `roundtable` settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-roundtable: dictionaries')

  const t = ctx.locale.bind(NS)
  const unwrap = <T>(result: { ok: boolean; value?: T; error?: { code: string; message: string } }, call: string): T => {
    if (!result.ok) {
      throw new Error(`roundtable.${call} failed: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`)
    }
    return result.value as T
  }
  const load = async (): Promise<{
    rosters: RoundtableRosterView[]
    table: RoundtableTableConfig
    room: RoundtableRoomView
  }> => unwrap(await ctx.remote.roundtable.roster(), 'roster')
  const room = async (): Promise<RoundtableRoomView> =>
    unwrap(await ctx.remote.roundtable.room(), 'room')
  const open = async (
    config: RoundtableTableConfig,
    seed?: { sessionId: string; title: string },
  ): Promise<RoundtableRoomView> =>
    unwrap(await ctx.remote.roundtable.open(
      config.depth, config.rosterId, config.provider, config.model, seed,
    ), 'open')
  const saveRosters: RoundtablePageProps['saveRosters'] = async (rosters) => {
    unwrap(await ctx.remote.roundtable.saveRosters(rosters.map(roster => ({
      id: roster.id,
      name: roster.name,
      members: roster.members.map(member => ({ ...member })),
    }))), 'saveRosters')
  }
  const send = async (text: string): Promise<RoundtableRoomView> =>
    unwrap(await ctx.remote.roundtable.userMessage(text), 'userMessage').room
  const interrupt = async (): Promise<RoundtableRoomView> =>
    unwrap(await ctx.remote.roundtable.interrupt(), 'interrupt')
  const reset = async (): Promise<RoundtableRoomView> =>
    unwrap(await ctx.remote.roundtable.reset(), 'reset')
  /**
   * The same Host catalog the session model selectors read, flattened to the
   * `provider/model` routes the open-table setup offers. An unconfigured
   * deployment answers no groups, which the page renders as the "configure a
   * provider first" hint rather than an empty dropdown.
   */
  const models = async (): Promise<RoundtableModelOption[]> => {
    const catalog = unwrap(await ctx.remote.session.modelCatalog(), 'modelCatalog')
    return catalog.groups.flatMap(group => group.models.map(model => ({
      provider: group.id,
      model: model.id,
      providerName: group.name,
      modelName: model.name,
    })))
  }

  /**
   * Recent closed tables for the history column (see RoundtableHistory). The
   * declared `limit` is passed even though it is undefined: the Remote face
   * checks a call's arity against the declaration and rejects a short one, so
   * omitting it fails before the host's own default can apply.
   */
  const archiveList = async (): Promise<readonly RoundtableHistoryRow[]> =>
    unwrap(await ctx.remote.roundtable.archiveList(undefined), 'archiveList')
  /**
   * The live table's sidebar row source: the room snapshot plus the seatings
   * its row names. The `roster` read the setup screen already makes returns
   * both, so the column's interval stays one request per read.
   */
  const live: RoundtableHistoryProps['live'] = async () => {
    const value = await load()
    return { room: value.room, rosters: value.rosters }
  }
  /** One archived table, mapped to the page's read-only view. */
  const archiveRead = async (id: string): Promise<RoundtableArchiveView> => {
    const record = unwrap(await ctx.remote.roundtable.archiveRead(id), 'archiveRead') as {
      closedAt: string
      table: { depth: 'shallow' | 'deep'; rosterName: string; model: string; seed?: { title: string } }
      transcript: RoundtableArchiveView['transcript']
    }
    return {
      closedAt: record.closedAt,
      rosterName: record.table.rosterName,
      depth: record.table.depth,
      model: record.table.model,
      ...record.table.seed === undefined ? {} : { seedTitle: record.table.seed.title },
      transcript: record.transcript,
    }
  }

  /**
   * The shell chrome's primary action while this page is open: the shell
   * knows it is on the roundtable, not what restarting a table means, so it
   * emits `shell/new-roundtable` and this plugin decides. The revision is a
   * registrant-private observable the renderer binds as the page's
   * `useNewTable` seat, so the component subscribes to nothing itself.
   * Apply-scoped state, not a module store: one plugin instance, one table.
   */
  let newTableRevision = 0
  const newTableListeners = new Set<() => void>()
  const newTableSource: HostObservable<number> = {
    getSnapshot: () => newTableRevision,
    subscribe: (listener) => {
      newTableListeners.add(listener)
      return () => { newTableListeners.delete(listener) }
    },
  }
  ctx.effect(() => ctx.on('shell/new-roundtable', () => {
    newTableRevision += 1
    for (const listener of newTableListeners) listener()
  }), 'ui-roundtable: new-table signal')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'roundtable',
    order: 3,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ load, models, open, saveRosters, room, send, interrupt, reset, archiveRead, hooks: { newTable: newTableSource } }),
  }, RoundtablePage))

  // The history column: while the roundtable page is open, the shell's
  // sidebar renders this entry instead of the workspaces browser.
  ctx.slots.inject('sidebar.section', () => ctx.slots.register({
    name: 'sidebar.section',
    id: 'roundtable',
    order: 3,
    locale: NS,
    inject: () => ({ archiveList, live }),
  }, RoundtableHistory))
}
