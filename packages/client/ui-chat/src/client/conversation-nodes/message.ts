import type { Context } from '@deepseek-ai/cordis'
import type {
  ContextMessageNode, ConversationNodeDefinition, SteeringMessageNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { InboxState } from './inbox.ts'
import { chatNode } from './common.ts'
import { contextForm, contextProvenance } from './event-projection.ts'

interface ReferencedUserMessageNode extends UserMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
  /** Skill names the same step's `skill-invocation` injections loaded. */
  readonly skillNames?: readonly string[]
}

interface ReferencedSteeringMessageNode extends SteeringMessageNode {
  /** Labels cited by the immediately following session-reference context. */
  readonly referenceLabels?: readonly string[]
  /** Skill names the same step's `skill-invocation` injections loaded. */
  readonly skillNames?: readonly string[]
}

type MessageNode = ReferencedUserMessageNode | ReferencedSteeringMessageNode | ContextMessageNode

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Ordinary turn-opening user message. */
    user: ReferencedUserMessageNode
    /** User message admitted into an active turn. */
    steering: ReferencedSteeringMessageNode
    /** Non-user context injected into model history. */
    context: ContextMessageNode
  }
}

function isCompactionCheckpoint(event: Parameters<ConversationNodeDefinition['match']>[0]): boolean {
  if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) return false
  const source = event.data.source as { kind?: unknown }
  return source.kind === 'compact-checkpoint'
}

/** Context presentation shared by user-role injections and developer messages. */
function contextMessage(
  event: Pick<ContextMessageNode, 'seq' | 'time'>,
  message: Pick<ContextMessageNode, 'content' | 'source'>,
): ContextMessageNode {
  return {
    kind: 'context',
    seq: event.seq,
    time: event.time,
    content: message.content,
    source: message.source,
    provenance: contextProvenance(message.source),
    form: contextForm(message.source),
  }
}

/** User, steering, and injected-context message classification Definition. */
export const messageDefinition: ConversationNodeDefinition<MessageNode> = {
  kind: 'input-message',
  target: 'chat',
  match: event => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && !isCompactionCheckpoint(event)
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match, reader) => {
    if (match.event.type !== 'user/message') throw new Error('input-message start requires user/message')
    const event = match.event
    if (event.data.source.kind !== 'user') return contextMessage(event, event.data)
    const claimed = reader.previous<InboxState>('inbox-next-step')
      ?.state.currentClaimed.has(String(event.data.id)) === true
    return claimed
      ? {
        kind: 'steering',
        messageId: event.data.id,
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
      : {
        kind: 'user',
        seq: event.seq,
        time: event.time,
        content: event.data.content,
        source: event.data.source,
      }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return chatNode(context, context.state.kind, context.state.seq, context.state)
  },
}

/** Developer history uses the input-message lifecycle and context presentation. */
export const developerMessageDefinition: ConversationNodeDefinition<MessageNode> = {
  ...messageDefinition,
  kind: 'developer-message',
  match: event => event.type === 'developer/message'
    ? { id: String(event.data.message.id), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'developer/message') throw new Error('developer-message start requires developer/message')
    return contextMessage(event, event.data.message)
  },
}

/**
 * Register the user, steering, injected-context, and developer message contributions.
 * @param ctx - owning UI Conversation context.
 */
export function registerMessageConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(messageDefinition)
  ctx.uiConversation.events.register(developerMessageDefinition)
}
