/**
 * Durable projection state for dynamic runtime context.
 * @module @deepseek-ai/dsh-agent-loop/runtime-context
 */

import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, ContextSnapshotSection, SystemMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SurfaceIntent, UserMessage } from '@deepseek-ai/dsh-session'
import { isReplacementSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'runtime-context': { kind: 'runtime-context' } & ContextFormed
  }
}

const SOURCE = 'runtime-context'
const CLEARED = 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.'

/** One uncommitted system-prompt surface write. */
export interface SystemPromptCommit {
  /** Rendered prompt, or the empty content that records "no system prompt". */
  message: SystemMessage
  /** `append` for a new head, otherwise a replacement of exactly that head. */
  intent: SurfaceIntent<'system/message'>
}

/** Payload text of one system-role message; `''` for empty content. */
function systemText(message: SystemMessage): string {
  const [block] = message.content
  return message.content.length === 1 && block?.type === 'text' ? block.text : ''
}

/**
 * Owns the rendered system prompt's placement on the model-visible surface
 * without committing it. The first prompt, even an empty one, becomes surface
 * node 0; every later change replaces exactly that protected head, so one
 * system node survives and the prompt never moves past the messages that
 * followed it.
 */
export class SystemPromptProjection {
  /**
   * @param session - session receiving the system node.
   */
  constructor(private readonly session: Session) {}

  /** The current protected head, when the surface already carries one. */
  private head(): { seq: SessionSeq; text: string } | undefined {
    const seq = this.session.surface.nodes[0]
    if (seq === undefined) return undefined
    const event = this.session.eventAt(seq)
    if (event?.type !== 'system/message') return undefined
    return { seq, text: systemText(event.data.message) }
  }

  /**
   * Decide the one surface write that makes `rendered` the effective prompt.
   * @param rendered - the fully rendered system prompt; `''` when none is active.
   * @returns the commit to append, or `undefined` when the head already matches.
   */
  project(rendered: string): SystemPromptCommit | undefined {
    const head = this.head()
    if (head === undefined) {
      return { message: createSystemMessage(rendered), intent: { surfaceOp: 'append' } }
    }
    if (head.text === rendered) return undefined
    return {
      message: createSystemMessage(rendered),
      intent: {
        surfaceOp: { op: 'replace', startSeq: head.seq, endSeq: head.seq },
        sourceEventSeqs: [head.seq],
      },
    }
  }
}

function isOwned(message: UserMessage): boolean {
  return message.source.kind === SOURCE
}

function textOf(message: UserMessage): string | undefined {
  const [block] = message.content
  return message.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

/** Tracks the last retained runtime-context snapshot without owning its commit. */
export class RuntimeContextProjection {
  /** `undefined` means no snapshot ever existed; `null` means none is retained. */
  private retained: { seq: SessionSeq; text: string | undefined } | null | undefined

  /**
   * Restore projection state once, then follow authoritative session events.
   * @param ctx - agent-scoped event context.
   * @param session - session receiving projected messages.
   */
  constructor(ctx: Context, session: Session) {
    const surface = new Set(session.surface.nodes)
    for (let index = session.seq - 1; index >= 0; index -= 1) {
      const event = session.eventAt(SessionSeq(index))
      if (event?.type !== 'user/message' || !isOwned(event.data)) continue
      this.retained ??= null
      if (surface.has(event.seq)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
        break
      }
    }

    ctx.on('session/event', (subject, event) => {
      if (subject !== session) return
      if (event.type === 'user/message' && isOwned(event.data)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
      } else if (this.retained
        && isReplacementSurfaceEvent(event)
        && event.sourceEventSeqs?.includes(this.retained.seq) === true) {
        this.retained = null
      }
    })
  }

  /**
   * Create an uncommitted snapshot only when the retained value differs.
   * @param current - fully rendered dynamic context.
   * @param sections - named contributions that formed the current snapshot.
   * @returns a candidate user message, or `undefined` when no update is needed.
   */
  project(current: string, sections: readonly ContextSnapshotSection[]): UserMessage | undefined {
    if (this.retained === undefined && current.length === 0) return
    const snapshot = current.length === 0 ? CLEARED : current
    if (this.retained?.text === snapshot) return
    return createUserMessage({
      content: [{ type: 'text', text: snapshot }],
      // The cleared marker has no contributions left to attribute.
      source: sections.length === 0
        ? { kind: SOURCE }
        : { kind: SOURCE, form: 'snapshot', sections },
    })
  }
}
