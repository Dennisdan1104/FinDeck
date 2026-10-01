/**
 * Chat transcript preferences stored in the Host user-settings document.
 *
 * `TRANSCRIPT_VIEW_MODES` carries the four current modes and is the only set
 * `setMode` writes. `LEGACY_FORK_MODE_MAP` covers the three-mode values this
 * fork persisted before the four-mode rewrite; it is a read-only compatibility
 * layer, so no writer may reintroduce one of its keys, and no later upstream
 * sync may replace the table or the default wholesale.
 *
 * The fork's legacy `normal` means "no folding at all" and maps to `verbose`.
 * Upstream's own legacy table maps `normal` to `standard`, its middle mode; the
 * two meanings are not interchangeable, and substituting upstream's table would
 * silently re-fold every transcript that a fork user set to Normal.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Transcript presentation modes, ordered from least to most process detail. */
export const TRANSCRIPT_VIEW_MODES = ['compact', 'standard', 'detailed', 'verbose'] as const

/** Completed-Turn transcript presentation as this build writes it. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** What a completed Turn shows before any explicit user choice, or after a rejected one. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'standard'

/**
 * Persisted predecessors that name no current mode, each read as the mode it
 * became: `grouped` is what `standard` renders, fork `normal` is the unfolded
 * transcript, and `expanded` describes the same whole-Turn treatment as
 * `detailed`. The third predecessor, `compact`, keeps its name and meaning in
 * the four-mode set, so it is not listed here.
 *
 * The table exists to be read, never written: this build writes only
 * {@link TRANSCRIPT_VIEW_MODES} values.
 */
export const LEGACY_FORK_MODE_MAP = {
  normal: 'verbose',
  grouped: 'standard',
  expanded: 'detailed',
} as const

/** Setting values accepted at settings boundaries: the current modes plus every persisted predecessor. */
export const TRANSCRIPT_VIEW_SETTING_VALUES = [
  ...new Set<string>([...TRANSCRIPT_VIEW_MODES, ...Object.keys(LEGACY_FORK_MODE_MAP)]),
]

/**
 * Durable Chat section shared by the Host schema and browser scope.
 *
 * `transcriptView` is the raw persisted value, which a legacy key may still
 * occupy until the next explicit write; decode it with
 * {@link resolveTranscriptViewMode} rather than reading it as a current mode.
 */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content, possibly a persisted predecessor. */
  transcriptView: string
}

/**
 * Durable Chat schema; also the wire envelope the browser scope validates against.
 *
 * `.loose()` returns this field's default for anything outside
 * {@link TRANSCRIPT_VIEW_SETTING_VALUES} instead of throwing, so one unknown or
 * corrupt value falls back to `standard` and the rest of the section keeps
 * validating; without it the same value would fail the whole `ui-chat` section
 * and the client would treat every Chat preference as unavailable.
 */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_SETTING_VALUES])
    .default(DEFAULT_TRANSCRIPT_VIEW_MODE)
    .loose(),
})

/**
 * Resolve one persisted setting value to the mode this build renders.
 * @param value - raw `transcriptView` value, from the durable section or a wire read.
 * @returns the current mode, a legacy value's mapped mode, or the default.
 */
export function resolveTranscriptViewMode(value: unknown): TranscriptViewMode {
  if ((TRANSCRIPT_VIEW_MODES as readonly string[]).includes(value as string)) {
    return value as TranscriptViewMode
  }
  const mapped = LEGACY_FORK_MODE_MAP[value as keyof typeof LEGACY_FORK_MODE_MAP]
  return mapped ?? DEFAULT_TRANSCRIPT_VIEW_MODE
}
