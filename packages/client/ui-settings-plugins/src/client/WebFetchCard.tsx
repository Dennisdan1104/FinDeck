/**
 * The web fetch card: the transport, size, and time bounds the local HTTP
 * fetcher applies to every retrieval.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WebFetchCardFace } from './web-fetch-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web fetch card. */
export type WebFetchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebFetchCardFace>

/**
 * Render the web fetch card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebFetchCard(props: WebFetchCardProps) {
  const { t } = props
  const state = props.useWebFetchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="webFetchTitle"
      descriptionKey="webFetchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-web-fetch-timeout"
        label={t('webFetchTimeoutMs')}
        hint={t('webFetchTimeoutMsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      <ValueField
        id="plugin-config-web-fetch-max-response-bytes"
        label={t('webFetchMaxResponseBytes')}
        hint={t('webFetchMaxResponseBytesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxResponseBytes}
        onEdit={(text) => { props.edit('maxResponseBytes', text) }}
        onReset={() => { props.resetField('maxResponseBytes') }}
      />
      <ValueField
        id="plugin-config-web-fetch-max-body-chars"
        label={t('webFetchMaxBodyChars')}
        hint={t('webFetchMaxBodyCharsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxBodyChars}
        onEdit={(text) => { props.edit('maxBodyChars', text) }}
        onReset={() => { props.resetField('maxBodyChars') }}
      />
      <ValueField
        id="plugin-config-web-fetch-max-redirects"
        label={t('webFetchMaxRedirects')}
        hint={t('webFetchMaxRedirectsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxRedirects}
        onEdit={(text) => { props.edit('maxRedirects', text) }}
        onReset={() => { props.resetField('maxRedirects') }}
      />
      <ValueField
        id="plugin-config-web-fetch-user-agent"
        label={t('webFetchUserAgent')}
        hint={t('webFetchUserAgentHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.userAgent}
        onEdit={(text) => { props.edit('userAgent', text) }}
        onReset={() => { props.resetField('userAgent') }}
      />
    </PluginCard>
  )
}
