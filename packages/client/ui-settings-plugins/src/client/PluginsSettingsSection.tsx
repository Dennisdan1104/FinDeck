/** Plugins settings section: page chrome around the feature-owned page body. */

import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginsSettingsSection.module.css'

/** Props the renderer binds for the section. */
export type PluginsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugins.body'>

/**
 * Render the Plugins page: the section owns the heading and the single body
 * seat; the body registrant owns the user-managed cards and the system region.
 * @param props - locale copy and the page-body renderer.
 * @returns the Plugins page.
 */
export function PluginsSettingsSection({ t, renderSlot }: PluginsSettingsSectionProps) {
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {renderSlot('settings.plugins.body', {})}
    </div>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins section, page-body, and card copy. */
    'settings.plugins': PluginsSettingsLocaleKey
  }
}
