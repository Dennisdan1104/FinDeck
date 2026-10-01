/**
 * The web providers card: which provider this deployment selects for search
 * and for fetch. The rows report the selection and offer no control — the
 * selection belongs to the composition and the settings document.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ReadOnlyField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WebProvidersCardFace } from './web-providers-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web providers card. */
export type WebProvidersCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebProvidersCardFace>

/**
 * Render the web providers card.
 * @param props - locale copy and the card snapshot.
 * @returns the card.
 */
export function WebProvidersCard(props: WebProvidersCardProps) {
  const { t } = props
  const state = props.useWebProvidersCard(snapshot => snapshot)
  const value = (configured: string) => configured.length > 0 ? configured : t('webProvidersAutomatic')
  return (
    <PluginCard
      t={t}
      titleKey="webProvidersTitle"
      descriptionKey="webProvidersDescription"
      state={state}
      // No row stages an edit, so neither action can ever have work to do.
      onSave={() => {}}
      onDiscard={() => {}}
    >
      <ReadOnlyField
        label={t('webProvidersSearch')}
        hint={t('webProvidersSearchHint')}
        value={value(state.searchProvider)}
      />
      <ReadOnlyField
        label={t('webProvidersFetch')}
        hint={t('webProvidersFetchHint')}
        value={value(state.fetchProvider)}
      />
    </PluginCard>
  )
}
