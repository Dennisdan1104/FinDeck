/**
 * The web tools card: whether the agent owns `web_search` and `web_fetch`, and
 * the bounds each call runs under.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FoldSection, ToggleField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { WebToolsCardFace } from './web-tools-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web tools card. */
export type WebToolsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebToolsCardFace>

/**
 * Render the web tools card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function WebToolsCard(props: WebToolsCardProps) {
  const { t } = props
  const state = props.useWebToolsCard(snapshot => snapshot)
  const disabled = !state.writable
  const toggle = (field: 'search' | 'fetch', current: string) => () => {
    props.edit(field, current === 'true' ? 'false' : 'true')
  }
  return (
    <PluginCard
      t={t}
      titleKey="webToolsTitle"
      descriptionKey="webToolsDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ToggleField
        id="plugin-config-web-tools-search"
        label={t('webToolsSearch')}
        hint={t('webToolsSearchHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        overridden={state.search.overridden}
        checked={state.search.text === 'true'}
        disabled={disabled}
        onToggle={toggle('search', state.search.text)}
        onReset={() => { props.resetField('search') }}
      />
      <ToggleField
        id="plugin-config-web-tools-fetch"
        label={t('webToolsFetch')}
        hint={t('webToolsFetchHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        overridden={state.fetch.overridden}
        checked={state.fetch.text === 'true'}
        disabled={disabled}
        onToggle={toggle('fetch', state.fetch.text)}
        onReset={() => { props.resetField('fetch') }}
      />
      <ValueField
        id="plugin-config-web-tools-search-max-results"
        label={t('webToolsSearchMaxResults')}
        hint={t('webToolsSearchMaxResultsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.searchMaxResults}
        onEdit={(text) => { props.edit('searchMaxResults', text) }}
        onReset={() => { props.resetField('searchMaxResults') }}
      />
      <ValueField
        id="plugin-config-web-tools-search-max-queries"
        label={t('webToolsSearchMaxQueries')}
        hint={t('webToolsSearchMaxQueriesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.searchMaxQueries}
        onEdit={(text) => { props.edit('searchMaxQueries', text) }}
        onReset={() => { props.resetField('searchMaxQueries') }}
      />
      <ValueField
        id="plugin-config-web-tools-fetch-max-output-chars"
        label={t('webToolsFetchMaxOutputChars')}
        hint={t('webToolsFetchMaxOutputCharsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.fetchMaxOutputChars}
        onEdit={(text) => { props.edit('fetchMaxOutputChars', text) }}
        onReset={() => { props.resetField('fetchMaxOutputChars') }}
      />
      {/* Both budgets are enforced by the tool-call timeout policy, so they read
          as advanced tuning rather than as the tools' ordinary bounds. */}
      <FoldSection label={t('advanced')}>
        <ValueField
          id="plugin-config-web-tools-search-timeout"
          label={t('webToolsSearchTimeoutMs')}
          hint={t('webToolsSearchTimeoutMsHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric
          disabled={disabled}
          {...state.searchTimeoutMs}
          onEdit={(text) => { props.edit('searchTimeoutMs', text) }}
          onReset={() => { props.resetField('searchTimeoutMs') }}
        />
        <ValueField
          id="plugin-config-web-tools-fetch-timeout"
          label={t('webToolsFetchTimeoutMs')}
          hint={t('webToolsFetchTimeoutMsHint')}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric
          disabled={disabled}
          {...state.fetchTimeoutMs}
          onEdit={(text) => { props.edit('fetchTimeoutMs', text) }}
          onReset={() => { props.resetField('fetchTimeoutMs') }}
        />
      </FoldSection>
    </PluginCard>
  )
}
