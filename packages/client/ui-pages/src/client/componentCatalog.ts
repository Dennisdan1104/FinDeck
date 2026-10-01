/**
 * Component-catalog observation over the Host's `componentCatalog` Remote: the
 * installable-component inventory, the one global install task, and the
 * per-component failure text. The Host owns every fact — its `start` endpoint
 * answers once the task is accepted and `follow()` carries its progress — so
 * the subscription lives here, in the apply world, and the page reads a bound
 * hook over this snapshot instead of subscribing itself.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  ComponentEvent,
  ComponentId,
  ComponentInfo,
  ComponentProgress,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** One component's last failure text, from a rejected call or a `failed` event. */
export interface ComponentFailure {
  /** The component the failure belongs to. */
  readonly id: ComponentId
  /** Host-reported failure text. */
  readonly message: string
}

/** Everything the components block renders. */
export interface ComponentCatalogState {
  /** Catalog read cycle; `idle` is the state before the page's first read. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Catalog read or refresh failure text. */
  error: string | null
  /** Every installable component, in the Host's order. */
  entries: ComponentInfo[]
  /** The install task in flight, as the follow stream last reported it. */
  task: ComponentProgress | null
  /** Failure text per component; a new attempt clears its own entry. */
  failures: ComponentFailure[]
  /** Live-progress stream loss, or null while the stream is up. */
  streamError: string | null
}

/** The snapshot store behind {@link ComponentCatalogState}, bound by the renderer as `useCatalog`. */
export type ComponentCatalogStore = SnapshotStore<ComponentCatalogState>

/** Catalog reads and the two mutations the components block drives. */
export interface ComponentCatalogActions {
  /**
   * Read the whole catalog. A read over an already-rendered catalog refreshes
   * it in place.
   * @returns settlement after the answer is published either way.
   */
  reload(): Promise<void>
  /**
   * Start one install task. The Host rejects when a required component is
   * missing or another task is already running; progress and outcome then
   * arrive on the follow stream. Page-side name; the Host endpoint is `start`.
   * @param id - the component to install.
   * @returns settlement after the Host accepted or refused the request.
   */
  install(id: ComponentId): Promise<void>
  /**
   * Cancel the task in flight.
   * @param id - the component whose task is cancelled.
   * @returns settlement after the Host cancelled or refused the request.
   */
  cancel(id: ComponentId): Promise<void>
}

/**
 * The Client's whole component-catalog state: one snapshot store plus the
 * remote calls and the follow-stream fold that drive it.
 */
class ComponentCatalogController implements ComponentCatalogActions {
  /** The snapshot the components block renders from. */
  readonly store: ComponentCatalogStore = createSnapshotStore<ComponentCatalogState>({
    status: 'idle',
    error: null,
    entries: [],
    task: null,
    failures: [],
    streamError: null,
  })

  /** Latest accepted catalog answer wins; a superseded read never overwrites a newer one. */
  private generation = 0

  /**
   * @param ctx - the page plugin's context, whose `remote.componentCatalog`
   * namespace owns the inventory, the two mutations, and the follow stream.
   */
  constructor(private readonly ctx: ClientContext) {}

  /** @inheritdoc */
  async reload(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      // A refresh over a rendered catalog stays quiet: the rows keep their
      // place while the answer replaces them in place.
      if (state.status !== 'ready') {
        state.status = 'loading'
        state.error = null
      }
    })
    const result = await this.ctx.remote.componentCatalog.catalog()
    if (generation !== this.generation) return
    this.store.update((state) => {
      if (result.ok) {
        state.status = 'ready'
        state.error = null
        state.entries = result.value
        return
      }
      state.error = result.error.message
      if (state.entries.length === 0) state.status = 'error'
    })
  }

  /** @inheritdoc */
  async install(id: ComponentId): Promise<void> {
    this.store.update((state) => {
      clearFailure(state.failures, id)
      // The Host runs one task at a time, so the click seals this row before
      // the first progress event arrives; a refusal below reopens it.
      state.task = { id, stage: 'download' }
    })
    const result = await this.ctx.remote.componentCatalog.start(id)
    if (result.ok) return
    this.store.update((state) => {
      if (state.task?.id === id) state.task = null
      state.failures.push({ id, message: result.error.message })
    })
  }

  /** @inheritdoc */
  async cancel(id: ComponentId): Promise<void> {
    this.store.update((state) => { clearFailure(state.failures, id) })
    const result = await this.ctx.remote.componentCatalog.cancel(id)
    if (!result.ok) {
      this.store.update((state) => {
        state.failures.push({ id, message: result.error.message })
      })
      return
    }
    this.store.update((state) => {
      // The Host confirmed the cancellation; its terminal event may still
      // arrive, and this row is no longer the one in flight either way.
      if (state.task?.id === id) state.task = null
    })
  }

  /**
   * Fold one follow-stream event, then re-read the catalog so a finished task
   * replaces what the event carried with the Host's own answer.
   * @param event - one event from the `componentCatalog` follow stream.
   */
  accept(event: ComponentEvent): void {
    this.store.update((state) => {
      if (event.type === 'progress') {
        clearFailure(state.failures, event.progress.id)
        state.task = event.progress
        return
      }
      if (event.type === 'installed') {
        if (state.task?.id === event.info.id) state.task = null
        clearFailure(state.failures, event.info.id)
        const at = state.entries.findIndex(entry => entry.id === event.info.id)
        if (at < 0) state.entries.push(event.info)
        else state.entries[at] = event.info
        return
      }
      if (state.task?.id === event.id) state.task = null
      state.failures.push({ id: event.id, message: event.error })
    })
    if (event.type !== 'progress') void this.reload()
  }

  /**
   * Record the end of the live-progress stream: the unary read stays the fact
   * source, so the task indicator drops rather than stalling on a dead stream.
   * @param error - the stream's terminal failure.
   */
  lostStream(error: unknown): void {
    this.store.update((state) => {
      state.task = null
      state.streamError = error instanceof Error ? error.message : String(error)
    })
    void this.reload()
  }
}

/** Drop one component's recorded failure, so a new attempt starts clean. */
function clearFailure(failures: ComponentFailure[], id: ComponentId): void {
  const at = failures.findIndex(failure => failure.id === id)
  if (at >= 0) failures.splice(at, 1)
}

/** One Client plugin's catalog state plus the observation that keeps it live. */
export interface ComponentCatalogObservation {
  /** The page's read/write face. */
  readonly actions: ComponentCatalogActions
  /** The snapshot behind it, bound by the renderer as `useCatalog`. */
  readonly store: ComponentCatalogStore
  /**
   * Stop the follow stream and wait for its consumer to settle.
   * @returns when the stream and its consumer are quiescent.
   */
  readonly dispose: () => Promise<void>
}

/**
 * Subscribe one Client plugin to the Host's component-catalog follow stream.
 * @param ctx - client root context carrying the `componentCatalog` namespace.
 * @returns the page's actions and store, plus observation cleanup.
 */
export function observeComponentCatalog(ctx: ClientContext): ComponentCatalogObservation {
  const controller = new ComponentCatalogController(ctx)
  let disposed = false
  const stream = ctx.remote.$stream<ComponentEvent>({
    name: 'Component catalog',
    open: signal => ctx.remote.componentCatalog.follow(signal),
    ended: () => new Error('component catalog stream ended'),
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        controller.accept(item.value)
        item.accept()
      }
    } catch (error) {
      // A permanent request failure, a carrier loss that outlived its retries,
      // or this observation's own disposal: all three end live progress, and
      // only the first two leave state to report.
      if (!disposed) controller.lostStream(error)
    }
  })()
  return {
    actions: controller,
    store: controller.store,
    dispose: async () => {
      disposed = true
      await stream.dispose()
      await observing
    },
  }
}
