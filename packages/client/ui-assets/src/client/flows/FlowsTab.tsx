/**
 * The flows tab: mode presets grouped by work flow / free mode plus the form
 * that copies one work preset into a new flow. Moved out of AssetsPage
 * unchanged when the assets tab became the hub.
 */

import { useState, type ReactNode } from 'react'
import type { AssetOverview } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from '../AssetsPage.module.css'

/** The ui.assets translate seat this package's components read. */
type Translate = TranslateNS<'ui.assets'>

/** The authoring Remote's request, as the page's injection declares it. */
export type SaveFlowRequest = {
  readonly from?: string
  readonly id: string
  readonly name: string
  readonly modeKind?: 'work' | 'free'
  readonly steps?: readonly {
    readonly id: string
    readonly label: string
    readonly model: string
    readonly prompt?: string
  }[]
}

/** One preset card; clicking expands its inline step list. */
function FlowCard({ flow, t }: { readonly flow: AssetOverview['flows'][number]; readonly t: Translate }): ReactNode {
  const [open, setOpen] = useState(false)
  const free = flow.modeKind !== 'work' || flow.steps.length === 0
  return (
    <div className={css.flowCard}>
      <button type="button" className={css.flowHead} onClick={() => { setOpen(value => !value) }}>
        <span className={css.flowName}>{flow.name}</span>
        <span className={css.chip}>{free ? t('flowFreeGroup') : `${t('flowStepsLabel')} · ${String(flow.steps.length)}`}</span>
      </button>
      {open && !free
        ? (
          <ol className={css.flowSteps}>
            {flow.steps.map((step, index) => (
              <li key={step.id} className={css.flowStep}>
                <span className={css.flowStepIndex}>{String(index + 1)}</span>
                <span className={css.flowStepBody}>
                  <span className={css.flowStepHead}>
                    <span>{step.label}</span>
                    <span className={css.flowStepModel}>
                      {step.model === 'default' ? t('flowModelDefault') : step.model}
                    </span>
                  </span>
                  {step.prompt === undefined ? null : <span className={css.flowStepPrompt}>{step.prompt}</span>}
                </span>
              </li>
            ))}
          </ol>
        )
        : null}
    </div>
  )
}

/** One titled group of preset flow cards; empty groups render nothing. */
function FlowGroup({ title, flows, t }: {
  readonly title: string
  readonly flows: readonly AssetOverview['flows'][number][]
  readonly t: Translate
}): ReactNode {
  if (flows.length === 0) return null
  return (
    <section className={css.flowGroup}>
      <h3 className={css.sectionTitle}>{title}</h3>
      {flows.map(flow => <FlowCard key={flow.presetId} flow={flow} t={t} />)}
    </section>
  )
}

/** One editable step row in the new-flow form. */
interface DraftStep {
  readonly id: string
  readonly label: string
  readonly model: string
  readonly prompt: string
}

/**
 * The draft steps the new-flow form opens with: the source flow's first step,
 * which its author then edits. Id and label are the source preset's own seed
 * text — the same values the host writes into the new `preset.yml` — so they
 * stay data and are never translated.
 * @param source - the source work flow, or undefined when none can be copied.
 * @returns the editable draft steps; empty when the source states no step.
 */
function draftSteps(source: AssetOverview['flows'][number] | undefined): readonly DraftStep[] {
  const [first] = source?.steps ?? []
  return first === undefined
    ? []
    : [{ id: first.id, label: first.label, model: first.model, prompt: first.prompt ?? '' }]
}

/**
 * The flow authoring form: copies one existing work preset's composition and
 * declares a new flow over it. Only the flow is editable — the composition is
 * the source's, and the host refuses to take one from a caller. Each step may
 * state what it does; the host validates ids, labels, models, and prompts with
 * the same rule discovery applies.
 */
function FlowForm({ flows, saveFlow, t, onCreated }: {
  readonly flows: readonly AssetOverview['flows'][number][]
  readonly saveFlow: (request: SaveFlowRequest) => Promise<string | undefined>
  readonly t: Translate
  readonly onCreated: () => void
}): ReactNode {
  const workFlows = flows.filter(flow => flow.modeKind === 'work' && flow.steps.length > 0)
  const [firstWork] = workFlows
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<readonly DraftStep[]>(() => draftSteps(firstWork))
  const [busy, setBusy] = useState(false)
  /** The closed row's success text, or the open form's failure text. */
  const [message, setMessage] = useState<string | null>(null)

  if (firstWork === undefined) return null
  const source = from === '' ? firstWork.presetId : from
  const patch = (index: number, next: Partial<DraftStep>): void => {
    setSteps(current => current.map((step, at) => at === index ? { ...step, ...next } : step))
  }
  const submit = (): void => {
    setBusy(true)
    setMessage(null)
    void saveFlow({
      from: source,
      id: id.trim(),
      name: name.trim(),
      modeKind: 'work',
      steps: steps.map(step => ({
        id: step.id.trim(),
        label: step.label.trim(),
        model: step.model.trim(),
        ...step.prompt.trim() === '' ? {} : { prompt: step.prompt.trim() },
      })),
    }).then(
      (failure) => {
        setBusy(false)
        if (failure === undefined) {
          setOpen(false)
          setMessage(t('newFlowOk'))
          onCreated()
        } else {
          setMessage(t('newFlowError', { message: failure }))
        }
      },
      (error: unknown) => { setBusy(false); setMessage(t('newFlowError', { message: String(error) })) },
    )
  }

  if (!open) {
    return (
      <p className={css.flowActions}>
        <button type="button" className={css.primary} onClick={() => { setOpen(true); setMessage(null) }}>{t('newFlow')}</button>
        {message === null ? null : <span className={css.cardDesc}>{message}</span>}
      </p>
    )
  }
  return (
    <section className={css.flowForm}>
      <h3 className={css.sectionTitle}>{t('newFlow')}</h3>
      <div className={css.formRow}>
        <label className={css.formField}>
          <span>{t('newFlowFrom')}</span>
          <select value={source} onChange={(event) => { setFrom(event.currentTarget.value) }}>
            {workFlows.map(flow => <option key={flow.presetId} value={flow.presetId}>{flow.name}</option>)}
          </select>
        </label>
        <label className={css.formField}>
          <span>{t('newFlowId')}</span>
          <input value={id} onChange={(event) => { setId(event.currentTarget.value) }} placeholder="my-flow" />
        </label>
        <label className={css.formField}>
          <span>{t('newFlowName')}</span>
          <input value={name} onChange={(event) => { setName(event.currentTarget.value) }} placeholder={t('newFlowNamePlaceholder')} />
        </label>
      </div>
      <p className={css.cardDesc}>{`${t('newFlowSteps')} · ${t('modelDefaultHint')}`}</p>
      {steps.map((step, index) => (
        <div key={String(index)} className={css.formRow}>
          <label className={css.formField}>
            <span>{t('newFlowStepId')}</span>
            <input value={step.id} onChange={(event) => { patch(index, { id: event.currentTarget.value }) }} />
          </label>
          <label className={css.formField}>
            <span>{t('newFlowStepLabel')}</span>
            <input value={step.label} onChange={(event) => { patch(index, { label: event.currentTarget.value }) }} />
          </label>
          <label className={css.formField}>
            <span>{t('newFlowStepModel')}</span>
            <input value={step.model} onChange={(event) => { patch(index, { model: event.currentTarget.value }) }} />
          </label>
          <label className={`${css.formField} ${css.formFieldWide}`}>
            <span>{t('newFlowStepPrompt')}</span>
            <input
              value={step.prompt}
              placeholder={t('newFlowStepPromptHint')}
              onChange={(event) => { patch(index, { prompt: event.currentTarget.value }) }}
            />
          </label>
          <button
            type="button"
            className={css.ghost}
            disabled={steps.length <= 1}
            onClick={() => { setSteps(current => current.filter((_step, at) => at !== index)) }}
          >
            {t('newFlowRemove')}
          </button>
        </div>
      ))}
      <div className={css.flowActions}>
        <button
          type="button"
          className={css.ghost}
          onClick={() => { setSteps(current => [...current, { id: '', label: '', model: 'default', prompt: '' }]) }}
        >
          {t('newFlowAddStep')}
        </button>
        <button type="button" className={css.primary} disabled={busy || id.trim() === '' || name.trim() === ''} onClick={submit}>
          {busy ? t('newFlowSubmitting') : t('newFlowSubmit')}
        </button>
        <button type="button" className={css.ghost} disabled={busy} onClick={() => { setOpen(false); setMessage(null) }}>
          {t('newFlowCancel')}
        </button>
        {message === null ? null : <span className={css.formError} role="alert">{message}</span>}
      </div>
    </section>
  )
}

/** Render the flows tab over one overview snapshot. */
export function FlowsTab({ overview, saveFlow, onCreated, t }: {
  readonly overview: AssetOverview
  readonly saveFlow: (request: SaveFlowRequest) => Promise<string | undefined>
  readonly onCreated: () => void
  readonly t: Translate
}): ReactNode {
  if (overview.flows.length === 0) return <p className={css.status}>{t('emptyFlows')}</p>
  return (
    <>
      <FlowGroup
        title={t('flowWorkGroup')}
        flows={overview.flows.filter(flow => flow.modeKind === 'work' && flow.steps.length > 0)}
        t={t}
      />
      <FlowGroup
        title={t('flowFreeGroup')}
        flows={overview.flows.filter(flow => flow.modeKind !== 'work' || flow.steps.length === 0)}
        t={t}
      />
      <FlowForm flows={overview.flows} saveFlow={saveFlow} t={t} onCreated={onCreated} />
    </>
  )
}
