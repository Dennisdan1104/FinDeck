/**
 * The web provider card's read-only projection over the `web` settings
 * namespace.
 *
 * Which provider serves search and fetch is a deployment decision the running
 * host resolves through the composition and the `settings.yaml` user layer;
 * this card reports the selection in force and offers no control, because
 * changing it from this surface is not a supported operation.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CardShell } from './card-form.ts'

/**
 * Namespace of the web capability's provider selection. Spelled here rather
 * than imported: a client package must not depend on a Host package.
 */
export const WEB_NS = 'web'

/** The selection fields this card reports. */
export interface WebProviderSelection {
  /** Pinned search provider id; absent auto-selects. */
  searchProvider?: string
  /** Pinned fetch provider id; absent auto-selects. */
  fetchProvider?: string
}

/** What the web providers card renders. */
export interface WebProvidersCardState extends CardShell {
  /** Pinned search provider id, or the empty string when none is configured. */
  searchProvider: string
  /** Pinned fetch provider id, or the empty string when none is configured. */
  fetchProvider: string
}

/** The registration-side face the web providers card's slot entry injects. */
export interface WebProvidersCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useWebProvidersCard. */
    webProvidersCard: SnapshotStore<WebProvidersCardState>
  }
}

/** Projects the `web` scope onto the providers card's read-only rows. */
export class WebProvidersCardController {
  private readonly store: SnapshotStore<WebProvidersCardState>

  /** @param scope - the bound settings scope for the `web` namespace. */
  constructor(scope: SettingsScope<WebProviderSelection>) {
    this.store = createSnapshotStore(this.projection(scope.getSnapshot()))
    scope.subscribe(() => { this.store.set(this.projection(scope.getSnapshot())) })
  }

  private projection(snapshot: SettingsScopeSnapshot<WebProviderSelection>): WebProvidersCardState {
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      // Nothing here is drafted, so a save can never be pending.
      dirty: false,
      invalid: false,
      saving: false,
      failed: false,
      searchProvider: snapshot.value?.searchProvider ?? '',
      fetchProvider: snapshot.value?.fetchProvider ?? '',
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot.
   */
  inject(): WebProvidersCardFace {
    return { hooks: { webProvidersCard: this.store } }
  }
}
