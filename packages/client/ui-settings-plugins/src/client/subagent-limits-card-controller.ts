/**
 * Staged delegation limits backed by the Host's `subagent` settings section.
 *
 * Adapted from the upstream `subagent-limits-card-controller` (`845115d0f8`),
 * which the fork's card-form, scope, and slot contract already satisfy; only the
 * imports differ. Each limit is validated against the range the Host's own
 * schema asserts, so an out-of-range draft blocks the save instead of being
 * sent for the Host to refuse.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, numberField,
  type CardActions, type CardFieldSpec, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the subagent capability. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const SUBAGENT_NS = 'subagent'

/** Host-owned delegation defaults and live capacity. */
export interface SubagentLimitsSettings {
  /** Default delegation depth for tools without an explicit limit. */
  maxDepth: number
  /** Maximum live children sharing uninterrupted continuable parent links. */
  maxActiveSubagents: number
}

/** What the delegation limits card renders. */
export interface SubagentLimitsCardState extends CardShell {
  /** Default delegation depth. */
  maxDepth: CardFieldState
  /** Live continuable-child capacity. */
  maxActiveSubagents: CardFieldState
}

/** The registration-side face the limits card's slot entry injects. */
export interface SubagentLimitsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useSubagentLimitsCard. */
    subagentLimitsCard: SnapshotStore<SubagentLimitsCardState>
  }
}

/**
 * A whole-number limit that admits only safe integers at or above its minimum.
 * The schema asserts the same bound Host-side; checking it here keeps an
 * unsendable draft on screen instead of turning it into a refused write.
 * @param field - field name inside the namespace section.
 * @param minimum - smallest accepted value.
 * @returns the field's conversion spec.
 */
function limitField(field: keyof SubagentLimitsSettings, minimum: number): CardFieldSpec {
  const numeric = numberField(field)
  return {
    ...numeric,
    parse: (text) => {
      const write = numeric.parse(text)
      if (write?.kind !== 'set') return write
      const value = write.value as number
      return Number.isSafeInteger(value) && value >= minimum && !Object.is(value, -0) ? write : undefined
    },
  }
}

/** Bridges the `subagent` scope onto the delegation limits card's staged form. */
export class SubagentLimitsCardController {
  private readonly form: CardForm<SubagentLimitsSettings>
  private readonly store: SnapshotStore<SubagentLimitsCardState>

  /** @param scope - the bound settings scope for the `subagent` namespace. */
  constructor(scope: SettingsScope<SubagentLimitsSettings>) {
    this.form = new CardForm(scope, [limitField('maxDepth', 0), limitField('maxActiveSubagents', 1)])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SubagentLimitsCardState {
    return {
      ...this.form.shell(),
      maxDepth: this.form.field('maxDepth'),
      maxActiveSubagents: this.form.field('maxActiveSubagents'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): SubagentLimitsCardFace {
    return { hooks: { subagentLimitsCard: this.store }, ...this.form.actions() }
  }
}
