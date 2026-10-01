/**
 * The frame-wide create-from-sessions dialog: the composer's skill-forge mode
 * pick opens it over whatever the user was reading, and it renders the same
 * picker the Skills page's tab shows. It lives in the shell overlay seat, so
 * the modal primitive owns the mask, Escape, and the accessible name while the
 * page store owns whether it is open.
 */

import type { ReactNode } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the 'shell.overlay' SlotMap declaration (the seat this registers into).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { ForgePicker } from './ForgePicker.tsx'
import styles from './SkillsSection.module.css'

/**
 * Render the dialog.
 * @param props - slot-delivered injected dependencies (the page controller, its
 *   bound snapshot hook, and section copy).
 * @returns the modal with the picker inside, or null until the shell injects.
 */
export function ForgeDialog(props: Partial<InjectFace<SkillsSectionInjected>>): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  const state = useSnapshot(snapshot => snapshot)
  return (
    <Modal
      open={state.forgeDialog.open}
      onClose={() => { controller.closeForgeDialog() }}
      title={t('forgeDialogTitle')}
      closeLabel={t('close')}
      className={styles['forgeDialog'] ?? ''}
    >
      <div className={styles['forgeDialogBody']}>
        <ForgePicker controller={controller} state={state} t={t} />
      </div>
    </Modal>
  )
}
