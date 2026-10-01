/**
 * A preset's mode classification and flow declaration: the `mode_kind` and
 * `flow` fields of {@link METADATA_FILE | preset.yml}.
 *
 * Unlike the display text beside them, these fields are SEMANTIC: a `work`
 * preset's flow drives the runtime mode system (session-mode switching, the
 * flow prompt section, the step bar), so a `work` preset without a valid flow
 * is broken and every mounting path refuses it. The file is read separately
 * from the display metadata because the two fail differently — unreadable
 * display text degrades to the preset id, while an invalid mode declaration
 * reports its reason on the roster row.
 *
 * Absent `mode_kind` means `free`: the lightweight/discussion classification
 * that owes no flow and is exempt from the requirement. A `free` (or
 * undeclared) preset carrying a `flow` is contradictory and refused — the flow
 * format exists to drive the work-mode machinery, and accepting a declaration
 * nothing would honor would teach authors to ignore the marker.
 * @module @deepseek-ai/dsh-agent-presets/mode
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { METADATA_FILE } from './metadata.ts'

/** The two mode classifications a preset may declare. */
export type PresetModeKind = 'work' | 'free'

/**
 * One step of a work-mode flow. `id` is the machine identifier the
 * `flow_step` tool validates against; `label` is the display name the preset
 * author localized; `model` is `'default'` (follow the session model) or a
 * `provider/model` route; `prompt` is what this step is FOR, stated in the
 * model's own instructions.
 */
export interface FlowStep {
  /** Machine id; kebab-case, unique within the flow. */
  readonly id: string
  /** Display name, localized by the preset author. */
  readonly label: string
  /** `'default'` follows the session model; otherwise `provider/model`. */
  readonly model: string
  /**
   * Optional statement of what this step does, appended to the flow section of
   * the model's instructions. Absent means the step is named by its label
   * alone, which is how every flow declared before this field reads.
   */
  readonly prompt?: string
  /** The AI-cluster declaration: when present, this step is executed by the cluster. */
  readonly cluster?: FlowStepCluster
}

/**
 * How one flow step is handed to the AI cluster: several parallel subagents
 * take the step from different viewpoints and their outputs are combined.
 */
export interface FlowStepCluster {
  /** The member viewpoints; absent uses the runner's default panel. */
  readonly perspectives?: readonly string[]
  /** How member outputs are combined; absent means `'synthesize'`. */
  readonly strategy?: 'synthesize' | 'vote'
}

/** The declared step sequence a work-mode session runs on. */
export interface FlowDefinition {
  /** Steps in execution order; at least one. */
  readonly steps: readonly FlowStep[]
}

/** What {@link readPresetMode} found in one preset directory. */
export interface PresetModeRead {
  /** The declared mode, absent when the file declares none (free). */
  readonly mode?: { kind: 'work'; flow: FlowDefinition } | { kind: 'free' }
  /** Why the declaration is unusable; absent when it is valid or absent. */
  readonly problem?: string
}

/** Machine ids match the preset-id rule: a path-segment-safe kebab-case. */
const STEP_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Characters that may not appear in a step model: C0 controls and DEL, which
 * no route contains. A line break here is not cosmetic — the flow section
 * renders the model on one line of the model's instructions, so a value
 * carrying one would add a line of its own there.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** A non-empty trimmed string, or undefined for anything else. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * One `cluster` node as a validated step record stores it.
 * @param value - the raw `step.cluster` node, already accepted by {@link flowProblem}.
 * @returns the declaration with its viewpoints trimmed, or undefined when the step declares none.
 */
function readCluster(value: unknown): FlowStepCluster | undefined {
  if (value === undefined) return undefined
  const record = value as Record<string, unknown>
  const perspectives = record.perspectives === undefined
    ? undefined
    : (record.perspectives as readonly unknown[]).map(viewpoint => text(viewpoint) as string)
  const strategy = record.strategy as FlowStepCluster['strategy'] | undefined
  return {
    ...perspectives === undefined ? {} : { perspectives },
    ...strategy === undefined ? {} : { strategy },
  }
}

/**
 * Why `steps` is not a valid flow, or undefined when it is.
 * @param steps - the raw `flow.steps` node.
 * @returns one human-readable reason, or undefined when the shape holds.
 */
export function flowProblem(steps: unknown): string | undefined {
  if (!Array.isArray(steps) || steps.length === 0) {
    return 'flow.steps must be a non-empty list of step entries'
  }
  const seen = new Set<string>()
  for (const [index, entry] of steps.entries()) {
    const label = `step ${String(index + 1)}`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return `${label} is not a step entry (expected a map with id, label, model, and optional prompt and cluster)`
    }
    const record = entry as Record<string, unknown>
    const id = text(record.id)
    if (id === undefined) {
      return `${label} has no usable id (a non-empty kebab-case string is required)`
    }
    if (!STEP_ID.test(id)) {
      return `${label} id "${id}" must be kebab-case (${String(STEP_ID)})`
    }
    if (seen.has(id)) {
      return `${label} repeats the step id "${id}"`
    }
    seen.add(id)
    if (text(record.label) === undefined) {
      return `${label} has no usable label (a non-empty string is required)`
    }
    const model = text(record.model)
    if (model === undefined) {
      return `${label} has no usable model ("default" or "provider/model")`
    }
    if (model !== 'default' && !model.includes('/')) {
      return `${label} model "${model}" is neither "default" nor a "provider/model" route`
    }
    if (CONTROL_CHARACTERS.test(model)) {
      return `${label} model ${JSON.stringify(model)} carries a control character; a model is "default" or a "provider/model" route`
    }
    if (record.prompt !== undefined && text(record.prompt) === undefined) {
      return `${label} declares an empty prompt; omit the field instead of leaving it blank`
    }
    const cluster = record.cluster
    if (cluster !== undefined) {
      if (typeof cluster !== 'object' || cluster === null || Array.isArray(cluster)) {
        return `${label} "${id}" cluster must be a map of the optional keys "perspectives" and "strategy"`
      }
      if (Object.keys(cluster).length === 0) {
        return `${label} "${id}" declares an empty cluster; omit the field, or state "perspectives" and/or "strategy"`
      }
      const declared = cluster as Record<string, unknown>
      const perspectives = declared.perspectives
      if (perspectives !== undefined) {
        if (!Array.isArray(perspectives) || perspectives.length === 0 || perspectives.length > 8) {
          return `${label} "${id}" cluster.perspectives must be a list of 1 to 8 viewpoints`
        }
        for (const [position, viewpoint] of perspectives.entries()) {
          const stated = text(viewpoint)
          if (stated === undefined) {
            return `${label} "${id}" cluster.perspectives[${String(position)}] is not a non-empty viewpoint string`
          }
          if (CONTROL_CHARACTERS.test(stated)) {
            return `${label} "${id}" cluster.perspectives[${String(position)}] carries a control character; a viewpoint is one line of text`
          }
        }
      }
      const strategy = declared.strategy
      if (strategy !== undefined && strategy !== 'synthesize' && strategy !== 'vote') {
        return `${label} "${id}" cluster.strategy must be "synthesize" or "vote" (got ${JSON.stringify(strategy)})`
      }
    }
  }
  return undefined
}

/**
 * Read one preset directory's mode declaration.
 *
 * An absent, unreadable, or unparsable file is the same answer as an
 * undeclared mode — free, no problem — matching the display metadata's
 * degrade. Only a declaration that IS present and invalid reports a problem.
 * @param directory - the preset directory.
 * @returns the declared mode and/or why it is unusable.
 */
export async function readPresetMode(directory: string): Promise<PresetModeRead> {
  let raw: string
  try {
    raw = await readFile(join(directory, METADATA_FILE), 'utf8')
  } catch {
    return {}
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    // The picker renders display text; an unparsable file degrades the same
    // way metadata does, and a mode the file cannot name is not declared.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  const kind = record.mode_kind
  if (kind === undefined) {
    return record.flow === undefined
      ? {}
      : { problem: 'flow is only valid with mode_kind: work' }
  }
  if (kind !== 'work' && kind !== 'free') {
    return { problem: `mode_kind must be "work" or "free" (got ${JSON.stringify(kind)})` }
  }
  if (kind === 'free') {
    return record.flow === undefined
      ? { mode: { kind: 'free' } }
      : { problem: 'flow is only valid with mode_kind: work' }
  }
  if (typeof record.flow !== 'object' || record.flow === null || Array.isArray(record.flow)) {
    return { problem: 'mode_kind: work requires a flow definition (flow.steps)' }
  }
  const problem = flowProblem((record.flow as Record<string, unknown>).steps)
  if (problem !== undefined) return { problem: `mode_kind: work has an invalid flow: ${problem}` }
  return {
    mode: {
      kind: 'work',
      flow: {
        steps: ((record.flow as Record<string, unknown>).steps as readonly Record<string, unknown>[])
          .map((step) => {
            const prompt = text(step.prompt)
            const cluster = readCluster(step.cluster)
            return {
              id: text(step.id) as string,
              label: text(step.label) as string,
              model: text(step.model) as string,
              ...prompt === undefined ? {} : { prompt },
              ...cluster === undefined ? {} : { cluster },
            }
          }),
      },
    },
  }
}
