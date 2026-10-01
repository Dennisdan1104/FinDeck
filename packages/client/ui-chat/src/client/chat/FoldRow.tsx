/**
 * The one folding row the process area is built from. Every fold in the
 * transcript — a Turn's process segment, a reasoning row, an aggregated action
 * run, the Turn's context injections — is this component in one of two
 * variants, so the shape, the chevron, the fold interaction, and the body
 * container are stated exactly once.
 */

import { memo, useCallback, type ReactNode } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnProcessSegmentState } from '../contract/turn-process.ts'
import { useSearchableHidden } from './searchable-hidden.ts'
import a11yCss from './accessibility.module.css'
import css from './FoldRow.module.css'

type ChatT = ChatViewSlotProps['t']

/**
 * Status prefix a segment prints at its head. In progress and settled both read
 * the product accent — the same blue a flow strip marks the current step with —
 * while a segment in neither state carries a quiet hollow mark.
 */
const SEGMENT_MARKS: Record<TurnProcessSegmentState, string> = {
  running: '⟳',
  done: '✓',
  none: '○',
}

/** Locale key of one segment state's text label, for assistive technology. */
const SEGMENT_STATE_KEYS = {
  running: 'message.turnProcess.group.running',
  done: 'message.turnProcess.group.done',
  none: 'message.turnProcess.group.pending',
} as const satisfies Record<TurnProcessSegmentState, string>

export interface FoldRowProps {
  /**
   * `quiet` is one 12px tertiary process line; `heavy` is a process segment's
   * 13px ink header over the rows it contains.
   */
  readonly variant: 'quiet' | 'heavy'
  /** Row name — or, for an action run, its aggregate counts. */
  readonly label: string
  /** Muted continuation of the label, ellipsized past the column. */
  readonly summary?: string | undefined
  /** Keep the summary pinned to the line's end (a streaming tail). */
  readonly summaryEnd?: boolean | undefined
  /** Primary-coloured running marker prepended to the label. */
  readonly running?: boolean | undefined
  /** Heavy variant: the segment's lifecycle mark and its text label. */
  readonly state?: TurnProcessSegmentState | undefined
  /** Heavy variant: the segment's aggregate counts, after the label. */
  readonly meta?: string | undefined
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
  readonly t: ChatT
  /** The folded body: one member list, one prose block, or one segment's rows. */
  readonly children: ReactNode
}

/**
 * Render one folding row: a header line whose whole width toggles the body it
 * owns. The chevron points right while folded and turns down while open.
 * @param props - row copy, its controlled open state, and its body.
 * @returns the folding row.
 */
export const FoldRow = memo(function FoldRow({
  variant, label, summary, summaryEnd = false, running = false, state, meta, open, onToggle, t, children,
}: FoldRowProps) {
  const reveal = useCallback(() => { onToggle(true) }, [onToggle])
  const bodyRef = useSearchableHidden(!open, reveal)
  const separator = t('message.turnProcess.separator')
  const marked = variant === 'heavy' && state !== undefined
  return (
    <div className={css.row} data-variant={variant} data-open={open || undefined}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        onClick={() => { onToggle(!open) }}
      >
        {marked && (
          <span className={css.segmentMark} data-state={state} aria-hidden>{SEGMENT_MARKS[state]}</span>
        )}
        {marked && <span className={a11yCss.visuallyHidden}>{t(SEGMENT_STATE_KEYS[state])}</span>}
        {running && <span className={css.running}>{t('message.turnProcess.group.running')}</span>}
        {running && <span className={css.sep} aria-hidden>{separator}</span>}
        <span className={css.label}>{label}</span>
        {summary !== undefined && summary !== '' && (
          <>
            <span className={css.sep} aria-hidden>{separator}</span>
            <span className={css.summary} data-follow-end={summaryEnd || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        )}
        {meta !== undefined && meta !== '' && (
          <>
            <span className={css.sep} aria-hidden>{separator}</span>
            <span className={css.meta}>{meta}</span>
          </>
        )}
        <span className={css.toggle} aria-hidden />
      </button>
      <div ref={bodyRef} className={css.body}>{children}</div>
    </div>
  )
})
