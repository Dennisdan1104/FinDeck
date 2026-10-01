/** Chat-only row visibility; durable events and trajectory inspection remain intact. */
import type { ChatNode } from './chat-nodes.ts'

/** Context blocks that report a tool-roster change and keep their notice row. */
function isToolNotice(block: { readonly type?: unknown }): boolean {
  return block.type === 'tool-addition' || block.type === 'tool-removal'
}

/**
 * Exclude system prompts, ordinary Context, and permission commands from visible Chat rows.
 * Context containing tool changes retains its notice row.
 * @param node - projected Chat node.
 * @returns whether the node contributes a visible Chat row.
 */
export function isVisibleChatNode(node: ChatNode): boolean {
  return node.visibility === 'visible'
    && node.kind !== 'system-prompt'
    && (node.kind !== 'context' || node.data.content.some(isToolNotice))
    && !(node.kind === 'command' && node.data.name === 'permission')
}
