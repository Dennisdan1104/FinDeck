/**
 * The browser user's display name (sidebar user card): read and written
 * through the existing settings Remote namespace (`user-profile`), registered
 * by the web-app bundle's runtime glue. A profile the host does not register
 * reports the namespace's own failure, and the card falls back to the
 * localized default without blocking the shell.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The settings namespace key the web-app bundle registers. */
export const USER_PROFILE_NAMESPACE = 'user-profile'

/** User-profile snapshot the sidebar card subscribes to. */
export interface UserProfileState {
  /** Load lifecycle: idle before the first load, ready once the host answered. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The display name; empty renders the localized default. */
  displayName: string
  /** Standing read failure, if the host could not be reached. */
  error: string | null
  /** A rename is in flight. */
  busy: boolean
}

const INITIAL: UserProfileState = {
  status: 'idle', displayName: '', error: null, busy: false,
}

/** Read the display name out of the namespace's redacted value. */
function displayNameOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const candidate = (value as Record<string, unknown>)['displayName']
  return typeof candidate === 'string' ? candidate : ''
}

/** Drives the sidebar card's name over the settings Remote namespace. */
export class UserProfileController {
  /** Card snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<UserProfileState> = createSnapshotStore(INITIAL)

  constructor(private readonly ctx: ClientContext) {}

  private set(patch: Partial<UserProfileState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the profile once. A host without the namespace reports its own
   * diagnostic and the card stays on the localized default.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    this.set({ status: 'loading', error: null })
    const result = await this.ctx.remote.settings.describe()
    if (!result.ok) {
      this.set({ status: 'error', displayName: '', error: result.error.message })
      return
    }
    const section = result.value.namespaces.find(namespace => namespace.ns === USER_PROFILE_NAMESPACE)
    this.set({
      status: 'ready',
      displayName: section === undefined ? '' : displayNameOf(section.value),
      error: null,
    })
  }

  /**
   * Rename the user, persisting through the settings namespace.
   * @param name - the requested display name (trimmed; empty is refused).
   * @returns the failure text, or undefined once the write landed.
   */
  async rename(name: string): Promise<string | undefined> {
    const trimmed = name.trim()
    if (trimmed === '') return undefined
    if (this.store.getSnapshot().busy) return undefined
    this.set({ busy: true })
    const result = await this.ctx.remote.settings.update(
      USER_PROFILE_NAMESPACE,
      { displayName: trimmed },
      undefined,
    )
    if (!result.ok) {
      this.set({ busy: false })
      return `${result.error.message} (${result.error.code})`
    }
    // The remote already committed the merge; the value this card shows is
    // the value it wrote, without waiting for a round trip.
    this.set({ busy: false, displayName: trimmed })
    return undefined
  }
}
