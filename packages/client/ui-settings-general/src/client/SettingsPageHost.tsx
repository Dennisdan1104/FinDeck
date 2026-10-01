/**
 * Settings page host: the full-page face of the settings section registry
 * for the FinDeck shell. The shell's page route resolves one
 * `settings.section` id at a time and this entry renders that section's
 * content as a page (no dialog chrome) — the same registry, same section
 * components, and the same `close` affordance the modal shell passed. An
 * unknown or unloaded section id renders the missing-page notice instead.
 */
import type { ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import css from './SettingsPageHost.module.css'

/** Full component props: the shell page hole's owner share plus the render share and locale seat. */
export type SettingsPageHostProps =
  & PropsRuntime<'shell.page'>
  & PropsRenderSlots<'settings.section'>
  & PropsLocale<'settings'>

/**
 * Render one settings section as a full page.
 * @param props - composed shell-page slot props (contract/inject sites in index.ts).
 * @returns the page element tree.
 */
export function SettingsPageHost({ sectionId, close, fullBleed, renderSlot, t }: SettingsPageHostProps): ReactNode {
  return (
    <div className={fullBleed ? css.hostFill : css.host}>
      {renderSlot('settings.section', { close }, {
        only: sectionId,
        fallback: <p className={css.missing}>{t('page.missing')}</p>,
      })}
    </div>
  )
}
