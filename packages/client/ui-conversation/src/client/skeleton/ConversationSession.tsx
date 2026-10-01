/** Strict per-session header/body content inserted into the resident conversation layout. */

import { useEffect } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

/** The conversation view the trajectory affordance switches to. */
const TRAJECTORY_VIEW = 'trajectory'

/** The trajectory glyph (shell line-icon artwork: polyline footprint). */
function TrajGlyph(): ReactNode {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 19 L9 13 L13 16 L20 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="19" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="20" cy="6" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** The back glyph (shell line-icon artwork: chevron). */
function BackGlyph(): ReactNode {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polyline points="14,5 7,12 14,19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
    })
}

/**
 * Renders Session header chrome above the resident conversation scrollport:
 * the title row (breadcrumb cluster, actions, and the title-bar mode/model
 * selectors) over the flow strip row, which carries the trajectory toggle
 * between the steps and the current-step line. The trajectory affordance
 * replaces the dsh View tab strip: the switch is a full content-area page
 * flip (the trajectory View occupies the same conversation.view seat), and
 * the chip flips to the back-to-chat face while that View is active.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or the title and flow rows.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useStore,
  renderSlot, open, selectView, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const hideChrome = session.blank && conversationPhase(session, conversation) === 'blank'
  const trajectoryRegistered = tabs.some(tab => tab.id === TRAJECTORY_VIEW)
  const onTrajectory = active?.id === TRAJECTORY_VIEW
  // Title-bar selectors lock where the composer's would lock for the same
  // reason: a removed session — there is nothing to switch. The session-scoped
  // input machine is always live here, and the composer's owner-only reasons
  // (inert/block) do not apply to the header.
  const controlsLocked = session.removed
  const trajectoryChip = trajectoryRegistered && (
    <button
      type="button"
      className={clsx(css.trajChip, onTrajectory && css.trajChipActive)}
      aria-pressed={onTrajectory}
      title={onTrajectory ? t('header.backToChat') : t('header.trajectory')}
      onClick={() => { selectView(onTrajectory ? 'chat' : TRAJECTORY_VIEW) }}
    >
      {onTrajectory ? <BackGlyph /> : <TrajGlyph />}
      {onTrajectory ? t('header.backToChat') : t('header.trajectory')}
    </button>
  )

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerHidden)}
      aria-hidden={hideChrome || undefined}
    >
      {!hideChrome && (
        <>
          <div className={css.titleRow}>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      className={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onClick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : (
                            <>
                              {title}
                              {renderSlot(
                                'conversation.session.header.lineage',
                                lineageOwner,
                                { fallback: null },
                              )}
                            </>
                          )
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              <div className={css.headerActions}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div className={css.headerSide}>
              {renderSlot('conversation.session.header.mode', { locked: controlsLocked })}
              {renderSlot('conversation.session.header.model', { locked: controlsLocked })}
              <div className={css.headerUtilities}>
                {renderSlot('conversation.session.header.utilities', {})}
              </div>
            </div>
          </div>
          {renderSlot('conversation.session.flow', { trailing: trajectoryChip })}
        </>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession({
  useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView,
}: ConversationSessionProps) {
  const tabs = useConversationViews(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const inputState = useInput(s => s)
  const storedDraft = useStore(s => s.draft)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    if (inputState.draft === '' && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  if (session.blank && conversationPhase(session, conversation) === 'blank') return null
  return (
    <div className={css.viewArea}>
      {active !== undefined && renderSlot('conversation.view', {
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: active.id })}
    </div>
  )
}
