/**
 * The roundtable history selection, shared between the sidebar history column
 * (writes it) and the page (reads it): the archive row the user is viewing,
 * or null for the live room. A module-level store because the two components
 * mount through separate slot registrations — there is no common parent to
 * hold React state.
 * @module @deepseek-ai/dsh-client-ui-roundtable/client
 */

let selected: string | null = null
const listeners = new Set<() => void>()

/** Select one archive row to view, or null to return to the live room. */
export function selectArchive(id: string | null): void {
  if (selected === id) return
  selected = id
  for (const listener of listeners) listener()
}

/** Subscribe to selection changes; returns the unsubscribe. */
export function subscribeHistory(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

/** The archive row currently viewed, or null for the live room. */
export function selectedArchive(): string | null {
  return selected
}
