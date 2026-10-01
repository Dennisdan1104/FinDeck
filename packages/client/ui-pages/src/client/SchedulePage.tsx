/**
 * The schedule primary page (R11): a card wall over every stored session's
 * scheduled runs, grouped by the task type the [R11] binding header names, with
 * a per-card pause/resume switch and direct deletion backed by the
 * `scheduleControl` Remote, plus the copyable run templates behind a
 * create-button panel. Creation itself happens in a session — the AI builds the
 * task via `schedule_create` after the user confirms — so this page steers and
 * lists rather than pretending to create.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type {
  ScheduleManagementResult,
  ScheduleOverview,
  ScheduleOverviewEntry,
  ScheduleRemovalResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  IconClockOutlineMedium,
  IconEllipsisOutlineMedium,
  IconPlusOutlineMedium,
  IconRefreshOutlineMedium,
  IconTrashOutlineMedium,
  Menu,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PagesLocaleKey } from './locales.ts'
import css from './PlaceholderPage.module.css'

/** The copyable templates this page offers. */
const TEMPLATES: readonly { id: string; tag: PagesLocaleKey; hint: PagesLocaleKey; body: PagesLocaleKey }[] = [
  { id: 'research', tag: 'schedule.tplResearchTag', hint: 'schedule.tplResearchHint', body: 'schedule.tplResearchBody' },
  { id: 'thesis', tag: 'schedule.tplThesisTag', hint: 'schedule.tplThesisHint', body: 'schedule.tplThesisBody' },
  { id: 'recheck', tag: 'schedule.tplRecheckTag', hint: 'schedule.tplRecheckHint', body: 'schedule.tplRecheckBody' },
]

const KIND_KEYS: Record<string, PagesLocaleKey> = {
  at: 'schedule.listKindAt',
  every: 'schedule.listKindEvery',
  after: 'schedule.listKindAfter',
}

/** Card-wall groups, in fixed display order. */
const CATEGORY_ORDER = ['research', 'thesis', 'redblue', 'other'] as const

type Category = typeof CATEGORY_ORDER[number]

const CATEGORY_LABEL: Record<Category, PagesLocaleKey> = {
  research: 'schedule.catResearch',
  thesis: 'schedule.catThesis',
  redblue: 'schedule.catRedblue',
  other: 'schedule.catOther',
}

/** Status chip tone; the CSS keys its palette off `data-tone`. */
type StatusTone = 'neutral' | 'dim' | 'danger' | 'success'

/** One rendered group: its category, heading key, and the entries it holds. */
interface ScheduleGroup {
  readonly key: Category
  readonly labelKey: PagesLocaleKey
  readonly entries: readonly ScheduleOverviewEntry[]
}

export type SchedulePageProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'ui.pages'>
  & {
    /** Read every stored session's scheduled runs. */
    readonly load: () => Promise<ScheduleOverview>
    /** Pause or resume one scheduled run on its owning session. */
    readonly control: (
      sessionId: string,
      scheduleId: string,
      op: 'pause' | 'resume',
    ) => Promise<ScheduleManagementResult>
    /** Delete one scheduled run from its owning session. */
    readonly remove: (sessionId: string, scheduleId: string) => Promise<ScheduleRemovalResult>
  }

function fill(text: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, value), text)
}

/** The first meaningful line of a scheduled prompt, compacted. */
function promptLine(prompt: string): string {
  const line = prompt.split('\n').map(part => part.trim()).find(part => part !== '') ?? ''
  return line.length > 80 ? `${line.slice(0, 80)}\u2026` : line
}

/**
 * Classify a scheduled prompt into its card-wall group.
 *
 * Rules run against the whole prompt, case-insensitively, red/blue first so a
 * check that also mentions a thesis lands with the adversarial runs.
 * @param prompt - the schedule's full task prompt.
 * @returns the first matching category, `other` when nothing matches.
 */
function categoryOf(prompt: string): Category {
  if (/红蓝|red[\/\s-]?blue|rb-check/i.test(prompt)) return 'redblue'
  if (/复检|命题|recheck|thesis/i.test(prompt)) return 'thesis'
  if (/研究|research|盘前|晨报|复盘/i.test(prompt)) return 'research'
  return 'other'
}

/**
 * Bucket entries by category without reordering them: the overview's global
 * `scheduledAt` ascending order survives inside each group, and empty groups
 * produce no section.
 * @param entries - the overview's entries, already in display order.
 * @returns the non-empty groups in `CATEGORY_ORDER`.
 */
function groupEntries(entries: readonly ScheduleOverviewEntry[]): readonly ScheduleGroup[] {
  const buckets = new Map<Category, ScheduleOverviewEntry[]>()
  for (const entry of entries) {
    const category = categoryOf(entry.prompt)
    const bucket = buckets.get(category)
    if (bucket === undefined) buckets.set(category, [entry])
    else bucket.push(entry)
  }
  return CATEGORY_ORDER.flatMap((key) => {
    const group = buckets.get(key)
    return group === undefined ? [] : [{ key, labelKey: CATEGORY_LABEL[key], entries: group }]
  })
}

/**
 * Status chip copy and tone, by priority: an explicit pause outranks a closed
 * session, which outranks an overdue due time.
 * @param entry - the scheduled run to describe.
 * @returns the tone and the locale key of the chip text.
 */
function statusOf(entry: ScheduleOverviewEntry): { readonly tone: StatusTone; readonly key: PagesLocaleKey } {
  if (entry.paused === true) return { tone: 'neutral', key: 'schedule.statusPaused' }
  if (!entry.live) return { tone: 'dim', key: 'schedule.statusClosed' }
  if (entry.overdue) return { tone: 'danger', key: 'schedule.statusOverdue' }
  return { tone: 'success', key: 'schedule.statusScheduled' }
}

/**
 * Render a schedule time in the document's language and the viewer's zone.
 * @param scheduledAt - the ISO instant the overview reported.
 * @returns the localized date and time.
 */
function formatLocal(scheduledAt: string): string {
  return new Intl.DateTimeFormat(
    document.documentElement.lang || undefined,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(Date.parse(scheduledAt))
}

/**
 * The card's session line, with the interval appended for recurring runs.
 * @param entry - the scheduled run to describe.
 * @param t - the `ui.pages` translator.
 * @returns the rendered meta text.
 */
function cardMeta(entry: ScheduleOverviewEntry, t: (key: PagesLocaleKey) => string): string {
  const base = fill(t('schedule.cardMeta'), {
    session: entry.sessionTitle,
    kind: t(KIND_KEYS[entry.kind] ?? 'schedule.listKindAt'),
  })
  return entry.everySeconds === undefined
    ? base
    : `${base} · ${fill(t('schedule.listEvery'), { seconds: String(entry.everySeconds) })}`
}

/** A pure single-toggle switch in the shell's accent language (no UA chrome). */
function Toggle({ checked, disabled, onToggle, label }: {
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
  readonly label: string
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={css.toggle}
      data-on={checked ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <span className={css.toggleThumb} aria-hidden="true" />
    </button>
  )
}

/**
 * One schedule card: prompt preview, honest pause/resume switch, and the overflow menu.
 * @param props.entry - the scheduled run this card renders.
 * @param props.title - compact first line of the prompt.
 * @param props.toggleLabel - accessible name of the pause/resume switch.
 * @param props.statusText - localized status chip text.
 * @param props.tone - status chip tone.
 * @param props.meta - the session-and-kind line.
 * @param props.menuLabel - accessible name of the overflow trigger.
 * @param props.copyPromptLabel - menu row that copies the task prompt.
 * @param props.menuDeleteLabel - menu row that deletes the task.
 * @param props.pending - a control request for this card is in flight.
 * @param props.menuOpen - this card's copy menu is showing.
 * @param props.copied - a copy from this card succeeded within the last 2s.
 * @param props.copiedLabel - acknowledgement shown while `copied` holds.
 * @param props.onToggle - request the opposite pause state for this card.
 * @param props.onCopy - copy one menu action's text.
 * @param props.onDelete - delete this card's scheduled run.
 * @param props.onMenuOpenChange - open or close this card's menu.
 */
function ScheduleCard({
  entry, title, toggleLabel, statusText, tone, meta, menuLabel, copyPromptLabel, menuDeleteLabel,
  pending, menuOpen, copied, copiedLabel, onToggle, onCopy, onDelete, onMenuOpenChange,
}: {
  readonly entry: ScheduleOverviewEntry
  readonly title: string
  readonly toggleLabel: string
  readonly statusText: string
  readonly tone: StatusTone
  readonly meta: string
  readonly menuLabel: string
  readonly copyPromptLabel: string
  readonly menuDeleteLabel: string
  readonly pending: boolean
  readonly menuOpen: boolean
  readonly copied: boolean
  readonly copiedLabel: string
  readonly onToggle: () => void
  readonly onCopy: (action: 'copy') => void
  readonly onDelete: () => void
  readonly onMenuOpenChange: (open: boolean) => void
}): ReactNode {
  const items: readonly MenuItem[] = [
    { id: 'copy', label: copyPromptLabel },
    { id: 'delete', label: menuDeleteLabel, danger: true, icon: <IconTrashOutlineMedium size={16} /> },
  ]
  return (
    <li className={css.card} data-paused={entry.paused === true ? 'true' : undefined}>
      <div className={css.cardHead}>
        <span className={css.cardTitle} title={entry.prompt}>{title}</span>
        <div className={css.cardActions}>
          <Toggle
            checked={entry.paused !== true}
            disabled={pending}
            onToggle={onToggle}
            label={toggleLabel}
          />
          <Menu
            open={menuOpen}
            onClose={() => { onMenuOpenChange(false) }}
            items={items}
            onSelect={(id) => {
              onMenuOpenChange(false)
              if (id === 'copy') onCopy('copy')
              if (id === 'delete') onDelete()
            }}
            align="end"
            side="bottom"
            portal
            anchor={(
              <button
                type="button"
                className={css.menuBtn}
                disabled={pending}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={menuLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  onMenuOpenChange(!menuOpen)
                }}
              >
                <IconEllipsisOutlineMedium size={16} />
              </button>
            )}
          />
        </div>
      </div>
      <p className={css.cardPreview}>{entry.prompt}</p>
      <div className={css.cardFoot}>
        <span className={css.cardTime}>
          <IconClockOutlineMedium size={14} />
          {formatLocal(entry.scheduledAt)}
        </span>
        <span className={css.chip} data-tone={tone}>{statusText}</span>
      </div>
      <p className={css.note}>{meta}</p>
      {copied ? <p className={css.note} aria-live="polite">{copiedLabel}</p> : null}
    </li>
  )
}

/** Render the schedule page. */
export function SchedulePage({ load, control, remove, t }: SchedulePageProps): ReactNode {
  const [copied, setCopied] = useState<string | null>(null)
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'error'; readonly message: string }
    | { readonly status: 'ready'; readonly overview: ScheduleOverview }
  >({ status: 'loading' })
  const [request, setRequest] = useState(0)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [controlError, setControlError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void load().then(
      (overview) => { if (current) setState({ status: 'ready', overview }) },
      (error: unknown) => { if (current) setState({ status: 'error', message: String(error) }) },
    )
    return () => { current = false }
  }, [load, request])

  /**
   * Swap in fresh overview data after a control request succeeded, keeping the
   * current card wall on screen instead of falling back to the loading state.
   */
  const refresh = (): void => {
    void load().then(
      (overview) => { setState({ status: 'ready', overview }) },
      (error: unknown) => { setControlError(String(error)) },
    )
  }

  /** Request one pause/resume change; the card keeps its reported state until the Remote answers. */
  const toggle = (entry: ScheduleOverviewEntry, key: string): void => {
    setPending(current => new Set(current).add(key))
    setControlError(null)
    void control(entry.sessionId, entry.id, entry.paused === true ? 'resume' : 'pause').then(
      (result) => {
        setPending((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        if (!result.ok) {
          if (result.code === 'schedule_not_found') {
            setControlError(t('schedule.staleCard'))
            refresh()
            return
          }
          setControlError(`${result.code}: ${result.message}`)
          return
        }
        refresh()
      },
      (error: unknown) => {
        setPending((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        setControlError(String(error))
      },
    )
  }

  /** Delete one scheduled run; the card stays on screen until the Remote answers. */
  const removeTask = (entry: ScheduleOverviewEntry, key: string): void => {
    setPending(current => new Set(current).add(key))
    setControlError(null)
    void remove(entry.sessionId, entry.id).then(
      (result) => {
        setPending((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        if (!result.ok) {
          if (result.code === 'schedule_not_found') {
            setControlError(t('schedule.staleCard'))
            refresh()
            return
          }
          setControlError(`${result.code}: ${result.message}`)
          return
        }
        refresh()
      },
      (error: unknown) => {
        setPending((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        setControlError(String(error))
      },
    )
  }

  const copy = (id: string, text: string): void => {
    void writeClipboard(text).then((accepted) => {
      if (!accepted) return
      setCopied(id)
      window.setTimeout(() => { setCopied(current => current === id ? null : current) }, 2000)
    })
  }

  const entries = state.status === 'ready' ? state.overview.entries : []
  const groups = groupEntries(entries)

  return (
    <div className={css.page}>
      <div className={css.pageHead}>
        <div>
          <h2 className={css.title}>{t('schedule.title')}</h2>
          <p className={css.note}>{t('schedule.subtitle')}</p>
        </div>
        <div className={css.headActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutlineMedium />}
            aria-label={t('schedule.refresh')}
            title={t('schedule.refresh')}
            onClick={refresh}
          />
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlusOutlineMedium />}
            onClick={() => { setTemplatesOpen(open => !open) }}
          >
            {templatesOpen ? t('schedule.templatesHide') : t('schedule.create')}
          </Button>
        </div>
      </div>

      {templatesOpen
        ? (
          <section className={css.templates}>
            <pre className={css.code}>{t('schedule.headerFormat')}</pre>
            <ul className={css.list}>
              {TEMPLATES.map(({ id, tag, hint, body }) => (
                <li key={id} className={css.listItem}>
                  <div className={css.row}>
                    <span>
                      <strong>{t(tag)}</strong>
                      {` — ${t(hint)}`}
                    </span>
                    <button type="button" className={css.copy} onClick={() => { copy(id, t(body)) }}>
                      {copied === id ? t('schedule.copied') : t('schedule.copy')}
                    </button>
                  </div>
                  <pre className={css.code}>{t(body)}</pre>
                </li>
              ))}
            </ul>
          </section>
        )
        : null}

      {state.status === 'loading' ? <p className={css.note}>{t('schedule.listLoading')}</p> : null}
      {state.status === 'error'
        ? (
          <p className={css.note} role="alert">
            {fill(t('schedule.listError'), { message: state.message })}
            {' '}
            <button type="button" onClick={() => { setRequest(value => value + 1) }}>{t('data-env.retry')}</button>
          </p>
        )
        : null}
      {controlError === null
        ? null
        : (
          <p className={css.note} role="alert">
            {fill(t('schedule.controlError'), { message: controlError })}
          </p>
        )}

      {state.status === 'ready' && entries.length === 0
        ? <div className={css.empty}>{t('schedule.listEmpty')}</div>
        : null}

      {state.status === 'ready'
        ? groups.map(group => (
          <section key={group.key}>
            <h3 className={css.sectionTitle}>
              {t(group.labelKey)}
              <span className={css.note}>{` · ${group.entries.length}`}</span>
            </h3>
            <ul className={css.grid}>
              {group.entries.map((entry) => {
                const key = `${entry.sessionId}/${entry.id}`
                const status = statusOf(entry)
                const title = promptLine(entry.prompt)
                return (
                  <ScheduleCard
                    key={key}
                    entry={entry}
                    title={title}
                    toggleLabel={fill(
                      t(entry.paused === true ? 'schedule.toggleResume' : 'schedule.togglePause'),
                      { title },
                    )}
                    statusText={t(status.key)}
                    tone={status.tone}
                    meta={cardMeta(entry, t)}
                    menuLabel={t('schedule.menuActions')}
                    copyPromptLabel={t('schedule.menuCopyPrompt')}
                    menuDeleteLabel={t('schedule.menuDelete')}
                    pending={pending.has(key)}
                    menuOpen={openMenu === key}
                    copied={copied === key}
                    copiedLabel={t('schedule.copied')}
                    onToggle={() => { toggle(entry, key) }}
                    onCopy={() => { copy(key, entry.prompt) }}
                    onDelete={() => { removeTask(entry, key) }}
                    onMenuOpenChange={(open) => { setOpenMenu(open ? key : null) }}
                  />
                )
              })}
            </ul>
          </section>
        ))
        : null}

      {state.status === 'ready' && state.overview.unreadable > 0
        ? <p className={css.note}>{fill(t('schedule.listUnreadable'), { count: String(state.overview.unreadable) })}</p>
        : null}
    </div>
  )
}
