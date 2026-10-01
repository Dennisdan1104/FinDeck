/**
 * Session modes are the agent-preset roster seen from inside a session: a
 * session starts in its composition preset's mode, and the user may switch the
 * mode in place — `/mode <preset>` or the composer's mode control — which
 * composes the agent from the target preset: its tools, skills, prompt
 * sections, persona, and sandbox rows replace the previous preset's from the
 * next step on. The session log is untouched, so history, context, and the
 * transcript survive the switch. The switch records `agent-preset/selected`,
 * the same durable fact a blank session's preset choice writes, so a resume
 * rebuilds the composition the session actually ran under. A work mode
 * additionally carries a flow declared in the preset's `preset.yml`; the
 * `mode:flow` prompt section tells the model the steps and the current one, and
 * the stable `flow_step` tool records the model's step declarations into the
 * session log. A session also carries a soft AI-cluster preference, off until
 * `/cluster on` turns it on; it forces nothing, it only makes the `mode:flow`
 * section prefer the `cluster_run` tool. The `mode` projection folds it all for
 * the client: the current mode, the declared step trail the step bar renders,
 * and the cluster preference.
 *
 * This plugin's own rows — the projection, the `mode:flow` section, the
 * `flow_step` tool, and the `/mode` and `/cluster` commands — sit in the host
 * composition, so they outlive every switch; the preset's rows are what a
 * switch replaces. `flow_step` errors outside a usable mode rather than
 * disappearing, and phase one is declarative only: no step enforces or gates
 * anything, the flow is visibility plus the model's own discipline.
 *
 * Agent Note:
 * - .agents/notes/implemented/feature/2026-09-05-r9-flow-system-phase-one.md
 * - .agents/notes/implemented/bug-fix/2026-09-11-mode-switch-recomposes-the-preset.md
 *
 * @module @deepseek-ai/dsh-mode
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mode': { kind: 'mode' } & ContextFormed
  }
}
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { AgentPreset, FlowStepCluster } from '@deepseek-ai/dsh-agent-presets'
import type { ModeProjection, ModeUnitState } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A switch recorded by a build that changed only the prompt-level mode:
     * log-only, non-surface, whole-value replace. Switching composes the agent
     * from the target preset and records `agent-preset/selected`; this member
     * stays declared because released logs carry it, and the `mode` projection
     * folds it so those sessions still show the mode they ran.
     */
    'mode/switched': { mode: string }
    /**
     * The model declared entering a flow step: log-only, non-surface. In a
     * work mode `step` is one of the flow's ids; in a free mode it is a
     * free-form label. Consecutive repeats of the current step fold away.
     */
    'mode/step': { step: string }
    /**
     * The session's AI-cluster preference took a new value: log-only,
     * non-surface, whole-value replace. The preference is soft — it makes the
     * `mode:flow` section prefer the `cluster_run` tool without requiring it.
     * Consecutive repeats of the current value fold away.
     */
    'mode/cluster': { enabled: boolean }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    modes: ModeController
  }
}

/** The model-facing step-declaration tool's name. */
export const FLOW_STEP = 'flow_step'

/**
 * One step's stated purpose as list continuation lines: the author's text is
 * arbitrary prose, so every line is indented to stay under its step entry.
 * @param prompt - the step's declared purpose.
 * @returns the prompt's lines, each indented to the entry's continuation level.
 */
function indentPrompt(prompt: string): string[] {
  return prompt.split('\n').map(line => `   ${line}`)
}

/**
 * The directive one cluster step carries, indented as a continuation line of
 * its entry: the step is the cluster's to run, and its own task text is what
 * the cluster receives.
 */
const CLUSTER_GUIDANCE = '   Run this step with the cluster_run tool: pass this step\'s task as its task argument.'

/** The cluster tool's name, as the model-facing section text states it. */
const CLUSTER_RUN = 'cluster_run'

/**
 * The permission every free-mode session carries: the cluster tool, when the
 * session's composition mounts it, is the model's to use or skip. It states a
 * capability the session may not have, so it is phrased conditionally.
 */
const CLUSTER_AVAILABILITY = `When the ${CLUSTER_RUN} tool is available in this session, you may use it on any task that benefits from several independent perspectives.`

/**
 * The guidance a session with the AI-cluster preference on carries in every
 * mode: a preference, not a requirement — a task with one reasonable pass must
 * not pay for a cluster call.
 */
const CLUSTER_PREFERENCE = `The user has turned the AI cluster on for this session: prefer the ${CLUSTER_RUN} tool for tasks that would benefit from several independent perspectives, but skip it when a single pass is enough.`

/**
 * The suffix a cluster step's line carries: the declared strategy when it
 * states one, otherwise the declared viewpoint count, otherwise the bare
 * declaration.
 * @param cluster - the step's cluster declaration.
 * @returns the suffix, beginning with the separator.
 */
function clusterSuffix(cluster: FlowStepCluster): string {
  if (cluster.strategy !== undefined) return ` · cluster: ${cluster.strategy}`
  if (cluster.perspectives !== undefined) {
    return ` · cluster: ${String(cluster.perspectives.length)} perspectives`
  }
  return ' · cluster'
}

const modeUnitStateSchema: ZodType<ModeUnitState> = zod.object({
  mode: zod.string().nullable(),
  steps: zod.array(zod.string()),
  cluster: zod.boolean(),
}).strict()

/** Wire payload schema of the `mode` projection. */
const modeProjectionSchema: ZodType<ModeProjection> = zod.object({
  mode: zod.string().nullable(),
  step: zod.string().nullable(),
  steps: zod.array(zod.string()),
  cluster: zod.boolean(),
})

/** Projection of the composition preset, in-session switches, declared steps, and the AI-cluster preference. */
export const modeProjectionDefinition = {
  key: 'mode',
  // Bumped for the added `cluster` field: persisted rows folded before it fail
  // the strict state schema, so a stale row is discarded and refolded from
  // `init`, where the preference defaults to off — its pre-cluster value.
  stateVersion: 2,
  stateSchema: modeUnitStateSchema,
  init: (header, _inheritedEventCount): ModeUnitState => ({
    mode: header.agentPreset ?? null,
    steps: [],
    cluster: false,
  }),
  apply: (state, event) => {
    if (event.type === 'agent-preset/selected') return { mode: event.data.agentPreset, steps: [], cluster: state.cluster }
    if (event.type === 'mode/switched') return { mode: event.data.mode, steps: [], cluster: state.cluster }
    if (event.type === 'mode/step') {
      // A repeated declaration of the current step is the model restating
      // where it is, not a transition; folding it away keeps the trail one
      // entry per real step.
      if (state.steps.at(-1) === event.data.step) return state
      return { mode: state.mode, steps: [...state.steps, event.data.step], cluster: state.cluster }
    }
    if (event.type === 'mode/cluster') {
      // Re-declaring the value already in force is not a change; folding it
      // away keeps the unit's state reference — and the change feed — quiet.
      if (state.cluster === event.data.enabled) return state
      return { mode: state.mode, steps: state.steps, cluster: event.data.enabled }
    }
    return state
  },
  wire: {
    viewSchema: modeProjectionSchema,
    view: (state) => {
      const step = state.steps.at(-1)
      return {
        mode: state.mode,
        step: step ?? null,
        steps: state.steps,
        cluster: state.cluster,
      }
    },
  },
} satisfies ProjectionDefinition<'mode', ModeUnitState>

/** What one switch-or-list request resolved. */
type ModeTarget = AgentPreset | 'ambiguous' | undefined

/**
 * Resolve one user-typed mode reference against the roster: an exact id, then
 * an exact display name, then a unique case-insensitive prefix of either.
 * @param presets - the roster rows, in roster order.
 * @param input - the trimmed user input naming a mode.
 * @returns the one preset, `'ambiguous'` when a prefix matches several, or
 * undefined when nothing matches.
 */
function resolveModeTarget(presets: readonly AgentPreset[], input: string): ModeTarget {
  const byId = presets.find(preset => preset.id === input)
  if (byId !== undefined) return byId
  const byName = presets.find(preset => preset.name === input)
  if (byName !== undefined) return byName
  const lowered = input.toLowerCase()
  const prefixed = presets.filter(preset =>
    preset.id.toLowerCase().startsWith(lowered)
    || preset.name?.toLowerCase().startsWith(lowered) === true)
  if (prefixed.length === 1) return prefixed[0]
  return prefixed.length > 1 ? 'ambiguous' : undefined
}

/** One roster row rendered for a command listing. */
function rosterLine(preset: AgentPreset): string {
  const kind = preset.modeKind === 'work' ? '工作模式' : '自由模式'
  return `- ${preset.id} · ${preset.name ?? preset.id}（${kind}）`
}

/**
 * `ctx.modes`: owns the `mode` projection, the in-session mode switch, the
 * `mode:flow` prompt section, the stable `flow_step` tool, and the `/mode`
 * command. Client carriers expose the projection's `{ mode, step, steps }`
 * view; the roster itself stays on `ctx.agentPresets`.
 */
export class ModeController extends Service {
  static inject = ['tools', 'systemPrompt', 'sessionProjections', 'agentPresets']

  /**
   * Roster rows this service has resolved, keyed by preset id. The flow
   * section reads this synchronously at assembly time; the switch path and
   * agent creation refresh it. A row absent here renders no section until the
   * next refresh populates it.
   */
  private readonly presets = new Map<string, AgentPreset>()

  constructor(ctx: Context) {
    super(ctx, 'modes')

    ctx.sessionProjections.register(modeProjectionDefinition)

    // Advisory, not fatal. `agent/created` is serial and awaited, and a
    // rejecting listener fails creation — but repairing a session composed
    // under a mode it no longer runs must never cost it its agent. Awaiting the
    // repair lets it land before the first assembly, and the internal catch
    // swallows its failure so creation always proceeds. A failed repair leaves
    // the composition it was created with — the log still names the mode, and
    // the next switch composes the right one.
    ctx.on('agent/created', async ({ agent }) => {
      try {
        await this.applyLoggedMode(agent)
      } catch (error: unknown) {
        ctx.logger.warn(`dsh-mode: failed to apply the logged mode for agent "${agent.id}": ${String(error)}`)
      }
    })

    ctx.systemPrompt.section({
      name: 'mode:flow',
      order: ctx.systemPrompt.getSectionOrder('MODE_FLOW'),
      text: (context) => {
        const agent = context.agent
        return agent === undefined ? '' : this.flowSectionText(agent)
      },
    })

    ctx.tools.register(defineTool({
      name: FLOW_STEP,
      description: 'Declare that you are beginning a flow step. In a work mode, pass the step id from the flow listed in your instructions; in a free mode, pass a short label for the piece of work you are starting. The declaration updates the user\'s progress view; it does not interrupt your work.',
      parameters: {
        step: {
          type: 'string',
          required: true,
          description: 'The flow step id (work mode) or a short work label (free mode).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            step: { type: 'string', required: true },
            label: { type: 'string' },
            /** The declared step model in a work mode; absent in a free mode. */
            model: { type: 'string' },
            /** Model mismatch warning for a concrete step model; see execute. */
            advisory: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: value.advisory !== undefined
              ? `Entered step: ${value.label ?? value.step} (model: ${value.model ?? value.step})\n${value.advisory}`
              : `Entered step: ${value.label ?? value.step}${value.model === undefined ? '' : ` (model: ${value.model})`}`,
          },
        ],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) {
          throw new Error('flow_step requires a calling agent (no session mode to update)')
        }
        const step = args.step.trim()
        if (step === '') throw new Error('flow_step requires a non-empty step')
        const state = this.modeState(agent.session)
        const mode = state.mode
        if (mode === null) {
          throw new Error('flow_step requires a session mode; this deployment composes no agent presets')
        }
        // A fresh roster read, not the section cache: the flow a declaration is
        // validated against is the one the preset declares now.
        const preset = await this.resolveFreshMode(mode)
        if (preset === undefined) {
          throw new Error(`the session's mode preset "${mode}" is no longer on the roster`)
        }
        let label: string | undefined
        let stepModel: string | undefined
        let advisory: string | undefined
        if (preset.modeKind === 'work') {
          const flow = preset.flow
          const found = flow?.steps.find(entry => entry.id === step)
          if (flow === undefined || found === undefined) {
            /* v8 ignore next -- discovery sets modeKind 'work' only for a row whose preset declares a valid flow */
            const ids = flow?.steps.map(entry => entry.id).join(', ') ?? '(none)'
            throw new Error(`step "${step}" is not in this flow; the step ids are: ${ids}`)
          }
          label = found.label
          stepModel = found.model
          // A concrete step model is a real constraint: the step runs best on
          // it, the session may run on another. Advisory only — the model (or
          // the user) decides whether to switch before continuing.
          const currentModel = agent.options.model
          if (stepModel !== 'default' && currentModel !== undefined) {
            const current = agent.options.provider === undefined
              ? currentModel
              : `${agent.options.provider}/${currentModel}`
            if (current !== stepModel) {
              advisory = `This step declares model ${stepModel} but the session model is ${current}; switch the session model before continuing if this step requires it.`
            }
          }
        }
        // Idempotent on the current step: restating where the model already is
        // must not extend the trail.
        if (state.steps.at(-1) !== step) agent.session.append('mode/step', { step })
        return {
          step,
          ...label === undefined ? {} : { label },
          ...stepModel === undefined ? {} : { model: stepModel },
          ...advisory === undefined ? {} : { advisory },
        }
      },
      presentCall: args => ({
        card: 'generic',
        title: typeof args.step === 'string' && args.step !== '' ? args.step : FLOW_STEP,
        kind: 'other',
      }),
    }))

    // The command child activates only when a command registry is composed.
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-mode'),
        name: 'mode',
        description: 'Switch this session to another preset (composition and flow)',
        input: { hint: '[<preset id or name>]' },
        handler: ({ agent, rawInput }) => this.executeModeCommand(agent, rawInput),
      })
      commandCtx.commands.register({
        definitionId: CommandDefinitionId('@deepseek-ai/dsh-mode'),
        name: 'cluster',
        description: 'Turn this session\'s AI-cluster preference on or off',
        input: { hint: '[on|off]' },
        handler: ({ agent, rawInput }) => this.executeClusterCommand(agent, rawInput),
      })
    })
  }

  /**
   * Turn this session's AI-cluster preference on or off.
   *
   * The preference is soft: it only makes the `mode:flow` section encourage the
   * `cluster_run` tool, and it stays in force across mode switches. Idempotent —
   * setting the value already in force writes no event, so repeated `/cluster`
   * invocations never grow the log.
   * @param session - the session whose preference changes.
   * @param enabled - the preference's new value.
   */
  setCluster(session: Session, enabled: boolean): void {
    if (this.modeState(session).cluster === enabled) return
    session.append('mode/cluster', { enabled })
  }

  /** Read the required mode projection state or fail at the first service access. */
  private modeState(session: Session): ModeUnitState {
    const state = this.ctx.sessionProjections.stateOf(session, 'mode')
    if (state === undefined) throw new Error('dsh-mode requires the mode session projection')
    return state
  }

  /**
   * Resolve one preset by id through a fresh roster read, caching the row for
   * the synchronous flow-section read.
   * @param id - the preset id.
   * @returns the roster row, or undefined when no root supplies it.
   */
  private async resolveFreshMode(id: string): Promise<AgentPreset | undefined> {
    const found = (await this.ctx.agentPresets.list()).find(preset => preset.id === id)
    if (found !== undefined) this.presets.set(id, found)
    return found
  }

  /**
   * The `mode:flow` section text for one agent: the work flow with its current
   * step, the free-mode declaration guidance, or nothing when no mode is in
   * force or the mode's roster row has not been resolved yet. A session whose
   * AI-cluster preference is on ends either form with the cluster guidance;
   * a free mode always states that the cluster tool is the model's to use.
   * @param agent - the agent the assembly belongs to.
   * @returns the section text, or '' to drop the section.
   */
  private flowSectionText(agent: Agent): string {
    const state = this.modeState(agent.session)
    const mode = state.mode
    if (mode === null) return ''
    const preset = this.presets.get(mode)
    if (preset === undefined) return ''
    const lines: string[] = []
    if (preset.modeKind === 'work' && preset.flow !== undefined) {
      const flow = preset.flow
      const current = state.steps.at(-1)
      const [first] = flow.steps
      const currentLine = current === undefined
        ? `No step has been declared yet. Begin with step 1, ${first?.label} (${first?.id}).`
        : `Current step: ${this.stepLabel(flow, current)} (${current}) — step ${String(this.stepIndex(flow, current))} of ${String(flow.steps.length)}.`
      lines.push(
        'You are running inside a multi-step workflow. The flow, in order:',
        ...flow.steps.flatMap((step, index) => [
          `${String(index + 1)}. ${step.label} (${step.id})${step.model === 'default' ? '' : ` · model: ${step.model}`}${step.cluster === undefined ? '' : clusterSuffix(step.cluster)}`,
          ...step.prompt === undefined ? [] : indentPrompt(step.prompt),
          ...step.cluster === undefined ? [] : [CLUSTER_GUIDANCE],
        ]),
        currentLine,
        `Call the ${FLOW_STEP} tool with a step id each time you BEGIN a step, including the first. A step that declares a concrete model must run on that model: switch the session model before the step when it differs; the declaration only updates the user's progress view; it does not interrupt your work. A step's stated purpose says what that step does; it adds to these instructions rather than replacing any of them.`,
      )
    } else {
      lines.push(
        'This session runs in free-form mode: no fixed flow is in force.',
        `You may call the ${FLOW_STEP} tool with a short label whenever you begin a distinct piece of work; the user sees the labels as your progress trail. Skip it for trivial replies.`,
        CLUSTER_AVAILABILITY,
      )
    }
    if (state.cluster) lines.push(CLUSTER_PREFERENCE)
    return lines.join('\n')
  }

  /** A flow step's label, or its id when the trail names one the flow no longer has. */
  private stepLabel(flow: { steps: readonly { id: string; label: string }[] }, id: string): string {
    return flow.steps.find(step => step.id === id)?.label ?? id
  }

  /** A flow step's 1-based position, or 0 when the trail names an unknown id. */
  private stepIndex(flow: { steps: readonly { id: string }[] }, id: string): number {
    const index = flow.steps.findIndex(step => step.id === id)
    return index === -1 ? 0 : index + 1
  }

  /**
   * Make a freshly created or resumed agent match the mode its log names.
   *
   * A session composed by this build runs the preset it recorded, so the check
   * normally returns at once. It does not for a session whose log carries only
   * `mode/switched` — a switch written when a mode change touched the prompt
   * alone — and the honest repair is the composition switch that log
   * describes. Failures are the caller's to contain (agent creation must not
   * veto), and the mode row is cached either way so the flow section can render
   * from the next assembly.
   * @param agent - the agent just published with its live session.
   */
  private async applyLoggedMode(agent: Agent): Promise<void> {
    const mode = this.modeState(agent.session).mode
    if (mode === null) return
    const preset = await this.resolveFreshMode(mode)
    if (preset === undefined) {
      this.ctx.logger.warn(`dsh-mode: mode "${mode}" logged for agent "${agent.id}" is no longer on the roster`)
      return
    }
    if (mode === this.ctx.agentPresets.composedPreset(agent.ctx)) return
    await this.ctx.agentPresets.recompose(agent.ctx, preset.id)
  }

  /**
   * Switch one agent's session onto another preset: compose the agent from it,
   * then record what it runs, then notice.
   *
   * The composition moves before anything is durable, so a preset that cannot
   * mount refuses the whole switch with the agent still on its previous
   * composition. `agent-preset/selected` is the same fact a blank session's
   * preset choice writes, which is what makes a resume rebuild this
   * composition instead of the creation header's.
   * @param agent - the agent whose session switches.
   * @param preset - the roster row to switch onto.
   * @throws when the preset is unknown or its composition cannot be mounted.
   */
  async switch(agent: Agent, preset: AgentPreset): Promise<void> {
    const previous = this.ctx.agentPresets.composedPreset(agent.ctx)
    await this.ctx.agentPresets.recompose(agent.ctx, preset.id)
    // What the log records is the composition actually installed: a bare id
    // composes the layer the agent's own working directory supplies, and a
    // project-layer preset records its qualified identity so a resume rebuilds
    // that layer rather than the global one.
    const composed = this.ctx.agentPresets.composedPreset(agent.ctx) ?? preset.id
    try {
      agent.session.append('agent-preset/selected', { agentPreset: composed })
    } catch (error: unknown) {
      // The log is what a resume rebuilds the composition from, so a switch it
      // cannot record goes back rather than leave the two disagreeing.
      if (previous !== undefined) await this.ctx.agentPresets.recompose(agent.ctx, previous)
      throw error
    }
    this.presets.set(preset.id, preset)
    const summary = `已切换到 ${preset.name ?? preset.id}`
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: summary }],
      source: { kind: 'mode', form: 'notice', summary },
    }))
  }

  /**
   * Execute one `/mode` invocation: list the roster with the current mode, or
   * switch onto the named preset.
   * @param agent - the agent whose session the command addresses.
   * @param rawInput - the text after the command name.
   * @returns the command result for the invoking surface.
   */
  private async executeModeCommand(agent: Agent, rawInput: string): Promise<CommandResult> {
    const presets = (await this.ctx.agentPresets.list()).filter(preset => preset.broken === undefined)
    for (const preset of presets) this.presets.set(preset.id, preset)
    const input = rawInput.trim()
    const current = this.modeState(agent.session).mode
    if (presets.length === 0) {
      return { kind: 'error', text: 'No agent presets are available to switch to.' }
    }
    if (input === '') {
      const currentLine = current === null
        ? '当前没有已命名模式（本部署未组合 agent presets）。'
        : `当前模式：${this.displayName(presets, current)} (${current})`
      return {
        kind: 'success',
        text: [
          currentLine,
          '可切换：',
          ...presets.map(rosterLine),
          '',
          'Usage: /mode <preset id or name>',
        ].join('\n'),
      }
    }
    const target = resolveModeTarget(presets, input)
    if (target === 'ambiguous') {
      return { kind: 'error', text: `"${input}" matches more than one mode; use the full id or name.` }
    }
    if (target === undefined) {
      /* v8 ignore next 4 -- the presets.length === 0 early return makes the joined list non-empty */
      return {
        kind: 'error',
        text: `No mode matches "${input}". Available: ${presets.map(preset => preset.id).join(', ') || '(none)'}`,
      }
    }
    if (target.id === current) {
      return { kind: 'success', text: `当前已是 ${target.name ?? target.id}。` }
    }
    try {
      await this.switch(agent, target)
    } catch (error: unknown) {
      // A composition that cannot mount is the one new failure mode of a
      // switch; the user reads why here instead of the command dying on it.
      return {
        kind: 'error',
        text: `切换到 ${target.name ?? target.id} 失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
    return { kind: 'success', text: `已切换到 ${target.name ?? target.id}。` }
  }

  /**
   * Execute one `/cluster` invocation: toggle the session's AI-cluster
   * preference, or set it explicitly with `on` / `off`.
   * @param agent - the agent whose session the command addresses.
   * @param rawInput - the text after the command name.
   * @returns the command result for the invoking surface.
   */
  private executeClusterCommand(agent: Agent, rawInput: string): CommandResult {
    const input = rawInput.trim().toLowerCase()
    const current = this.modeState(agent.session).cluster
    let target: boolean
    if (input === '') target = !current
    else if (input === 'on') target = true
    else if (input === 'off') target = false
    else return { kind: 'error', text: `"${rawInput.trim()}" is not a cluster setting; use /cluster, /cluster on, or /cluster off.` }
    if (target === current) {
      return { kind: 'success', text: current ? '本会话已开启 AI 集群偏好。' : '本会话的 AI 集群偏好已是关闭状态。' }
    }
    this.setCluster(agent.session, target)
    return {
      kind: 'success',
      text: target
        ? '已为本会话开启 AI 集群偏好：任务受益于多个独立视角时，模型会优先使用 cluster_run。'
        : '已关闭本会话的 AI 集群偏好。',
    }
  }

  /** The display name of one preset id, or the id when the roster no longer lists it. */
  private displayName(presets: readonly AgentPreset[], id: string): string {
    return presets.find(preset => preset.id === id)?.name ?? id
  }
}

export default ModeController
