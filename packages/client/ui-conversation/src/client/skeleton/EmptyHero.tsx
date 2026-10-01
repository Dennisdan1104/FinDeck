// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import { useMemo } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  FinDeckMark, IconChevronDownOutlineRegular, IconFolderCloseMedium, IconFolderOpenMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/** Hero slogans in dictionary order; a mount draws one, see {@link HeroShell}. */
const HERO_SLOGANS = [
  'hero.slogan.0',
  'hero.slogan.1',
  'hero.slogan.2',
  'hero.slogan.3',
  'hero.slogan.4',
  'hero.slogan.5',
] as const

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderCloseMedium className={css.folder} size={16} />
        : <IconFolderOpenMedium className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationSlotProps['renderSlot']
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render the hero chrome (headline only; no composer, no workspace row).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, renderSlot, children }: HeroShellProps) {
  // One slogan per mount: the draw is frozen for the life of this blank
  // session's hero, so a re-render never swaps the headline.
  const slogan = useMemo(() => HERO_SLOGANS[Math.floor(Math.random() * HERO_SLOGANS.length)]!, [])
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.headline}>
          {/* figma 34:10412: mark 34×34 leading the headline, gap 10. */}
          <span className={css.markSlot}>
            {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.mark }, {
              fallback: <FinDeckMark size={34} className={css.mark} />,
            })}
          </span>
          <span className={css.headlineText}>
            {t(slogan)}
          </span>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}
