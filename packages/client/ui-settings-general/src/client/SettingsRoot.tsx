/**
 * Settings shell root: the sidebar-foot primary page navigation plus the
 * centered single-page modal panel. The shell is a pure composition face —
 * every page row arrives from `settings.section` registrants through slots
 * (id, order, localized label), so a new page registers its section and needs
 * no shell change; unknown ids fall back to the settings-gear glyph. The panel
 * no longer aggregates sections behind one nav rail: each page opens its own
 * dialog titled by that section's label. Accessible names resolve to slot or
 * ledger content (nav: its region label and row text; dialog: aria-labelledby
 * the title node; close: visually-hidden slot text). Dialog open state and the
 * active section id are component-local viewing state; the onboarding
 * coordinator mounts exactly one ordered registrant while the sessions-derived
 * empty-Hero fact is active. Visible dialog chrome belongs to the step, so a
 * mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ConnectionIndicator,
  IconAgentPresetOutlineMedium, IconCloseOutlineMedium, IconCodeOutlineMedium, IconDataOutlineMedium,
  IconFolderOpenMedium, IconPersonalizationOutlineMedium, IconSettingsOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.module.css'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Nav glyph by page id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutlineMedium className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutlineMedium className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutlineMedium className={css.navIcon} size={16} />
  if (id === 'research-assets') return <IconFolderOpenMedium className={css.navIcon} size={16} />
  if (id === 'data-env') return <IconCodeOutlineMedium className={css.navIcon} size={16} />
  return <IconSettingsOutlineMedium className={css.navIcon} size={16} />
}

type PanelProps = {
  active: SettingsSectionRow | undefined
  renderSlot: SettingsRootComponentProps['renderSlot']
  onClose: () => void
}

/**
 * The modal layer: full-viewport mask + centered single-page panel. Close
 * paths: the header button, a mask click, and document-level Escape (mounted
 * only while open, so the listener lifetime is the panel's).
 */
function SettingsPanel({ active, renderSlot, onClose }: PanelProps) {
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Entering the dialog focuses the close button; the root restores the page's nav button on close.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={css.content}>
          <div className={css.header}>
            <div className={css.title} id={titleId}>{active?.label}</div>
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutlineMedium size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options}>
            {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active.id })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the primary page navigation and the single-page panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, useConnectionState, useSections, useOnboardingSteps, useSessions, renderSlot, t,
  } = props
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const navButtons = useRef(new Map<string, HTMLButtonElement>())
  const activeNav = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(open)
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  // Restore after the close commit, when the dialog can no longer own focus.
  useEffect(() => {
    if (wasOpen.current && !open) activeNav.current?.focus()
    wasOpen.current = open
  }, [open])
  const openSection = useCallback((id: string) => {
    activeNav.current = navButtons.current.get(id) ?? null
    setActiveId(id)
    setOpen(true)
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the close seat re-renders
  // through its own outlet's subscription.
  const rows = useSections(s => s)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions(state =>
    state.phase === 'ready'
    && (state.current === undefined || state.byId[state.current]?.blank === true))
  const onboardingStep = onboardingActive
    ? onboardingSteps.find(step => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (connectionState === 'connecting') {
    connectionIndicator = 'connecting'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  return (
    <>
      <nav className={clsx(css.pageNav, !wide && css.pageNavRail)} aria-label={t('nav.region')}>
        {rows.map(row => (
          <button
            key={row.id}
            ref={(button) => {
              if (button === null) navButtons.current.delete(row.id)
              else navButtons.current.set(row.id, button)
            }}
            type="button"
            className={clsx(css.pageNavCell, !wide && css.pageNavCellRail)}
            aria-haspopup="dialog"
            aria-expanded={open && row.id === activeId}
            onClick={() => { openSection(row.id) }}
          >
            {navIcon(row.id)}
            <span className={css.pageNavLabel}>{row.label}</span>
          </button>
        ))}
      </nav>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        <ConnectionIndicator
          state={wide ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          connectingLabel={t('connection.connecting')}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
      </div>
      {open && rows.some(row => row.id === activeId) && (
        <SettingsPanel
          active={rows.find(row => row.id === activeId)}
          renderSlot={renderSlot}
          onClose={close}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
