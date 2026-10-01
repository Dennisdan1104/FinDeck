/**
 * The file chip a process range presents, and the counts line the process rows
 * summarize with. Every fold here is the shared {@link FoldRow}.
 */

import { memo } from 'react'
import { relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type {
  TurnProcessFileChange, TurnProcessToolCounts, TurnProcessToolFamily,
} from '../contract/turn-process.ts'
import css from './TurnProcessRows.module.css'

type ChatT = ChatViewSlotProps['t']

/** Locale key stem of one aggregate family. */
const FAMILY_KEYS = {
  browse: 'message.turnProcess.group.segment.browse',
  webSearch: 'message.turnProcess.group.segment.webSearch',
  webFetch: 'message.turnProcess.group.segment.webFetch',
  shell: 'message.turnProcess.group.segment.shell',
  fileWrite: 'message.turnProcess.group.segment.fileWrite',
  subagent: 'message.turnProcess.group.segment.subagent',
  other: 'message.turnProcess.group.segment.other',
} as const satisfies Record<TurnProcessToolFamily, string>

/** Aggregate families in the order their segments are listed. */
const FAMILY_ORDER: readonly TurnProcessToolFamily[] = [
  'browse', 'webSearch', 'webFetch', 'shell', 'fileWrite', 'subagent', 'other',
]

function familyKey(family: TurnProcessToolFamily, count: number): Parameters<ChatT>[0] {
  const suffix = count === 1 ? 'one' : 'other'
  return `${FAMILY_KEYS[family]}.${suffix}`
}

/**
 * Render one aggregate counts line, omitting zero-valued families.
 * @param counts - aggregated Tool-call families.
 * @param t - Chat locale seat.
 * @returns the joined segments, or an empty string when nothing was counted.
 */
export function countsLine(counts: TurnProcessToolCounts, t: ChatT): string {
  const segments: string[] = []
  for (const family of FAMILY_ORDER) {
    const count = counts[family]
    if (count > 0) segments.push(t(familyKey(family, count), { count }))
  }
  return segments.join(t('message.turnProcess.group.countsSeparator'))
}

/**
 * One file mutation as its path chip, carrying the argument-derived line counts
 * the diff it stands for would change.
 * @param props.file - projected file mutation.
 * @param props.cwd - workspace root the chip path relativizes against.
 * @param props.onOpen - open the path with the host default application.
 * @param props.t - Chat locale seat for the added/removed labels.
 * @returns the chip.
 */
export const TurnProcessFileChip = memo(function TurnProcessFileChip({
  file, cwd, onOpen, t,
}: {
  file: TurnProcessFileChange
  cwd: string | undefined
  onOpen: (path: string) => void
  t: ChatT
}) {
  return (
    <button
      type="button"
      className={css.chip}
      data-state={file.state}
      title={file.path}
      onClick={() => { onOpen(file.path) }}
    >
      <span className={css.chipPath}>{relativizeToCwd(file.path, cwd)}</span>
      <span className={css.chipAdded}>{t('message.turnProcess.group.fileAdded', { added: file.added })}</span>
      <span className={css.chipRemoved}>{t('message.turnProcess.group.fileRemoved', { removed: file.removed })}</span>
    </button>
  )
})
