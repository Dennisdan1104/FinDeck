/** Root-scoped controller for the right Sidebar's Session content. */
import { useLayoutEffect, type ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarSessionViewSnapshot } from '../session-views.ts'
import type {} from '../contract/slots.ts'
import css from './SidebarRight.module.css'

/** Root-only retained Session targets and their committed mount lifetimes. */
export interface RightbarRootInjected {
  readonly hooks: { readonly views: HostObservable<readonly SidebarSessionViewSnapshot[]> }
  /** @param reference - framework target published by this owner. @returns releases this committed mount. */
  readonly mountView: (reference: SessionReference) => () => void
}

type RootProps = PropsRuntime<'shell.rightbar'> & PropsRenderSlots<'rightbar.session'> & InjectFace<RightbarRootInjected>

/**
 * One Session's Sidebar subtree, kept mounted whether or not it is on screen.
 * @param props - view target, frame geometry and the authorized Session renderer.
 * @returns the Session-bound Sidebar, hidden while another Session is selected.
 */
function SessionView({ view, SessionProvider, renderSlot, mountView, width, viewportWidth, canShow }:
  Pick<RootProps, 'SessionProvider' | 'renderSlot' | 'mountView' | 'width' | 'viewportWidth' | 'canShow'>
  & { readonly view: SidebarSessionViewSnapshot }): ReactNode {
  useLayoutEffect(() => mountView(view.reference), [mountView, view.reference])
  return (
    <div className={css.session} hidden={!view.selected} data-sidebar-right-session={view.sessionId}>
      <SessionProvider session={view.reference}>
        {renderSlot('rightbar.session', {
          width, viewportWidth, canShow, active: view.selected, retainTab: view.retainTab,
        })}
      </SessionProvider>
    </div>
  )
}

/**
 * Keep independent Session subtrees and hide those outside the selected Conversation.
 *
 * The FinDeck shell has no selectable global main panel, so this seat is
 * always live: the column it draws into is collapsed by the panel's own state,
 * and the seat must stay mounted for that state to reach `ctx.layout`. That
 * makes `active` the Session owning the foreground column, not a panel gate.
 * @param props - frame geometry, view targets and the authorized Session renderer.
 * @returns the foreground and retained background Sidebars.
 */
export function RightbarRoot({ useViews, ...props }: RootProps) {
  const views = useViews(value => value)
  return <>{views.map(view => <SessionView key={view.sessionId} {...props} view={view} />)}</>
}
