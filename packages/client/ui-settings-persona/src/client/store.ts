/**
 * The System-prompt editor's slot store: a mirror of the `system-prompt`
 * namespace snapshot, one handle per mounted editor occurrence. The plugin's
 * apply-world scope subscription is the only writer; the editor reads through
 * `props.useStore`.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CUSTOM_INSTRUCTIONS_FIELD, PERSONA_PREFIX_FIELD, PERSONA_SUFFIX_FIELD, type SystemPromptSettings,
} from '../persona-settings.ts'

/** State mirrored from the namespace snapshot for the row component. */
export interface SystemPromptRowState {
  /** Sync state of the namespace; `ready` is the only state that accepts edits. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the Host document accepts writes; false in memory mode or on a read-only document. */
  writable: boolean
  /**
   * Host revision the mirrored fields were read at; -1 until the first
   * accepted section, so revision 0 lands as a change. The component re-seeds
   * its drafts from this value, which is how a committed save and an external
   * change both reach the textareas.
   */
  revision: number
  /** Mirrored `personaPrefix` field. */
  personaPrefix: string
  /** Mirrored `personaSuffix` field. */
  personaSuffix: string
  /** Mirrored `customInstructions` field. */
  customInstructions: string
}

/** Declared action shape giving the exported factory a stable return type. */
type SystemPromptRowActions = {
  sync: (draft: SystemPromptRowState, snapshot: SettingsScopeSnapshot<SystemPromptSettings>) => void
}

/**
 * Declares the System-prompt row state and write surface.
 * @returns the store handle.
 */
export function createSystemPromptRowStore(): EngineStoreHandle<SystemPromptRowState, SystemPromptRowActions> {
  return defineStore({
    init: (): SystemPromptRowState => ({
      status: 'loading',
      writable: false,
      revision: -1,
      personaPrefix: '',
      personaSuffix: '',
      customInstructions: '',
    }),
    actions: {
      sync: (draft, snapshot) => {
        draft.status = snapshot.status
        draft.writable = snapshot.writable
        draft.revision = snapshot.revision ?? -1
        draft.personaPrefix = snapshot.value?.[PERSONA_PREFIX_FIELD] ?? ''
        draft.personaSuffix = snapshot.value?.[PERSONA_SUFFIX_FIELD] ?? ''
        draft.customInstructions = snapshot.value?.[CUSTOM_INSTRUCTIONS_FIELD] ?? ''
      },
    },
  })
}
