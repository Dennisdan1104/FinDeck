/**
 * Skills settings page store: one snapshot joining the Host's skill
 * administration inventory with the bound `skills` settings namespace's
 * writability, plus the lazily loaded slices the other tabs read (gallery,
 * external roots, forge sessions) and the editor's loaded document. The Host
 * stays the single fact source — every mutation writes through the wire and
 * answers with the whole inventory, so the page re-renders from one accepted
 * response instead of folding a delta.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  RemoteResult, SessionsAdminEntry, SkillAdminEntry, SkillDetail,
  SkillExternalRoot, SkillGalleryEntry, SkillSaveRequest,
} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the `ctx.sessions` merge the forge hand-off drives.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/**
 * Settings namespace owning the durable disable list. Its Host owner is
 * `@deepseek-ai/dsh-api-skills-controller`; this page reads the same namespace
 * through `ctx.settingsScope` for the one fact the inventory cannot carry —
 * whether this browser may write it at all.
 */
export const SKILLS_SETTINGS_NAMESPACE = 'skills'

/** The durable section this page's namespace holds, as the browser reads it. */
export interface SkillsSettingsSection {
  /** Skill names suppressed from every registry read. */
  readonly disabled: readonly string[]
}

/** One lazily loaded tab slice's load cycle. */
export interface SkillsSliceState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Slice-load failure text. */
  error: string | null
}

/** Gallery tab slice. */
export interface SkillsGalleryState extends SkillsSliceState {
  entries: readonly SkillGalleryEntry[]
}

/** Import tab slice. */
export interface SkillsExternalState extends SkillsSliceState {
  roots: readonly SkillExternalRoot[]
}

/** Create-from-sessions tab slice. */
export interface SkillsForgeState extends SkillsSliceState {
  sessions: readonly SessionsAdminEntry[]
}

/** The inline skill editor's state. */
export interface SkillEditorState {
  /** Whether the editor card is rendered. */
  open: boolean
  /** Create mode when true, view/edit mode when false. */
  create: boolean
  /** The skill being viewed or edited; empty in create mode. */
  name: string
  /** Whether the `read` call is still in flight. */
  loading: boolean
  /** Save or load failure text shown inside the editor. */
  error: string | null
  /** The loaded document; null in create mode and while loading. */
  detail: SkillDetail | null
}

/** Page snapshot. */
export interface SkillsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load or whole-write failure text. */
  error: string | null
  /** Whether the Host document accepts writes for this namespace. */
  writable: boolean
  /** Every discovered skill, suppressed ones included, name-sorted by the Host. */
  entries: readonly SkillAdminEntry[]
  gallery: SkillsGalleryState
  external: SkillsExternalState
  forge: SkillsForgeState
  /**
   * The frame-wide create-from-sessions dialog, opened by the composer's
   * skill-forge mode pick; the same picker the page's own tab renders.
   */
  forgeDialog: { open: boolean }
  editor: SkillEditorState
}

/** The forge session picker lists at most this many sessions, newest first. */
const FORGE_SESSION_LIMIT = 50

/** The skills settings page controller (one per settings surface). */
export class SkillsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<SkillsSettingsState> = createSnapshotStore<SkillsSettingsState>({
    status: 'idle', error: null, writable: false, entries: [],
    gallery: { status: 'idle', error: null, entries: [] },
    external: { status: 'idle', error: null, roots: [] },
    forge: { status: 'idle', error: null, sessions: [] },
    forgeDialog: { open: false },
    editor: { open: false, create: false, name: '', loading: false, error: null, detail: null },
  })

  /** Latest accepted inventory answer wins; a superseded response never overwrites a newer one. */
  private generation = 0

  /** Per-slice latest-answer-wins counters, independent from the inventory's. */
  private galleryGeneration = 0
  private externalGeneration = 0
  private forgeGeneration = 0
  private editorGeneration = 0

  /**
   * @param ctx - the page plugin's context, whose `remote.skillsAdmin`
   * namespace carries the inventory and management calls and whose
   * `remote.sessionsAdmin` namespace feeds the forge session picker.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Adopt the bound namespace scope's writability, so a read-only document or a
   * process-local browser disables every toggle instead of failing on submit.
   * @param writable - whether the Host accepts writes for this namespace.
   */
  adoptWritable(writable: boolean): void {
    this.store.update((state) => { state.writable = writable })
  }

  /**
   * Refresh the whole inventory.
   * @returns settlement after the answer is published either way.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    this.publish(generation, await this.ctx.remote.skillsAdmin.list())
  }

  /**
   * Store one skill's suppressed state.
   * @param name - skill name the disable list stores.
   * @param disabled - whether the skill becomes hidden from every consumer.
   * @returns the failure message, or undefined once the Host accepted the write.
   */
  async setDisabled(name: string, disabled: boolean): Promise<string | undefined> {
    const generation = ++this.generation
    const response = await this.ctx.remote.skillsAdmin.setDisabled(name, disabled)
    this.publish(generation, response)
    return response.ok ? undefined : response.error.message
  }

  /**
   * Drop the registry's cached catalogs and republish what discovery answers.
   * @returns the failure message, or undefined once the inventory was republished.
   */
  async rescan(): Promise<string | undefined> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    const response = await this.ctx.remote.skillsAdmin.reload()
    this.publish(generation, response)
    return response.ok ? undefined : response.error.message
  }

  /** Open the editor in create mode with every field empty. */
  openCreate(): void {
    ++this.editorGeneration
    this.store.update((state) => {
      state.editor = { open: true, create: true, name: '', loading: false, error: null, detail: null }
    })
  }

  /**
   * Open the editor on one skill's document, read from the Host so an edit
   * preserves what the loaded catalog cannot carry.
   * @param name - the skill to view or edit.
   */
  async openEdit(name: string): Promise<void> {
    const generation = ++this.editorGeneration
    this.store.update((state) => {
      state.editor = { open: true, create: false, name, loading: true, error: null, detail: null }
    })
    const response = await this.ctx.remote.skillsAdmin.read(name)
    if (generation !== this.editorGeneration) return
    this.store.update((state) => {
      state.editor.loading = false
      if (response.ok) state.editor.detail = response.value
      else state.editor.error = response.error.message
    })
  }

  /** Close the editor and discard its loaded document. */
  closeEditor(): void {
    ++this.editorGeneration
    this.store.update((state) => {
      state.editor = { open: false, create: false, name: '', loading: false, error: null, detail: null }
    })
  }

  /**
   * Save the editor's fields through `create` or `update`. A success closes
   * the editor and publishes the answered inventory; a failure keeps the
   * editor open with the Host's message.
   * @param request - the editor's field values.
   * @param create - whether this is a new skill.
   */
  async save(request: SkillSaveRequest, create: boolean): Promise<void> {
    const generation = ++this.generation
    const response = create
      ? await this.ctx.remote.skillsAdmin.create(request)
      : await this.ctx.remote.skillsAdmin.update(request)
    if (response.ok) {
      this.publish(generation, response)
      this.closeEditor()
      return
    }
    this.store.update((state) => { state.editor.error = response.error.message })
  }

  /**
   * Permanently delete one user skill.
   * @param name - the skill to remove.
   * @returns the failure message, or undefined once the removal was published.
   */
  async remove(name: string): Promise<string | undefined> {
    const generation = ++this.generation
    const response = await this.ctx.remote.skillsAdmin.deleteSkill(name)
    this.publish(generation, response)
    return response.ok ? undefined : response.error.message
  }

  /**
   * Load the curated gallery once; a failed load may be retried.
   * @returns settlement after the answer is published either way.
   */
  async loadGallery(): Promise<void> {
    const generation = ++this.galleryGeneration
    this.store.update((state) => { state.gallery.status = 'loading'; state.gallery.error = null })
    const response = await this.ctx.remote.skillsAdmin.gallery()
    if (generation !== this.galleryGeneration) return
    this.store.update((state) => {
      if (response.ok) {
        state.gallery.status = 'ready'
        state.gallery.error = null
        state.gallery.entries = response.value
      } else {
        state.gallery.status = 'error'
        state.gallery.error = response.error.message
      }
    })
  }

  /**
   * Install one gallery entry host-side; the inventory answer replaces the
   * rows and the entry is marked installed.
   * @param id - gallery entry id from the loaded slice.
   * @returns the failure message, or undefined once the install was published.
   */
  async installGallery(id: string): Promise<string | undefined> {
    const generation = ++this.generation
    const response = await this.ctx.remote.skillsAdmin.installGallery(id)
    this.publish(generation, response)
    if (!response.ok) return response.error.message
    this.store.update((state) => {
      state.gallery.entries = state.gallery.entries.map(entry =>
        entry.id === id ? { ...entry, installed: true } : entry)
    })
    return undefined
  }

  /**
   * Load the external agent skill roots once; a failed load may be retried.
   * @returns settlement after the answer is published either way.
   */
  async loadExternal(): Promise<void> {
    const generation = ++this.externalGeneration
    this.store.update((state) => { state.external.status = 'loading'; state.external.error = null })
    const response = await this.ctx.remote.skillsAdmin.external()
    if (generation !== this.externalGeneration) return
    this.store.update((state) => {
      if (response.ok) {
        state.external.status = 'ready'
        state.external.error = null
        state.external.roots = response.value
      } else {
        state.external.status = 'error'
        state.external.error = response.error.message
      }
    })
  }

  /**
   * Copy one external skill into the user skills root host-side.
   * @param path - the skill directory or Markdown file to import.
   * @returns the failure message, or undefined once the import was published.
   */
  async importExternal(path: string): Promise<string | undefined> {
    const generation = ++this.generation
    const response = await this.ctx.remote.skillsAdmin.importExternal(path)
    this.publish(generation, response)
    return response.ok ? undefined : response.error.message
  }

  /**
   * Open the frame-wide create-from-sessions dialog, loading the session slice
   * when nothing has loaded it yet.
   */
  openForgeDialog(): void {
    if (this.store.getSnapshot().forge.status === 'idle') void this.loadForgeSessions()
    this.store.update((state) => { state.forgeDialog.open = true })
  }

  /** Close the frame-wide create-from-sessions dialog. */
  closeForgeDialog(): void {
    this.store.update((state) => { state.forgeDialog.open = false })
  }

  /**
   * Load the forge session picker once; a failed load may be retried.
   * @returns settlement after the answer is published either way.
   */
  async loadForgeSessions(): Promise<void> {
    const generation = ++this.forgeGeneration
    this.store.update((state) => { state.forge.status = 'loading'; state.forge.error = null })
    const response = await this.ctx.remote.sessionsAdmin.list()
    if (generation !== this.forgeGeneration) return
    this.store.update((state) => {
      if (response.ok) {
        state.forge.status = 'ready'
        state.forge.error = null
        state.forge.sessions = response.value.items.slice(0, FORGE_SESSION_LIMIT)
      } else {
        state.forge.status = 'error'
        state.forge.error = response.error.message
      }
    })
  }

  /**
   * Distill the selected sessions into a new skill: the Host extracts the
   * transcripts and answers a seed prompt plus the skill-authoring preset it
   * intends, and this hand-off starts a fresh session composed from that preset
   * with the seed as its first prompt, which navigates the shell to the
   * conversation.
   * @param sessionIds - the sessions to distill, newest first.
   * @returns the failure message, or undefined once the forge session took the seed.
   */
  async forge(sessionIds: readonly string[]): Promise<string | undefined> {
    const response = await this.ctx.remote.skillsAdmin.forge({ sessionIds: [...sessionIds] })
    if (!response.ok) return response.error.message
    const { seed, agentPreset } = response.value
    const sessionId = await this.ctx.sessions.create({ agentPreset })
    this.ctx.sessions.open(sessionId)
    const session = this.ctx.sessions.binding(sessionId)?.session
    if (session === undefined) return 'the new session is not addressable yet'
    const submission = session.beginSubmission({ mode: 'queue', text: seed, attachments: [] })
    const result = await session.prompt(
      [{ type: 'text', text: seed }],
      'queue',
      undefined,
      submission.requestId,
    )
    if (!result.ok) {
      submission.abandon()
      return `${result.error.message} (${result.error.code})`
    }
    // The accepted seed is the hand-off's point of no return: the dialog that
    // asked for it closes, and the shell has already navigated to the session.
    this.closeForgeDialog()
    return undefined
  }

  /** Publish one response's inventory unless a newer operation already took over. */
  private publish(generation: number, response: RemoteResult<SkillAdminEntry[]>): void {
    if (generation !== this.generation) return
    if (!response.ok) {
      this.store.update((state) => { state.status = 'error'; state.error = response.error.message })
      return
    }
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.entries = response.value
    })
  }
}

/**
 * Fill one localized template's single `{skill}` placeholder with a skill name.
 * @param template - dictionary string carrying the placeholder.
 * @param name - the skill name, kept verbatim as wire data.
 * @returns the rendered label.
 */
export function skillCopy(template: string, name: string): string {
  return template.replace('{skill}', () => name)
}

/**
 * Fill one localized template's single `{count}` placeholder with a selection size.
 * @param template - dictionary string carrying the placeholder.
 * @param count - the number of selected sessions.
 * @returns the rendered label.
 */
export function countCopy(template: string, count: number): string {
  return template.replace('{count}', () => String(count))
}
