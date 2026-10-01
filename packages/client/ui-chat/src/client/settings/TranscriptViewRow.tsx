/** General Settings row for completed-Turn transcript presentation. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_MODES, type TranscriptViewMode,
} from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side transcript preference face. */
export interface TranscriptViewRowInjected {
  hooks: {
    /** Persisted transcript preference bound as useTranscriptView. */
    transcriptView: SnapshotStore<TranscriptViewMode>
  }
  /** Change the completed-Turn transcript presentation. */
  setTranscriptView: (mode: TranscriptViewMode) => void
}

/** Full Settings-row props. */
export type TranscriptViewRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<TranscriptViewRowInjected>

const LABELS = {
  compact: 'settings.transcript.compact',
  standard: 'settings.transcript.standard',
  detailed: 'settings.transcript.detailed',
  verbose: 'settings.transcript.verbose',
} as const satisfies Record<TranscriptViewMode, ChatKey>

/**
 * Render the completed-Turn transcript mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TranscriptViewRow({ useTranscriptView, setTranscriptView, t }: TranscriptViewRowProps) {
  const mode = useTranscriptView(value => value) ?? DEFAULT_TRANSCRIPT_VIEW_MODE
  return (
    <PreferenceRow
      title={t('settings.transcript.title')}
      description={t('settings.transcript.description')}
      value={mode}
      selectedLabel={t(LABELS[mode])}
      options={TRANSCRIPT_VIEW_MODES.map(id => ({ id, label: t(LABELS[id]) }))}
      onSelect={(value) => { setTranscriptView(value as TranscriptViewMode) }}
    />
  )
}
