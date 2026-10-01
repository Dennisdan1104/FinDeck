/**
 * The sidebar's service-restart action. The host restarts its own process in
 * place, so the reply cannot be awaited: the call usually ends with the carrier
 * dropping mid-flight. This controller therefore judges the restart by the
 * connection generation that follows it and reloads the page once a
 * replacement answers, so the reload serves the rebuilt artifacts.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Restart lifecycle the sidebar control renders. */
export interface RestartState {
  /** `restarting` from the request until this page reloads or the wait expires. */
  status: 'idle' | 'restarting'
}

const INITIAL: RestartState = { status: 'idle' }

/** The generated `system` Remote namespace, read structurally because a host may predate it. */
interface RestartNamespace {
  restart: () => Promise<unknown>
}

/** How often the page re-reads the connection generation. */
const POLL_INTERVAL_MS = 250
/** Elapsed time after which a page that never saw the carrier drop reloads anyway. */
const RECONNECT_GRACE_MS = 8_000
/** Elapsed time after which the control returns to rest: no replacement answered. */
const RECONNECT_DEADLINE_MS = 60_000

/** Wait one poll interval. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Drives the sidebar control over the host's `system` Remote namespace and the connection's generation. */
export class RestartController {
  /** Control snapshot the sidebar subscribes to. */
  readonly store: SnapshotStore<RestartState> = createSnapshotStore(INITIAL)

  constructor(private readonly ctx: ClientContext) {}

  /** Request one in-place host restart; ignored while one is already in flight. */
  restart(): void {
    if (this.store.getSnapshot().status !== 'idle') return
    // Read through `ctx.get`: the namespace is mounted by the host build, and a
    // page rebuilt against a newer bundle is routinely served by a host process
    // that predates it. Such a host can only be restarted by hand, so leaving
    // the control at rest is the whole answer it can give.
    const system = this.ctx.get('remote.system') as RestartNamespace | undefined
    if (system === undefined) {
      console.warn('[ui-shell] this host serves no system Remote namespace; restart it manually')
      return
    }
    this.store.set({ status: 'restarting' })
    const connection = this.ctx.get('connection') as ConnectionHandle | undefined
    // A rejected or failed call is the ordinary outcome of a restart: the host
    // releases its listener before it answers. The generation that follows is
    // the outcome this controller reads.
    void system.restart().catch(() => {})
    void this.awaitReplacement(connection)
  }

  /** Reload on a new connection generation; return the control to rest once the deadline passes. */
  private async awaitReplacement(connection: ConnectionHandle | undefined): Promise<void> {
    const before = connection?.generation.getSnapshot()?.id
    const started = Date.now()
    for (;;) {
      const generation = connection?.generation.getSnapshot()
      if (generation !== undefined && generation.id !== before) break
      const elapsed = Date.now() - started
      if (elapsed >= RECONNECT_DEADLINE_MS) {
        this.store.set(INITIAL)
        return
      }
      // The replacement can come up faster than this page notices the drop:
      // a carrier that is still connected well past the request reloads rather
      // than waiting for a loss it will never observe. A reload of an
      // unreplaced page is a no-op refresh, so this arm is safe either way.
      if (elapsed >= RECONNECT_GRACE_MS && connection?.state.getSnapshot() === 'connected') break
      await sleep(POLL_INTERVAL_MS)
    }
    location.reload()
  }
}
