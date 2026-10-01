/** Host-backed completed-Turn transcript presentation policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD, resolveTranscriptViewMode,
  type ChatSettings, type TranscriptViewMode,
} from '../chat-settings.ts'

/** Live transcript preference consumed by Chat and its Settings row. */
export class TranscriptViewPolicy {
  /** Reactive current mode; defaults to the standard transcript before Host settings arrive. */
  readonly mode: SnapshotStore<TranscriptViewMode> = createSnapshotStore(DEFAULT_TRANSCRIPT_VIEW_MODE)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param mode - current transcript presentation mode.
   */
  setMode(mode: TranscriptViewMode): void {
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host.set(TRANSCRIPT_VIEW_FIELD, mode)
  }

  /**
   * Adopt the latest accepted Host section without writing it back: a persisted
   * predecessor key is mapped to its current mode in memory and reaches the
   * durable field on the next {@link setMode} only.
   */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const mode = resolveTranscriptViewMode(section[TRANSCRIPT_VIEW_FIELD])
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
  }
}
