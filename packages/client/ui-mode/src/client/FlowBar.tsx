/**
 * The flow strip under the session title row: a work mode renders its declared
 * steps as a progress bar (done/current/pending, the current step's model
 * beside it); a free mode renders the declared label trail. Everything is read
 * from the host-computed `mode` projection plus the roster row that names the
 * flow — the strip itself holds no state beyond the one roster read. The
 * strip's right cluster carries the owner-threaded trajectory control between
 * the steps and the current-step line.
 */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'
// Type-only: pulls the ui-conversation SlotMap merge (the session.flow seat,
// its {trailing} owner share, and the `mode` projection key).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-mode/client'
import type { ModeUiInjected, RosterRead } from './index.ts'
import { modeRows, type ModeRow } from './ModeSelect.tsx'
import css from './FlowBar.module.css'

/** One flow step as the roster declares it. */
interface FlowStepRow {
  readonly id: string
  readonly label: string
  readonly model: string
  /** Whether the step carries an AI-cluster declaration; the badge needs no more. */
  readonly cluster?: boolean
}

/** Full flow-strip component props: runtime share & injected share & the locale seat. */
export type FlowBarProps =
  PropsRuntime<'conversation.session.flow'> & InjectFace<ModeUiInjected> & PropsLocale<'mode'>

/** The model id a flow step runs on: the session's model, or the step's route. */
function stepModel(step: FlowStepRow, sessionModel: string | undefined): string | undefined {
  /* v8 ignore next -- split always yields at least one element, so at(-1) is never undefined */
  if (step.model !== 'default') return step.model.split('/').at(-1) ?? step.model
  return sessionModel
}

/**
 * Render the session's flow strip.
 * @param props - composed slot props (the owner share carries the strip's
 *   right-cluster control).
 * @returns the strip, or null while no mode, roster, or flow is in force.
 */
export function FlowBar({ trailing, useProjection, loadRoster, t }: FlowBarProps) {
  const mode = useProjection('mode')
  const modelSelection = useProjection('modelSelection')
  const [rows, setRows] = useState<ModeRow[] | null>(null)
  const [flows, setFlows] = useState<ReadonlyMap<string, readonly FlowStepRow[]> | null>(null)

  useEffect(() => {
    let alive = true
    void loadRoster().then((read: RosterRead) => {
      if (!alive || !read.ok) {
        if (alive) setRows([])
        return
      }
      const roster: AgentPresetRoster = read.value
      setRows(modeRows(roster))
      const byMode = new Map<string, readonly FlowStepRow[]>()
      for (const preset of roster.presets) {
        if (preset.modeKind !== 'work' || preset.flow === undefined) continue
        byMode.set(preset.id, preset.flow.steps.map(step => ({
          id: step.id,
          label: step.label,
          model: step.model,
          cluster: step.cluster !== undefined,
        })))
      }
      setFlows(byMode)
    })
    return () => { alive = false }
  }, [loadRoster])

  if (mode === undefined || mode.mode === null || rows === null || flows === null) return null
  const flow = flows.get(mode.mode)
  if (flow === undefined) {
    // Free mode: no fixed steps, only the declared trail.
    return (
      <div className={css.bar} data-mode-kind="free">
        <span className={css.freeBadge}>{t('bar.free')}</span>
        {mode.steps.length > 0 && (
          <span className={css.trail}>{t('bar.trail', { steps: mode.steps.join(' → ') })}</span>
        )}
        <span className={css.side}>{trailing}</span>
      </div>
    )
  }
  const sessionModel = (modelSelection?.next ?? modelSelection?.lastUsed)?.model
  // Before the first declaration the flow's first step is the current one —
  // the session begins there; a declared step is authoritative from then on.
  const currentId = mode.step ?? flow[0]?.id
  const currentStep = flow.find(step => step.id === currentId)
  const visited = new Set(mode.steps)
  return (
    <div className={css.bar} data-mode-kind="work">
      <ol className={css.steps} aria-label={t('select.hint')}>
        {flow.map((step, index) => (
          <li
            key={step.id}
            className={css.step}
            data-state={step.id === currentId ? 'current' : visited.has(step.id) ? 'done' : 'pending'}
          >
            {index > 0 && <span className={css.link} aria-hidden />}
            <span className={css.dot} aria-hidden />
            <span className={css.label}>{step.label}</span>
            {step.cluster === true && <span className={css.clusterBadge}>{t('bar.cluster')}</span>}
          </li>
        ))}
      </ol>
      <span className={css.side}>
        {trailing}
        {currentStep !== undefined && (
          <span className={css.currentLine}>
            <span className={css.current}>{t('bar.current', { label: currentStep.label })}</span>
            {stepModel(currentStep, sessionModel) !== undefined && (
              /* v8 ignore next -- the previous line already resolved the same pure call for this step */
              <span className={css.model}>{` · ${t('bar.model', { model: stepModel(currentStep, sessionModel) ?? '' })}`}</span>
            )}
          </span>
        )}
      </span>
    </div>
  )
}
