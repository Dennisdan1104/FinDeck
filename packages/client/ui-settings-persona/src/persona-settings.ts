/**
 * The `system-prompt` settings namespace and the prompt sections the user's
 * personalization contributes.
 *
 * Both halves of this package import this module: the Host half registers the
 * namespace and contributes the sections, the browser half edits the same
 * namespace, so the field names and the namespace identity have exactly one
 * home.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the system-prompt personalization plugin. */
export const SYSTEM_PROMPT_SETTINGS_NAMESPACE = 'system-prompt'

/** Field carrying the text rendered before first-party guidance. */
export const PERSONA_PREFIX_FIELD = 'personaPrefix'

/** Field carrying the text rendered after first-party guidance. */
export const PERSONA_SUFFIX_FIELD = 'personaSuffix'

/** Field carrying the instructions appended at the end of the system prompt. */
export const CUSTOM_INSTRUCTIONS_FIELD = 'customInstructions'

/**
 * Prompt section name of the user's persona prefix. Distinct from
 * `deployment:persona-prefix` because that section is always registered — a
 * second global registration under the same name is a duplicate and throws.
 */
export const USER_PERSONA_PREFIX_SECTION = 'settings:persona-prefix'

/** Prompt section name of the user's persona suffix (distinct, same reason as the prefix). */
export const USER_PERSONA_SUFFIX_SECTION = 'settings:persona-suffix'

/** Prompt section name of the user's appended instructions. */
export const USER_CUSTOM_INSTRUCTIONS_SECTION = 'settings:custom-instructions'

/** The user's system-prompt personalization as stored in the settings document. */
export interface SystemPromptSettings {
  /** Text rendered before first-party guidance. */
  personaPrefix: string
  /** Text rendered after first-party guidance. */
  personaSuffix: string
  /** Instructions appended at the very end of the system prompt. */
  customInstructions: string
}

/**
 * The empty personalization every field reverts to when cleared. Also the
 * namespace's composition base, so an absent section reads as "no
 * personalization" instead of an unresolved value.
 */
export const SYSTEM_PROMPT_SETTINGS_BASE: SystemPromptSettings = {
  [PERSONA_PREFIX_FIELD]: '',
  [PERSONA_SUFFIX_FIELD]: '',
  [CUSTOM_INSTRUCTIONS_FIELD]: '',
}

/** Durable schema, shared by the Host registration and the browser scope. */
export const SystemPromptSettingsSchema: z<SystemPromptSettings> = z.object({
  [PERSONA_PREFIX_FIELD]: z.string().default('')
    .description('Text rendered before first-party guidance.'),
  [PERSONA_SUFFIX_FIELD]: z.string().default('')
    .description('Text rendered after first-party guidance.'),
  [CUSTOM_INSTRUCTIONS_FIELD]: z.string().default('')
    .description('Instructions appended at the end of the system prompt.'),
})
