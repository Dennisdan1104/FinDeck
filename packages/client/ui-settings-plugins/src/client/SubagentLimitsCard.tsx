/**
 * Controls for delegation depth and the live continuable-child limit.
 *
 * Adapted from the upstream card (`845115d0f8`) to this fork's card primitives:
 * the illustrations, layout, and copy are upstream's, while the fields stage
 * through the fork's `ValueField` and `CardForm` unchanged.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import { ValueField } from './fields.tsx'
import type { SubagentLimitsCardFace } from './subagent-limits-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './SubagentLimitsCard.module.css'

/** Props the renderer binds for the delegation limits card. */
export type SubagentLimitsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SubagentLimitsCardFace>

/**
 * Render separately explained depth and capacity controls with staged saving.
 * @param props - locale copy, the limit values, and the settings actions.
 * @returns the limits card.
 */
export function SubagentLimitsCard(props: SubagentLimitsCardProps) {
  const { t } = props
  const state = props.useSubagentLimitsCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginCard
      t={t}
      titleKey="subagentLimitsTitle"
      descriptionKey="subagentLimitsDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.limits}>
        <div className={css.limit}>
          <div className={css.illustration} aria-hidden="true">
            <svg viewBox="0 0 120 40" focusable="false">
              <path d="M24 10h12v12h8m16 0h12v12h8" />
              <rect x="8" y="4" width="16" height="12" rx="3" />
              <rect x="44" y="16" width="16" height="12" rx="3" />
              <rect x="80" y="28" width="16" height="12" rx="3" />
            </svg>
            <span>{t('subagentDepthEyebrow')}</span>
          </div>
          <ValueField
            id="plugin-config-subagent-depth"
            label={t('subagentMaxDepth')}
            hint={t('subagentMaxDepthHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('subagentDepthInvalid')}
            numeric
            disabled={disabled}
            {...state.maxDepth}
            onEdit={(text) => { props.edit('maxDepth', text) }}
            onReset={() => { props.resetField('maxDepth') }}
          />
        </div>
        <div className={css.limit}>
          <div className={css.illustration} aria-hidden="true">
            <svg viewBox="0 0 120 40" focusable="false">
              <path d="M52 12v10M16 26v-6h72v6" />
              <rect x="44" y="2" width="16" height="12" rx="3" />
              <rect x="8" y="26" width="16" height="12" rx="3" />
              <rect x="44" y="26" width="16" height="12" rx="3" />
              <rect x="80" y="26" width="16" height="12" rx="3" />
            </svg>
            <span>{t('subagentCapacityEyebrow')}</span>
          </div>
          <ValueField
            id="plugin-config-subagent-capacity"
            label={t('subagentMaxActive')}
            hint={t('subagentMaxActiveHint')}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('subagentCapacityInvalid')}
            numeric
            disabled={disabled}
            {...state.maxActiveSubagents}
            onEdit={(text) => { props.edit('maxActiveSubagents', text) }}
            onReset={() => { props.resetField('maxActiveSubagents') }}
          />
        </div>
      </div>
      <p className={css.note}>{t('subagentLimitsApplies')}</p>
    </PluginCard>
  )
}
