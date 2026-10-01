/** The web tools card's staged form over the `tool-web` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, booleanField, numberField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the model-facing web tools. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const TOOL_WEB_NS = 'tool-web'

/** The web-tool fields this card edits. */
export interface WebToolsSettings {
  /** Whether `web_search` is registered for agents. */
  search?: boolean
  /** Whether `web_fetch` is registered for agents. */
  fetch?: boolean
  /** Sources one `web_search` call may return. */
  searchMaxResults?: number
  /** Queries one `web_search` call accepts. */
  searchMaxQueries?: number
  /** Cooperative budget for one `web_search` call, in milliseconds. */
  searchTimeoutMs?: number
  /** Cooperative budget for one `web_fetch` call, in milliseconds. */
  fetchTimeoutMs?: number
  /** Cap on the complete `web_fetch` output, in characters. */
  fetchMaxOutputChars?: number
}

/** What the web tools card renders. */
export interface WebToolsCardState extends CardShell {
  /** Whether `web_search` is registered. */
  search: CardFieldState
  /** Whether `web_fetch` is registered. */
  fetch: CardFieldState
  /** Sources returned per search. */
  searchMaxResults: CardFieldState
  /** Queries accepted per search call. */
  searchMaxQueries: CardFieldState
  /** Search call budget. */
  searchTimeoutMs: CardFieldState
  /** Fetch call budget. */
  fetchTimeoutMs: CardFieldState
  /** Fetch output cap. */
  fetchMaxOutputChars: CardFieldState
}

/** The registration-side face the web tools card's slot entry injects. */
export interface WebToolsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebToolsCard. */
    webToolsCard: SnapshotStore<WebToolsCardState>
  }
}

/** Bridges the `tool-web` scope onto the web tools card's staged form. */
export class WebToolsCardController {
  private readonly form: CardForm<WebToolsSettings>
  private readonly store: SnapshotStore<WebToolsCardState>

  /** @param scope - the bound settings scope for the `tool-web` namespace. */
  constructor(scope: SettingsScope<WebToolsSettings>) {
    this.form = new CardForm(scope, [
      booleanField('search'),
      booleanField('fetch'),
      numberField('searchMaxResults'),
      numberField('searchMaxQueries'),
      numberField('searchTimeoutMs'),
      numberField('fetchTimeoutMs'),
      numberField('fetchMaxOutputChars'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): WebToolsCardState {
    return {
      ...this.form.shell(),
      search: this.form.field('search'),
      fetch: this.form.field('fetch'),
      searchMaxResults: this.form.field('searchMaxResults'),
      searchMaxQueries: this.form.field('searchMaxQueries'),
      searchTimeoutMs: this.form.field('searchTimeoutMs'),
      fetchTimeoutMs: this.form.field('fetchTimeoutMs'),
      fetchMaxOutputChars: this.form.field('fetchMaxOutputChars'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebToolsCardFace {
    return { hooks: { webToolsCard: this.store }, ...this.form.actions() }
  }
}
