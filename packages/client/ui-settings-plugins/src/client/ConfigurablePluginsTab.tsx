/**
 * Configurable Host plugin cards contributed to the system-plugin region.
 *
 * The view enumerates settings namespaces but never interprets one — a card
 * arrives through `settings.plugin.item` keyed by the namespace it edits, so a
 * plugin that ships a browser half owns its own card and this view only decides
 * which keys to dispatch.
 */

import { Fragment } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slot-contract.ts'
import type { ConfigurablePluginsTabFace } from './tab-store.ts'
import css from './PluginsSettingsSection.module.css'

/** Props the renderer binds for the configurable view. */
export type ConfigurablePluginsTabProps =
  PropsRuntime<'settings.plugins.system'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugin.item'>
  & InjectFace<ConfigurablePluginsTabFace>

/**
 * Render cards registered by plugins that expose editable settings.
 * @param props - locale copy, slot rendering, and the namespaces to dispatch.
 * @returns the card list, or the empty line once the Host has answered.
 */
export function ConfigurablePluginsTab(props: ConfigurablePluginsTabProps) {
  const { t, renderSlot } = props
  const { loaded, namespaces } = props.useConfigurablePlugins(snapshot => snapshot)
  if (namespaces.length > 0) {
    return (
      <>
        <h3 className={css.subheading}>{t('configurableTab')}</h3>
        <ul className={css.cards}>
          {namespaces.map(ns => (
            // One dispatch per namespace, so the list identity is the namespace
            // rather than a position that shifts as cards arrive.
            <Fragment key={ns}>{renderSlot('settings.plugin.item', {}, { entryKey: ns })}</Fragment>
          ))}
        </ul>
      </>
    )
  }
  return loaded ? <p className={css.empty}>{t('empty')}</p> : null
}
