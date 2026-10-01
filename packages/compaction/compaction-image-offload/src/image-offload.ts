/** Select and log permanent image omissions in current model-request order. */

import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ImageOffloadTarget } from './projection.ts'

/**
 * Record one decision omitting the oldest retained input-image occurrences.
 * Assistant nodes carry model output and are excluded. Image indexes count
 * every occurrence, including previously offloaded ones, within each message.
 * @param session - session whose next request applies the decision.
 * @param sourceEventSeqs - input message events in the failed request's order.
 * @param count - additional retained occurrences the adapter needs omitted.
 * @returns whether any occurrence remained to offload.
 */
export function offloadOldestImages(session: Session, sourceEventSeqs: readonly SessionSeq[], count: number): boolean {
  const targets: ImageOffloadTarget[] = []
  for (const seq of sourceEventSeqs) {
    if (count === 0) break
    const event = session.eventAt(seq)
    if (event === undefined) continue
    if (event.type !== 'user/message' && event.type !== 'tool/result') continue
    const message = session.deriveEventMessage(event)
    if (message === null) continue
    const imageIndexes: number[] = []
    let imageIndex = 0
    for (const block of message.content) {
      if (count === 0) break
      if (block.type === 'image') {
        if (block.offloaded !== true) {
          imageIndexes.push(imageIndex)
          count -= 1
        }
        imageIndex += 1
      }
    }
    if (imageIndexes.length > 0) targets.push({ seq, imageIndexes })
  }
  if (targets.length === 0) return false
  session.append('image/offload', { targets })
  return true
}
