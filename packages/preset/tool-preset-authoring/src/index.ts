/**
 * Model-facing mode authoring: list the roster, then create or rewrite one
 * mode's display text and flow.
 *
 * A mode is a preset's authorable half — its name, description, and the flow
 * steps a work mode runs — and the composition beside it (which plugins the
 * session mounts) is never part of this seam. Creating a mode copies an
 * existing preset's whole directory and then replaces only that half, so the
 * tools grant no capability the roster did not already carry.
 *
 * The tools exist because a mode authored by hand-writing `preset.yml` has no
 * validation and no feedback: a step id that is not kebab-case, a model that
 * is neither `default` nor a `provider/model` route, or a work declaration
 * with no steps each produces a preset discovery reports as broken. Every
 * write here passes through the same validation discovery applies, so a mode
 * these tools store always composes.
 *
 * @module @deepseek-ai/dsh-tool-preset-authoring
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AgentPreset, AgentPresetStep, AgentPresetWriteRequest, FlowStepCluster, PresetModeKind,
} from '@deepseek-ai/dsh-agent-presets'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-preset-authoring'
export const inject = ['tools', 'agentPresets']

/**
 * A step's cluster declaration as a read-back view carries it: the imported
 * {@link FlowStepCluster} contract with its viewpoint list writable, which is
 * what the schema DSL infers an array-of-strings property as.
 */
type StepClusterView = {
  -readonly [K in keyof FlowStepCluster]:
    Exclude<FlowStepCluster[K], undefined> extends readonly string[]
      ? string[]
      : Exclude<FlowStepCluster[K], undefined>
}

/** One step as the tools read it back from the roster. */
interface StepView {
  id: string
  label: string
  model: string
  prompt?: string
  cluster?: StepClusterView
}

/**
 * The `cluster` property every mode schema states: the viewpoints and
 * combining strategy of a step the AI cluster runs. Shared so the write
 * parameters and both read-back views declare the same field.
 */
const CLUSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Declares that the AI cluster runs this step: several parallel subagents take it from the stated viewpoints and their results are combined. Omit to run the step on the session model as before.',
  properties: {
    perspectives: {
      type: 'array',
      items: { type: 'string' },
      description: 'One sentence per member viewpoint, 2 to 8 of them; absent uses cluster_run\'s default panel.',
    },
    strategy: {
      type: 'string',
      enum: ['synthesize', 'vote'],
      description: 'How the members\' results are combined: synthesize for one combined conclusion, vote for the majority conclusion. Absent means synthesize.',
    },
  },
} as const

/** Register `mode_list` and `mode_write`. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'mode_list',
    description: 'List the session modes this deployment offers: each mode\'s id, display name, and — for a work mode — the flow steps in order with the model each step declares and what it states the step does. Call this before mode_write to read the exact step list a change starts from; `trust: user` marks the modes mode_write can change.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          modes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                trust: { type: 'string', required: true },
                description: { type: 'string' },
                steps: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      label: { type: 'string', required: true },
                      model: { type: 'string', required: true },
                      prompt: { type: 'string' },
                      cluster: CLUSTER_SCHEMA,
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderModes(value.modes) }],
    },
    async execute() {
      const presets = await ctx.agentPresets.list()
      // A preset discovery calls broken cannot compose a session, and a mode
      // written over one would keep whatever is wrong with it; both are left
      // out rather than offered as a starting point.
      return { modes: presets.filter(preset => preset.broken === undefined).map(toModeView) }
    },
    presentCall: () => ({ card: 'generic', title: 'List modes', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'mode_write',
    description: 'Create or change one session mode. A mode is what a session\'s steps ARE: its display name, its description, and — as a work mode — the ordered steps it runs, each with a display label, an optional model route, and an optional statement of what that step does. It is NOT which plugins the session mounts: that composition is copied from `from` on creation and cannot be changed here, so a mode never grants a session capabilities it did not already have. To create, pass `from` (an existing mode id, listed by mode_list) plus `id`; to change an existing user mode, pass its `id` with no `from`. Fields you omit keep the stored value, except `steps`, which replaces the whole step list. A step\'s `prompt` joins your instructions for the whole session: you read it on every request, not only when that step begins, and it adds to your standing instructions rather than replacing them.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Mode id: lowercase kebab-case, and the directory name. Existing user modes are rewritten; a new mode needs `from`.',
      },
      from: {
        type: 'string',
        description: 'Id of an existing mode whose plugin composition the NEW mode copies. Omit to change an existing mode instead.',
      },
      name: { type: 'string', description: 'Display name shown in the mode picker. Defaults to the id on creation; kept as stored when omitted.' },
      description: { type: 'string', description: 'One sentence on what this mode is for, shown in the picker.' },
      kind: {
        type: 'string',
        enum: ['work', 'free'],
        description: 'work runs the ordered steps below; free declares no steps. Omit to keep the stored kind.',
      },
      steps: {
        type: 'array',
        description: 'The complete work-mode step list, in order; required when kind is work, and it replaces the stored list.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Kebab-case step id, unique in the flow; this is what the model declares.' },
            label: { type: 'string', required: true, description: 'Display label the step bar shows.' },
            model: { type: 'string', description: 'Model route for this step. Omit it, or pass "default", to run the step on the session model; otherwise pass "provider/model".' },
            prompt: { type: 'string', description: 'What this step does, in the model\'s own instructions. Concise prose; omit for a step named by its label alone.' },
            cluster: CLUSTER_SCHEMA,
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
          name: { type: 'string', required: true },
          steps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                model: { type: 'string', required: true },
                prompt: { type: 'string' },
                cluster: CLUSTER_SCHEMA,
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          value.created
            ? `Created mode ${value.id} (${value.name}).`
            : `Updated mode ${value.id} (${value.name}).`,
          ...value.steps.length === 0
            ? ['It declares no flow steps, so a session on it runs free-form.']
            : [
              'Steps, in order:',
              ...value.steps.map((step, index) =>
                `${String(index + 1)}. ${renderStep(step)}`),
            ],
          'The plugin composition was not touched: a session already running keeps the composition it started with, and only sessions created afterwards pick this one up. Its step instructions are re-read, so this flow reaches a running session when it next declares a step.',
        ].join('\n'),
      }],
    },
    async execute(args) {
      const request = writeRequest(args)
      const created = args.from !== undefined
      await ctx.agentPresets.save(request)
      // Read back through discovery rather than echoing the request: the
      // answer is what a new session will actually run.
      const stored = (await ctx.agentPresets.list()).find(preset => preset.id === args.id)
      /* v8 ignore next -- save() writes the directory list() re-reads, so the id is always listed */
      if (stored === undefined) throw new Error(`mode "${args.id}" is missing from the roster after it was written`)
      const view = toModeView(stored)
      return {
        id: view.id,
        created,
        name: view.name,
        steps: view.steps,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.from === undefined ? `Update mode ${args.id}` : `Create mode ${args.id}`,
      kind: 'edit',
      rawInput: args.id,
    }),
  }))
}

/** The declared arguments one `mode_write` call may carry. */
interface WriteArguments {
  readonly id: string
  readonly from?: string
  readonly name?: string
  readonly description?: string
  readonly kind?: PresetModeKind
  readonly steps?: readonly {
    readonly id: string
    readonly label: string
    readonly model?: string
    readonly prompt?: string
    readonly cluster?: FlowStepCluster
  }[]
}

/**
 * Translate one tool call into the authoring request.
 *
 * The request keeps the tool's own absences: a call that states no name leaves
 * the stored one alone, one that states no description leaves the preset's own
 * text alone, and one that states no model for a step means the step runs on
 * the session model. A step's model is the one field whose absence the file
 * cannot express, so it is filled in here.
 * @param args - the validated tool arguments.
 * @returns the request the roster service stores.
 */
function writeRequest(args: WriteArguments): AgentPresetWriteRequest {
  return {
    id: args.id,
    ...args.from === undefined ? {} : { from: args.from },
    ...args.name === undefined ? {} : { name: args.name },
    ...args.description === undefined ? {} : { description: args.description },
    ...args.kind === undefined ? {} : { modeKind: args.kind },
    ...args.steps === undefined ? {} : {
      steps: args.steps.map((step): AgentPresetStep => ({
        id: step.id,
        label: step.label,
        model: step.model ?? 'default',
        ...step.prompt === undefined ? {} : { prompt: step.prompt },
        ...step.cluster === undefined ? {} : { cluster: step.cluster },
      })),
    },
  }
}

/** One roster row as the tools read it back. */
function toModeView(preset: AgentPreset): {
  id: string
  name: string
  trust: string
  description?: string
  steps: StepView[]
} {
  return {
    id: preset.id,
    name: preset.name ?? preset.id,
    trust: preset.trust,
    ...preset.description === undefined ? {} : { description: preset.description },
    steps: preset.flow?.steps.map((step): StepView => ({
      id: step.id,
      label: step.label,
      model: step.model,
      ...step.prompt === undefined ? {} : { prompt: step.prompt },
      ...step.cluster === undefined ? {} : {
        cluster: {
          ...step.cluster.perspectives === undefined ? {} : { perspectives: [...step.cluster.perspectives] },
          ...step.cluster.strategy === undefined ? {} : { strategy: step.cluster.strategy },
        },
      },
    })) ?? [],
  }
}

/**
 * The suffix a cluster step's rendered line carries: the declared strategy
 * when it states one, otherwise the declared viewpoint count, otherwise the
 * bare declaration. Matches the flow prompt section's rendering.
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

/**
 * One step as a rendered list entry, without its index or indentation: the
 * structural fields together, then the stated purpose last.
 * @param step - the step to render.
 * @returns the entry text.
 */
function renderStep(step: StepView): string {
  return `${step.label} (${step.id}) · ${step.model}${step.cluster === undefined ? '' : clusterSuffix(step.cluster)}${step.prompt === undefined ? '' : ` — ${step.prompt}`}`
}

/** The `mode_list` result as the model reads it. */
function renderModes(modes: readonly {
  id: string
  name: string
  trust: string
  description?: string
  steps: readonly StepView[]
}[]): string {
  if (modes.length === 0) {
    return 'This deployment offers no session modes. A mode cannot be created without an existing one to copy its plugin composition from.'
  }
  return [
    `Session modes (${String(modes.length)}):`,
    ...modes.flatMap((mode) => {
      const head = `- \`${mode.id}\` · ${mode.name} [${mode.trust}]${mode.description === undefined ? '' : ` — ${mode.description}`}`
      if (mode.steps.length === 0) return [`${head} (free: no flow steps)`]
      return [
        `${head} (work: ${String(mode.steps.length)} steps)`,
        ...mode.steps.map((step, index) =>
          `    ${String(index + 1)}. ${renderStep(step)}`),
      ]
    }),
  ].join('\n')
}
