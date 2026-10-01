/**
 * ShellLayoutController: the ctx.layout face behind the FinDeck shell.
 * The contract is the one ui-layout declared (imported type-only): sidebar
 * toggle plus the details drawer pair, extended with the right column's
 * presentation pair the right Sidebar reports. Under the new shell the sidebar
 * is a fixed 236px column that collapses by leaving the frame, so toggleSidebar
 * drives that one transition; the details drawer and the right column state live
 * in the root entry's shell store, and writes stay inside the store's declared
 * action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createShellStore } from './stores.ts'

/** The shell store's bound action set (framework-baked, draft params peeled). */
export type ShellActions = BoundActions<ReturnType<typeof createShellStore>>

/**
 * The right column's presentation pair, the part of `ctx.layout` that belongs
 * to this shell rather than to ui-layout's contract: the right Sidebar reports
 * whether its surface is drawn and whether it wants a track, and the shell
 * sizes the column from that. A consumer types the service as
 * `ILayout & RightbarLayoutFace`.
 */
export interface RightbarLayoutFace {
  /**
   * Report the right column's presentation without changing its expanded state.
   * @param track - whether the drawn column reserves a layout track.
   * @param fullscreen - whether it covers the viewport rather than the track.
   */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** Report the right column as hidden: no track, no panel. */
  closeRightbar(): void
}

/**
 * The outward layout face (`ctx.layout`, service name 'layout'): the panel
 * transitions other plugins may trigger. attachActions stays on the concrete
 * class (root-entry assembly only).
 */
export class ShellLayoutController implements ILayout, RightbarLayoutFace {
  #actions: ShellActions | undefined

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook, so the face is live from the entry's first
   * render; on entry re-register the fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's shell store instance.
   */
  attachActions(actions: ShellActions): void {
    this.#actions = actions
  }

  /**
   * Collapse or expand the sidebar column: the same transition the titlebar
   * band's own toggle drives. The column is fixed-width by design, so this
   * hides or shows the whole column rather than shrinking it to a rail.
   */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details drawer (idempotent while open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details drawer. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /**
   * Report the right column's presentation without changing its expanded
   * state; whether that surface is expanded is its occupant's own record.
   * Idempotent while the reported composition is unchanged.
   * @param track - whether the drawn column reserves a layout track.
   * @param fullscreen - whether it covers the viewport rather than the track.
   */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.#require().openRightbar(track, fullscreen)
  }

  /** Report the right column as hidden: no track, no panel. */
  closeRightbar(): void {
    this.#require().closeRightbar()
  }

  /**
   * Navigate the main area to one full-page section (the Models settings
   * page, the Plugins page, …). Idempotent while already open.
   * @param id - the section id to open.
   */
  openSection(id: string): void {
    this.#require().openSection(id)
  }

  #require(): ShellActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#actions === undefined) throw new Error('shell: layout actions not wired (root entry not mounted)')
    return this.#actions
  }
}
