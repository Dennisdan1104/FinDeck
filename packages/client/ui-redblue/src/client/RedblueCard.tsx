/**
 * The red/blue prompt editors card: two textareas over the `rbcheck`
 * settings namespace, saved through the settings Remote. Empty text means
 * "use the built-in default" — the reset buttons write empty strings.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './RedblueCard.module.css'

/** The rbcheck namespace value as the describe Remote answers it. */
interface RbcheckValue {
  redPrompt?: unknown
  bluePrompt?: unknown
}

export type RedblueCardProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.redblue'>
  & {
    /** Read the rbcheck namespace value (empty strings when absent). */
    readonly load: () => Promise<{ redPrompt: string; bluePrompt: string }>
    /** Write one prompt pair; resolves undefined on success, failure text otherwise. */
    readonly save: (prompts: { redPrompt: string; bluePrompt: string }) => Promise<string | undefined>
  }

function fill(text: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text)
}

/** Render the red/blue prompt editors card. */
export function RedblueCard({ load, save, t }: RedblueCardProps): ReactNode {
  const [red, setRed] = useState('')
  const [blue, setBlue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void load().then(
      (value) => { if (current) { setRed(value.redPrompt); setBlue(value.bluePrompt); setLoaded(true) } },
      (failure: unknown) => { if (current) { setError(fill(t('loadError'), { message: String(failure) })); setLoaded(true) } },
    )
    return () => { current = false }
  }, [load, t])

  const write = async (prompts: { redPrompt: string; bluePrompt: string }): Promise<void> => {
    setBusy(true)
    setError(null)
    setRed(prompts.redPrompt)
    setBlue(prompts.bluePrompt)
    const failure = await save(prompts)
    setBusy(false)
    if (failure !== undefined) setError(fill(t('error'), { message: failure }))
    else setSavedAt(Date.now())
  }

  return (
    <section className={css.card}>
      <h3 className={css.title}>{t('title')}</h3>
      <p className={css.blurb}>{t('blurb')}</p>

      <div className={css.field}>
        <div className={css.label}>
          <span>{t('redLabel')}</span>
          <button
            type="button"
            className={css.labelButton}
            disabled={!loaded || busy}
            onClick={() => { void write({ redPrompt: '', bluePrompt: blue }) }}
          >
            {t('resetRed')}
          </button>
        </div>
        <textarea
          className={css.textarea}
          value={red}
          aria-label={t('redLabel')}
          disabled={!loaded}
          onChange={(event) => { setRed(event.currentTarget.value) }}
        />
      </div>

      <div className={css.field}>
        <div className={css.label}>
          <span>{t('blueLabel')}</span>
          <button
            type="button"
            className={css.labelButton}
            disabled={!loaded || busy}
            onClick={() => { void write({ redPrompt: red, bluePrompt: '' }) }}
          >
            {t('resetBlue')}
          </button>
        </div>
        <textarea
          className={css.textarea}
          value={blue}
          aria-label={t('blueLabel')}
          disabled={!loaded}
          onChange={(event) => { setBlue(event.currentTarget.value) }}
        />
      </div>

      <div className={css.actions}>
        <button
          type="button"
          className={css.saveButton}
          disabled={!loaded || busy}
          onClick={() => { void write({ redPrompt: red, bluePrompt: blue }) }}
        >
          {busy ? t('saving') : t('save')}
        </button>
        {error === null && savedAt > 0 && !busy ? <span className={css.status}>{t('saved')}</span> : null}
        {error !== null ? <span className={css.error} role="alert">{error}</span> : null}
      </div>
    </section>
  )
}

export type { RbcheckValue }
