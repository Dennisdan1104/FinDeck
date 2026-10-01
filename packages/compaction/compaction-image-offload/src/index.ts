/**
 * Image offload executor for the compaction seam. When an image-capable route
 * fails a request with `IMAGE_OFFLOAD_REQUIRED`, the plugin records one
 * `image/offload` decision selecting the oldest retained input occurrences and
 * retries through the agent error waterfall. Every route sends placeholder text
 * for those occurrences in subsequent requests.
 *
 * @module @deepseek-ai/dsh-compaction-image-offload
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RequestErrorAction } from '@deepseek-ai/dsh-agent'
import { IMAGE_OFFLOAD_REQUIRED_CODE } from '@deepseek-ai/dsh-llm'
import { offloadOldestImages } from './image-offload.ts'
import { imageOffloadProjection } from './projection.ts'

export const name = 'compaction-image-offload'
export const inject = ['agents', 'sessions']

/**
 * Mount the agent recovery listener and register the event's message projection.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  ctx.sessions.registerMessageProjection(imageOffloadProjection)
  ctx.on('agent/request-error', ({ agent, failure }, next): Promise<RequestErrorAction> => {
    if (failure.code !== IMAGE_OFFLOAD_REQUIRED_CODE || failure.offloadImages === undefined) return next()
    // A durable surface repair, not a provider retry: it spends no retry budget and logs no retry event.
    if (!offloadOldestImages(agent.session, agent.session.surface.nodes, failure.offloadImages)) return next()
    return Promise.resolve<RequestErrorAction>({ kind: 'retry' })
  })
}
