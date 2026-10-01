/**
 * System-prompt personalization editor: three textareas over the
 * `system-prompt` settings namespace, one Save button that writes all three.
 * The same component renders both of the plugin's occurrences — the row inside
 * the System settings section and the dedicated System-prompt page.
 *
 * The drafts are component-local until Save; a committed Host revision
 * re-seeds them, which is how a successful save, another surface's write, and
 * a rejected write's recovery read all reach the textareas.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createSystemPromptRowStore } from './store.ts'
import css from './SystemPromptRow.module.css'

/** The three editable fields as one save unit. */
export interface SystemPromptDraft {
  /** Text rendered before first-party guidance. */
  personaPrefix: string
  /** Text rendered after first-party guidance. */
  personaSuffix: string
  /** Instructions appended at the end of the system prompt. */
  customInstructions: string
}

/** Injected business face: the namespace write (copy rides the standard locale seat). */
export interface SystemPromptRowInjected {
  /**
   * Persist all three fields.
   * @param draft - the complete edited value.
   * @returns settlement after the write; rejects with the transport failure.
   */
  save: (draft: SystemPromptDraft) => Promise<void>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type SystemPromptRowProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSystemPromptRowStore>>
  & PropsLocale<'settings.systemPrompt'> & SystemPromptRowInjected

/** Substitute the one `{message}` placeholder in a failure line. */
function fillError(template: string, message: string): string {
  return template.replace('{message}', message)
}

/**
 * Render the System-prompt personalization editor.
 * @param props - composed slot props.
 * @returns the editor element tree.
 */
export function SystemPromptRow({ t, useStore, save }: SystemPromptRowProps): ReactNode {
  const status = useStore(s => s.status)
  const writable = useStore(s => s.writable)
  const revision = useStore(s => s.revision)
  const personaPrefix = useStore(s => s.personaPrefix)
  const personaSuffix = useStore(s => s.personaSuffix)
  const customInstructions = useStore(s => s.customInstructions)
  const [draft, setDraft] = useState<SystemPromptDraft>({ personaPrefix, personaSuffix, customInstructions })
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** Revision the drafts were seeded from; the first Host revision is what moves it. */
  const seeded = useRef(revision)

  // Adopt Host state whenever it moves. Drafts survive re-renders at the same
  // revision, so typing is never interrupted by an unrelated republish.
  useEffect(() => {
    if (seeded.current === revision) return
    seeded.current = revision
    setDraft({ personaPrefix, personaSuffix, customInstructions })
    setError(null)
  }, [revision, personaPrefix, personaSuffix, customInstructions])

  const ready = status === 'ready'
  const editable = ready && writable && !busy

  const write = (): void => {
    setBusy(true)
    setError(null)
    void save(draft).then(
      () => {
        setBusy(false)
        setSavedAt(Date.now())
      },
      (failure: unknown) => {
        setBusy(false)
        setError(fillError(t('saveError'), String(failure)))
      },
    )
  }

  const field = (
    key: keyof SystemPromptDraft,
    label: string,
    hint: string,
  ): ReactNode => (
    <div className={css.field} key={key}>
      <div className={css.label}>{label}</div>
      <div className={css.hint}>{hint}</div>
      <textarea
        className={css.textarea}
        value={draft[key]}
        aria-label={label}
        disabled={!editable}
        onChange={(event) => {
          const value = event.currentTarget.value
          setDraft(current => ({ ...current, [key]: value }))
        }}
      />
    </div>
  )

  return (
    <section className={css.row}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.description}>{t('description')}</div>
      {ready && !writable ? <div className={css.notice}>{t('readOnly')}</div> : null}

      <div className={css.fields}>
        {field('personaPrefix', t('personaPrefix.label'), t('personaPrefix.hint'))}
        {field('personaSuffix', t('personaSuffix.label'), t('personaSuffix.hint'))}
        {field('customInstructions', t('customInstructions.label'), t('customInstructions.hint'))}
      </div>

      <div className={css.actions}>
        <button
          type="button"
          className={css.saveButton}
          disabled={!editable}
          onClick={write}
        >
          {busy ? t('saving') : t('save')}
        </button>
        {error === null && savedAt > 0 && !busy ? <span className={css.status}>{t('saved')}</span> : null}
        {error !== null ? <span className={css.error} role="alert">{error}</span> : null}
      </div>
    </section>
  )
}
