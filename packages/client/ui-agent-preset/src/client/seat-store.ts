/**
 * Creator-draft stage: which preset the NEXT session gets.
 *
 * The settings section's creator entry stages a pick with no session to
 * receive it yet, then starts one; the stage reaches the session when it
 * becomes current and is still blank — whether the workspace connect created
 * it or reused an existing blank one. The stage is forgotten once applied, so
 * the next new session starts from the deployment default again.
 *
 * The composer-surface chip this controller once fed is gone with the shell
 * rebuild: the session-page mode entry is ui-mode's selector alone (UI rework
 * 5.2 item 1), and a fresh session lands on the deployment default.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-agent-presets/types'

/** Stages the next session's preset and applies it when one appears. */
export class AgentPresetSeatController {
  /** Set while a pick is waiting for a session; cleared once applied. */
  private staged: string | undefined

  constructor(
    private readonly ctx: ClientContext,
    /** The session the flow is about to hand over to, when there is one. */
    private readonly currentSession: () => Pick<
      SessionSummary,
      'id' | 'blank' | 'projectionValues'
    > | undefined,
  ) {}

  /**
   * Stage one preset for the next session WITHOUT applying it — the flow that
   * made this pick starts the receiving session right after, so the apply
   * belongs to the list-change observer that fires once that session becomes
   * current.
   * @param id - the preset to stage.
   */
  stage(id: string): void {
    this.staged = id
  }

  /**
   * Hand the staged choice to the current session, if there is one to take it.
   *
   * Called by whoever observes the current session changing, because the
   * session may appear either before or after the pick. A refused switch is
   * consumed silently here: the composer chip that surfaced refusals is gone,
   * and the session's own mode display already shows what it runs.
   * @returns once the switch settled, or immediately when there is nothing to do.
   */
  async apply(): Promise<void> {
    const staged = this.staged
    if (staged === undefined) return
    const session = this.currentSession()
    if (session === undefined) return
    // A started session's history was produced under its own composition; the
    // host refuses the swap, so the stage is no longer meaningful.
    const running = presetOf(session)
    if (!session.blank || (running !== undefined && presetIdOf(running) === staged)) {
      this.staged = undefined
      return
    }
    await this.ctx.remote.agentPresets.select(session.id, staged)
    this.staged = undefined
  }
}

function presetOf(
  session: Pick<SessionSummary, 'projectionValues'> | undefined,
): string | undefined {
  const value = session?.projectionValues?.agentPreset
  return typeof value === 'string' ? value : undefined
}

/**
 * The bare preset id one projected identity names.
 *
 * A session composed from a project preset records the layer-qualified
 * identity `project:<projectDir>:<id>` (and `global:<id>` for a global one),
 * which no staged bare id equals. The id is the segment after the LAST colon,
 * because a Windows project directory carries a drive colon of its own; an
 * identity with no layer prefix is already a bare id. This mirrors the Host's
 * own rule (agent-presets `presetIdOf`).
 * @param identity - a preset id, or a layer-qualified preset identity.
 * @returns the preset's own id.
 */
function presetIdOf(identity: string): string {
  if (identity.startsWith('global:')) return identity.slice('global:'.length)
  if (identity.startsWith('project:')) {
    const rest = identity.slice('project:'.length)
    const at = rest.lastIndexOf(':')
    if (at > 0 && at < rest.length - 1) return rest.slice(at + 1)
  }
  return identity
}
