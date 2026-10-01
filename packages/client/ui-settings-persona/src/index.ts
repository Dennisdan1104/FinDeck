/**
 * Host half: register the `system-prompt` settings namespace and keep the
 * user's personalization registered as prompt sections.
 *
 * Assembly runs once per model step (`ctx.systemPrompt.assemble`), so a
 * committed value reaches the model at the next step of every session — no
 * restart and no new session is required. Registration and disposal of the
 * sections are the same effect, so a cleared field leaves nothing behind.
 *
 * Both services are optional: a deployment composing neither a settings
 * provider nor the prompt registry simply gets no personalization, and this
 * plugin contributes nothing.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { PromptSectionOrderName } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  CUSTOM_INSTRUCTIONS_FIELD, PERSONA_PREFIX_FIELD, PERSONA_SUFFIX_FIELD,
  SYSTEM_PROMPT_SETTINGS_BASE, SYSTEM_PROMPT_SETTINGS_NAMESPACE, SystemPromptSettingsSchema,
  USER_CUSTOM_INSTRUCTIONS_SECTION, USER_PERSONA_PREFIX_SECTION, USER_PERSONA_SUFFIX_SECTION,
  type SystemPromptSettings,
} from './persona-settings.ts'

/** One editable field, the section it drives, and that section's central placement. */
interface UserPromptSection {
  readonly field: keyof SystemPromptSettings
  readonly name: string
  readonly order: PromptSectionOrderName
}

/** The user sections in the order they render, from just after the deployment persona to the prompt's end. */
const USER_PROMPT_SECTIONS: readonly UserPromptSection[] = [
  { field: PERSONA_PREFIX_FIELD, name: USER_PERSONA_PREFIX_SECTION, order: 'USER_PERSONA_PREFIX' },
  { field: PERSONA_SUFFIX_FIELD, name: USER_PERSONA_SUFFIX_SECTION, order: 'USER_PERSONA_SUFFIX' },
  { field: CUSTOM_INSTRUCTIONS_FIELD, name: USER_CUSTOM_INSTRUCTIONS_SECTION, order: 'USER_CUSTOM_INSTRUCTIONS' },
]

/**
 * Register the `system-prompt` namespace and mirror its value into prompt
 * sections: a non-empty field is a registered section, a cleared field is no
 * section at all.
 * @param ctx - Host context; activates only with both the settings provider
 * and the prompt registry present.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings', 'systemPrompt'], (hostCtx) => {
    const scope = hostCtx.settings.register(SYSTEM_PROMPT_SETTINGS_NAMESPACE, SystemPromptSettingsSchema, {
      base: SYSTEM_PROMPT_SETTINGS_BASE,
      // Assembly runs per model step, so a saved value is live in the next request.
      applies: 'live',
    })
    /** Disposer of the section currently registered for each field. */
    const registered = new Map<keyof SystemPromptSettings, () => void>()
    const sync = (settings: SystemPromptSettings): void => {
      for (const section of USER_PROMPT_SECTIONS) {
        registered.get(section.field)?.()
        registered.delete(section.field)
        const text = settings[section.field]
        // Whitespace-only text is no personalization; registering it would add
        // a section that renders to nothing but still counts as a contributor.
        if (text.trim() === '') continue
        registered.set(section.field, hostCtx.systemPrompt.section({
          name: section.name,
          order: hostCtx.systemPrompt.getSectionOrder(section.order),
          text,
        }))
      }
    }
    hostCtx.effect(() => {
      const off = scope.watch(sync)
      // `watch` reports changes only, so the value the namespace resolves at
      // registration is applied here.
      sync(scope.get())
      return () => {
        off()
        for (const dispose of registered.values()) dispose()
        registered.clear()
      }
    }, 'ui-settings-persona: user prompt sections')
  })
}
