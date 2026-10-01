/**
 * ui-shell contracts. This package is the FinDeck root shell (UI rebuild):
 * its 'root' registration replaces ui-layout's three-column AppFrame and
 * ui-sidebar's navigation column in the web profile (both rows are disabled
 * there; a profile mounting both shells fails loud on the child-slot
 * declaration conflict, which is the design speaking).
 *
 * The shell re-declares the occupant-facing holes the replaced entries owned
 * — 'conversation' and 'details' plus 'shell.overlay' (typed by ui-layout's
 * SlotMap merge, pulled in type-only below) and 'sidebar.workspaces' (typed
 * by ui-sidebar's merge) — so the shipped occupants (ui-conversation,
 * ui-chat's DetailsPanel, ui-workspace's browser) mount unchanged under the
 * new chrome. It contributes the full-page hole
 * 'shell.page', occupied by the settings domain's page host
 * (ui-settings-general), which renders one `settings.section` entry as a
 * page — the page-navigation IA that replaces the settings modal — and the
 * right-column hole 'shell.rightbar', occupied by the right Sidebar
 * (ui-sidebar-right), which draws the docking surface beside the conversation
 * and reports its own presentation back through `ctx.layout`.
 */
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One non-conversation main-area page, rendered full-page by the shell
     * (no dialog, no drawer). OCCUPIED by ui-settings-general's page host,
     * which resolves the requested `settings.section` id and renders that
     * entry's content; the section registry itself stays owned by the
     * settings domain. Declared by this package's 'root' entry.
     */
    'shell.page': { kind: 'single'; scope: 'root'; owner: ShellPageOwnerProps }
    /**
     * Per-section sidebar content, keyed by the `settings.section` id. When
     * the active section registered an entry here, the sidebar renders that
     * entry INSTEAD of the workspaces browsing region — a page that owns a
     * body of its own (the roundtable's archive history) replaces the
     * project list for as long as it is open. Sections without an entry keep
     * the workspaces region. Declared by this package's 'root' entry.
     */
    'sidebar.section': { kind: 'list'; scope: 'root' }
    /**
     * The right column beside the conversation: a track the shell makes room
     * for, or nothing. OCCUPIED by ui-sidebar-right, which draws the docking
     * surface at the resolved width and covers the viewport while its own
     * fullscreen presentation is on.
     *
     * Whether the column is shown, and whether it takes a track, is the
     * occupant's own recorded business — it reports the composition of its
     * expanded and presentation state through `ctx.layout`, and the shell
     * sizes the track from that. The root occupant renders its own
     * Session-bound content. Declared by this package's 'root' entry.
     */
    'shell.rightbar': { kind: 'single'; scope: 'root'; owner: ShellRightbarOwnerProps }
  }
}

/** Owner share of the page hole: which section page to show, plus the shell's leave-page affordance. */
export interface ShellPageOwnerProps {
  /** The `settings.section` id whose content the page shows (e.g. 'models', 'roundtable'). */
  sectionId: string
  /** Leave the page for the conversation; handed to sections that finish a flow. */
  close: () => void
  /**
   * Whether the shell lays this page out full-bleed: no centered page column,
   * and the page spans the main area under the chrome bar with the page itself
   * owning scrolling (a room-style surface such as the roundtable). Every
   * other section keeps the document-style centered column.
   */
  fullBleed: boolean
}

/** Owner share of the right column: resolved width and opening eligibility. */
export interface ShellRightbarOwnerProps {
  /** Resolved panel width in px, not the saved preference. */
  width: number
  /** Current frame width in px. */
  viewportWidth: number
  /**
   * Whether a normal right panel can retain its width beside the sidebar and a
   * conversation-wide centre. False on a viewport too narrow to show one.
   */
  canShow: boolean
}
