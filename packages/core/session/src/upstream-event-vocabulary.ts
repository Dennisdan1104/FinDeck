/**
 * Session event types absent from this build's own vocabulary that its
 * persistence read path still registers: the names upstream dsh 0.1.6 and
 * 0.1.7 declare and this fork does not produce or interpret, plus the
 * pre-rename `tool/code-dispatch*` spellings this fork published before the PTC
 * vocabulary rename.
 *
 * The storage read path refuses a log containing an event type that is absent
 * from `KNOWN_SESSION_EVENT_TYPES` unless the event carries `ignorable: true`
 * (`@deepseek-ai/dsh-session-persistence/storage-contract`). A log written by a
 * newer upstream harness, or by an earlier build of this fork, that appends any
 * event below would otherwise be refused outright, so the names are registered
 * here against payloads that stay inside this package's existing dependencies:
 * the parts owned by packages this fork has not ported are declared as
 * `JsonValue` rather than imported.
 *
 * Registering a name does NOT enable the upstream behavior. The legacy
 * `tool/code-dispatch*` entries are read-only: this build appends
 * `tool/ptc-dispatch*`, and the v2→v3 migration edge renames the old spellings
 * when it reads the released V2 generation that carries them, so the two names
 * never appear side by side in one generation.
 *
 * This module is deliberately not re-exported from the package index: no code
 * here appends or reads these events, and loading the augmentation everywhere
 * would force every `SessionEventType` switch in the workspace to handle events
 * this build never writes. When an event below is actually ported, its owning
 * package must declare the member itself and the entry here must be deleted —
 * `SessionEventMap` members are unique across merges.
 * @module @deepseek-ai/dsh-session/upstream-event-vocabulary
 */

// SessionId and SessionSeq are NOT imported: inside a module augmentation they
// resolve to the augmented module's own exports, so an import of them here is
// reported as unused.
import type { ContentBlock, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Upstream's log-only record of one message-feedback creation or edit.
     * Registered only: this build's message feedback still lives in its sidecar
     * store, so the feedback item is declared as an opaque JSON value rather
     * than importing the feedback package into the session core.
     */
    'feedback/message-put': { sessionId: SessionId; item: JsonValue }
    /**
     * Upstream's log-only record of one message-feedback deletion; earlier
     * values remain in the log. Registered only, like
     * `feedback/message-put`.
     */
    'feedback/message-delete': { sessionId: SessionId; messageId: MessageId }
    /**
     * LEGACY NAME, read-only: the pre-rename spelling of
     * `tool/ptc-dispatch-start`, written by released V2 sessions before the PTC
     * vocabulary rename (upstream `bad4254d71`). This fork has published logs
     * carrying it, so the name stays registered for the read path of that
     * released generation; this build never appends it, the v2→v3 edge renames
     * it on the way to V3, and the payload fields mirror the current
     * `tool/ptc-dispatch-start` so a projection folding both spellings narrows
     * once. Upstream renamed the durable name with a format migration; this fork
     * does the same in its own v2→v3 edge, so the old spelling survives only in
     * the V2 generation.
     * @deprecated Append `tool/ptc-dispatch-start`; this name is read-only legacy.
     */
    'tool/code-dispatch-start': {
      rootCallId: ToolCallId
      parentCallId: ToolCallId
      subCallId: ToolCallId
      name: string
      arguments: unknown
    }
    /**
     * LEGACY NAME, read-only: the pre-rename spelling of `tool/ptc-dispatch`,
     * registered and deprecated for the same reason as
     * `tool/code-dispatch-start`, with the same field choice.
     * @deprecated Append `tool/ptc-dispatch`; this name is read-only legacy.
     */
    'tool/code-dispatch': {
      rootCallId: ToolCallId
      parentCallId: ToolCallId
      subCallId: ToolCallId
      name: string
      arguments: unknown
      isError: boolean
      content: ContentBlock[]
      error?: { name: string; code: string; reason?: string }
    }
  }
}
