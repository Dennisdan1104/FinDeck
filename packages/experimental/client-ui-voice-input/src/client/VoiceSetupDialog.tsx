/** Self-hosted modal for voice setup, preparation progress and unavailable recognition. */
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SpeechProviderView } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { PreparationCard } from './PreparationCard.tsx'
import type { VoiceInputInjected } from './VoiceInput.tsx'
import type { NS } from './locales.ts'

/** Readiness and preparation surface the composer owns, independent of any plugin-details page. */
export type VoiceSetupDialogProps = PropsLocale<typeof NS>
  & Pick<InjectFace<VoiceInputInjected>, 'prepare' | 'cancelPreparation'>
  & {
    readonly open: boolean
    readonly connected: boolean
    readonly error: string | null
    readonly provider: SpeechProviderView | undefined
    readonly onDismiss: () => void
  }

/**
 * Guide first-time installation and observe the provider's own preparation inside the composer.
 * @param props - visibility, selected recognizer, transport state and preparation actions.
 * @returns a dismissible prompt that never starts a recording.
 */
export function VoiceSetupDialog({ open, connected, error, provider, prepare, cancelPreparation, onDismiss, t }: VoiceSetupDialogProps) {
  const local = provider?.location === 'host-local' ? provider : undefined
  const needsInstallation = connected && local?.preparation.phase === 'unprepared'
  return <Modal open={open} title={t(needsInstallation ? 'setupPrompt.title' : 'setupPrompt.unavailableTitle')}
    closeLabel={t('cancel')} onClose={onDismiss}
    footer={<Button variant="ghost" onClick={onDismiss}>{t('setupPrompt.later')}</Button>}>
    {connected && local !== undefined
      ? <>
        {needsInstallation && <p>{t('setupPrompt.body')}</p>}
        <PreparationCard provider={local} connected={connected} prepare={prepare} cancelPreparation={cancelPreparation} t={t} />
      </>
      : <p>{t('setupPrompt.unavailableBody')}</p>}
    {error !== null && <p role="alert">{t('failed', { message: error })}</p>}
  </Modal>
}
