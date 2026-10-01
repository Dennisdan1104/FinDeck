/**
 * The root entry's shell store: page navigation, the settings dialog, the
 * chrome toggles, and the right column's reported presentation.
 * The route is one `section` fact — the `settings.section` id of the active
 * full page, `undefined` for the conversation — with the roundtable surface
 * derived from it ('roundtable' is the section the roundtable tab shows).
 * The settings dialog is a second viewing state of its own: the sidebar's
 * bottom entry opens it directly (no intermediate collapse), and the id it
 * shows is stored so reopening returns to the section last seen.
 * The right column's four facts are derived chrome, not a source of truth:
 * whether its surface is expanded belongs to that surface's own store, and
 * the occupant reports the composition here so the frame can size the track.
 * Module level exports the factory only; register() receives the factory and
 * the framework instantiates per entry.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Contract default width of the right column, used until its first opening. */
export const RIGHTBAR_DEFAULT_WIDTH = 420

/**
 * Settings section the dialog opens on before the user picks another one: the
 * settings domain's General section, which every composition registers.
 */
const SETTINGS_DEFAULT_SECTION = 'general'

/** Shell store state (all viewing state; no business data). */
export type ShellState = {
  /** Active full-page `settings.section` id; undefined renders the conversation. */
  section: string | undefined
  /** Whether the sidebar column is collapsed out of the frame. */
  sidebarCollapsed: boolean
  /** Whether the settings dialog is open over the frame. */
  settingsOpen: boolean
  /** The `settings.section` page the settings dialog shows. */
  settingsSection: string
  /** Whether the right details drawer is open. */
  detailsOpen: boolean
  /** Whether the right column is drawn at all, in either presentation. */
  rightbarShown: boolean
  /**
   * Whether the drawn right column reserves a layout track. Reported by its
   * occupant; always false while hidden.
   */
  rightbarTrack: boolean
  /** Reported fullscreen presentation of the right column. */
  rightbarFullscreen: boolean
  /** Saved right column width in px, or null before its first opening. */
  rightbarWidth: number | null
  /** Last measured frame width in px; bootstraps the first render. */
  viewportWidth: number
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type ShellActions = {
  openSection: (draft: ShellState, id: string) => void
  showConversation: (draft: ShellState) => void
  toggleSidebar: (draft: ShellState) => void
  openSettings: (draft: ShellState) => void
  closeSettings: (draft: ShellState) => void
  selectSettingsSection: (draft: ShellState, id: string) => void
  openDetails: (draft: ShellState) => void
  closeDetails: (draft: ShellState) => void
  openRightbar: (draft: ShellState, track: boolean, fullscreen: boolean) => void
  closeRightbar: (draft: ShellState) => void
  setViewportWidth: (draft: ShellState, width: number) => void
}

/**
 * Create the shell store handle. Actions are the complete write set: page
 * navigation (opening a section replaces the conversation view; returning to
 * the conversation clears it), the sidebar collapse toggle, the settings
 * dialog's open/close pair plus the section it shows, the details drawer's
 * open/close pair, the right column's reported presentation, and the frame
 * measurement its owner share resolves against.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createShellStore(): EngineStoreHandle<ShellState, ShellActions> {
  return defineStore({
    init: (): ShellState => ({
      section: undefined,
      sidebarCollapsed: false,
      settingsOpen: false,
      settingsSection: SETTINGS_DEFAULT_SECTION,
      detailsOpen: false,
      rightbarShown: false,
      rightbarTrack: false,
      rightbarFullscreen: false,
      rightbarWidth: null,
      viewportWidth: window.innerWidth,
    }),
    actions: {
      openSection: (d, id: string) => { d.section = id },
      showConversation: (d) => { d.section = undefined },
      toggleSidebar: (d) => { d.sidebarCollapsed = !d.sidebarCollapsed },
      openSettings: (d) => { d.settingsOpen = true },
      closeSettings: (d) => { d.settingsOpen = false },
      selectSettingsSection: (d, id: string) => { d.settingsSection = id },
      openDetails: (d) => { d.detailsOpen = true },
      closeDetails: (d) => { d.detailsOpen = false },
      // The occupant reports its own presentation; the first opening mints the
      // saved width, which later closings preserve.
      openRightbar: (d, track, fullscreen) => {
        d.rightbarWidth ??= RIGHTBAR_DEFAULT_WIDTH
        d.rightbarShown = true
        d.rightbarTrack = track
        d.rightbarFullscreen = fullscreen
      },
      closeRightbar: (d) => {
        d.rightbarShown = false
        d.rightbarTrack = false
        d.rightbarFullscreen = false
      },
      setViewportWidth: (d, width) => { d.viewportWidth = width },
    },
  })
}
