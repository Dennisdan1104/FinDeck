/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import type { ChatViewSlotProps, UseDisclosure } from '../contract/slots.ts'
import { FoldRow } from './FoldRow.tsx'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as a quiet folding row: a single
 * tertiary line whose whole width opens that segment's prose. The opening
 * choice is the seat-bound disclosure, so folding this row's Turn away resets
 * it independently of every other reasoning row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.useDisclosure - seat-bound open state with enclosing-Turn resets.
 * @param props.titleKey - locale key of the row's label.
 * @param props.t - conversation locale seat.
 * @returns the reasoning row.
 */
export function ReasoningRow({ text, running, useDisclosure, titleKey, t }: {
  text: string
  running: boolean
  useDisclosure: UseDisclosure
  titleKey: 'message.think' | 'message.turnProcess.group.title'
  t: ChatViewSlotProps['t']
}) {
  const { expanded, toggle } = useDisclosure()
  return (
    <FoldRow
      variant="quiet"
      label={t(titleKey)}
      summary={running ? latestLine(text) : firstLine(text)}
      summaryEnd={running}
      open={expanded}
      onToggle={toggle}
      t={t}
    >
      <div className={css.thinkBody}>{text}</div>
    </FoldRow>
  )
}
