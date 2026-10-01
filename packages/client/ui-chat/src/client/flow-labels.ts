/** Mode-roster step labels for the process segments that declare a flow step. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'

/** No flow declares any step until the roster read lands. */
const EMPTY_FLOWS: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map()

/** Preset id → (step id → display label) for every work flow the roster declares. */
function flowLabels(roster: AgentPresetRoster): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const flows = new Map<string, ReadonlyMap<string, string>>()
  for (const preset of roster.presets) {
    if (preset.modeKind !== 'work' || preset.flow === undefined) continue
    const steps = new Map<string, string>()
    for (const step of preset.flow.steps) steps.set(step.id, step.label)
    flows.set(preset.id, steps)
  }
  return flows
}

/**
 * Live step labels for the grouped transcript's process segments. A declared
 * step reaches the client as its id — the declaration itself carries no name —
 * so the segment reads the same data its session's flow strip renders: the mode
 * roster, through the presets remote, keyed by the mode the session runs.
 */
export class FlowStepLabels {
  /** Reactive preset id → step labels; empty until the roster read lands. */
  readonly flows: SnapshotStore<ReadonlyMap<string, ReadonlyMap<string, string>>> =
    createSnapshotStore(EMPTY_FLOWS)
  /** Working directory whose roster was requested last, null before the first. */
  private requested: string | null = null

  /**
   * @param read - reads the mode roster for one working directory, or null when
   *   the deployment composes no preset roster.
   */
  constructor(private readonly read: (cwd: string | undefined) => Promise<AgentPresetRoster | null>) {}

  /**
   * Read the roster once per working directory and publish its flow labels.
   * @param cwd - the session's working directory, which selects the project layer.
   */
  load(cwd: string | undefined): void {
    const key = cwd ?? ''
    if (this.requested === key) return
    this.requested = key
    void this.read(cwd).then((roster) => {
      // A failed read leaves the previous labels in place: a step without a
      // label renders the declaration it came from.
      if (roster !== null) this.flows.set(flowLabels(roster))
    })
  }
}
