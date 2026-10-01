/** The web fetch transport card's staged form over the `web-fetch-http` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the local HTTP fetch provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_FETCH_HTTP_NS = 'web-fetch-http'

/** The fetch-transport fields this card edits. */
export interface WebFetchSettings {
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default retrieval timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum same-origin redirect hops followed. */
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
}

/** What the web fetch card renders. */
export interface WebFetchCardState extends CardShell {
  /** Response byte cap. */
  maxResponseBytes: CardFieldState
  /** Decoded character cap. */
  maxBodyChars: CardFieldState
  /** Retrieval timeout. */
  timeoutMs: CardFieldState
  /** Redirect hop cap. */
  maxRedirects: CardFieldState
  /** Request `User-Agent`. */
  userAgent: CardFieldState
}

/** The registration-side face the web fetch card's slot entry injects. */
export interface WebFetchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebFetchCard. */
    webFetchCard: SnapshotStore<WebFetchCardState>
  }
}

/** Bridges the `web-fetch-http` scope onto the fetch transport card's staged form. */
export class WebFetchCardController {
  private readonly form: CardForm<WebFetchSettings>
  private readonly store: SnapshotStore<WebFetchCardState>

  /** @param scope - the bound settings scope for the `web-fetch-http` namespace. */
  constructor(scope: SettingsScope<WebFetchSettings>) {
    this.form = new CardForm(scope, [
      numberField('maxResponseBytes'),
      numberField('maxBodyChars'),
      numberField('timeoutMs'),
      numberField('maxRedirects'),
      textField('userAgent'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WebFetchCardState {
    return {
      ...this.form.shell(),
      maxResponseBytes: this.form.field('maxResponseBytes'),
      maxBodyChars: this.form.field('maxBodyChars'),
      timeoutMs: this.form.field('timeoutMs'),
      maxRedirects: this.form.field('maxRedirects'),
      userAgent: this.form.field('userAgent'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebFetchCardFace {
    return { hooks: { webFetchCard: this.store }, ...this.form.actions() }
  }
}
