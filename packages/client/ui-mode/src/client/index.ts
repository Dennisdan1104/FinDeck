/**
 * Session-mode UI plugin, browser half: the composer's `conversation.input.mode`
 * seat (a mode selector over the roster, switching through the `/mode` command
 * channel so the dropdown and the slash command are one action, plus the
 * free-mode AI-cluster toggle, which sets the session preference through the
 * `/cluster` command channel), the title bar's bare `conversation.session.header.mode`
 * selector, and the `conversation.session.flow` strip (work-mode step progress
 * or the free-mode trail, both read from the host-computed `mode` projection —
 * zero client-side mode state). A pick the composed skill-forge intake claims
 * opens that flow's own session picker instead of switching the mode.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.remote merge (agentPresets.list, commands.execute).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the two seats).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `mode` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-mode/client'
// Type-only: pulls the optional `skillForge` service declaration a mode pick consults.
import type {} from '@deepseek-ai/dsh-client-ui-settings-skills/client'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ModeSelect, ComposerModeSelect } from './ModeSelect.tsx'
import { FlowBar } from './FlowBar.tsx'
import { en, zh, type ModeUiKey } from './locales.ts'

export type { ModeUiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The mode control and flow strip's copy. */
    mode: ModeUiKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'mode'

/** The roster, or the message to show in its place. */
export type RosterRead = { ok: true; value: AgentPresetRoster } | { ok: false; error: string }

/** Injected business face shared by the two seats. */
export interface ModeUiInjected {
  /**
   * Read the roster once per surface.
   * @param cwd - the working directory whose project layer to include; absent
   *   reads the deployment-wide global layer alone.
   * @returns the roster rows, or the failure message.
   */
  loadRoster: (cwd?: string) => Promise<RosterRead>
  /**
   * Switch the session onto another mode by executing `/mode <id>` — the same
   * action the slash command performs.
   * @param sessionId - the session to switch.
   * @param id - the target preset id.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  switchMode: (sessionId: SessionId, id: string) => Promise<string | null>
  /**
   * Set the session's AI-cluster preference by executing `/cluster on` or
   * `/cluster off` — the same action the slash command performs.
   * @param sessionId - the session whose preference to set.
   * @param enabled - true to turn the session's cluster on, false to turn it off.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  setCluster: (sessionId: SessionId, enabled: boolean) => Promise<string | null>
  /**
   * Offer one roster pick to the composed skill-forge intake, whose mode is
   * served by its own session picker rather than by switching this session.
   * @param id - the preset id the user picked.
   * @returns true when the intake took the pick; the caller then switches nothing.
   */
  openForge: (id: string) => boolean
}

/** Required services: the slot registry, the Remotes (presets roster + command channel), and the locale registry. */
export const inject = ['slots', 'remote', 'remote.agentPresets', 'remote.commands', 'locale']

/**
 * Client plugin body: register the mode selector and the flow strip.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-mode: dictionaries')

  /** The shared business face both seats receive. */
  const injected = (): ModeUiInjected => ({
    loadRoster: async (cwd) => {
      // A working directory names the project layer, so the roster carries the
      // project's own presets beside the global ones (each row marked with the
      // layer it came from). Without one, the deployment-wide read is issued.
      const result = cwd === undefined
        ? await ctx.remote.agentPresets.list()
        : await ctx.remote.agentPresets.rosterFor({ cwd })
      if (result.ok) return { ok: true, value: result.value }
      // Agent presets are optional: without the service every session uses the
      // host composition, and both seats render nothing.
      if (result.error.code === 'gateway/invocation-unavailable') {
        return { ok: true, value: { presets: [], authorable: false } }
      }
      return { ok: false, error: result.error.message }
    },
    switchMode: async (sessionId, id) => {
      const result = await ctx.remote.commands.execute(sessionId, `/mode ${id}`, [])
      if (!result.ok) return `${result.error.message} (${result.error.code})`
      if (result.value === undefined) return `unknown command: /mode ${id}`
      if (result.value.result.kind === 'error') return result.value.result.text
      return null
    },
    setCluster: async (sessionId, enabled) => {
      const line = `/cluster ${enabled ? 'on' : 'off'}`
      const result = await ctx.remote.commands.execute(sessionId, line, [])
      if (!result.ok) return `${result.error.message} (${result.error.code})`
      if (result.value === undefined) return `unknown command: ${line}`
      if (result.value.result.kind === 'error') return result.value.result.text
      return null
    },
    // Optional service: a deployment composing no skills page has no intake, and
    // every pick then switches the session as before.
    openForge: (id) => ctx.get('skillForge')?.openFor(id) === true,
  })

  ctx.slots.inject('conversation.input.mode', () => ctx.slots.register({
    name: 'conversation.input.mode',
    locale: NS,
    inject: (): ModeUiInjected => injected(),
  }, ComposerModeSelect))

  // The title bar's mode selector: the same component and injected face as the
  // composer seat — both show the projection, both switch through /mode. The
  // AI-cluster toggle stays with the composer seat, so this one is bare.
  ctx.slots.inject('conversation.session.header.mode', () => ctx.slots.register({
    name: 'conversation.session.header.mode',
    locale: NS,
    inject: (): ModeUiInjected => injected(),
  }, ModeSelect))

  ctx.slots.inject('conversation.session.flow', () => ctx.slots.register({
    name: 'conversation.session.flow',
    locale: NS,
    inject: (): ModeUiInjected => injected(),
  }, FlowBar))
}

/** One roster row as the seats render it, re-exported for the spec benches. */
export type { ModeRow } from './ModeSelect.tsx'
