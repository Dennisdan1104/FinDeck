/**
 * The `componentCatalog` Remote namespace: the downloadable-component catalog
 * of the host, one install job at a time, its cancellation, and the event
 * stream that carries progress, completion, and failure. The gateway forwards
 * to {@link ComponentCatalog} and adds nothing but the wire face.
 *
 * Endpoint names avoid the Client's namespace-service members: its
 * `RemoteNamespaceService` owns a private `install`, so the wire method that
 * starts a job is `start` and the host class keeps `install` internally.
 *
 * The `id` parameter of both mutating endpoints is the {@link ComponentId}
 * literal union, so the generated codec validates it on the wire: an id
 * outside the vocabulary is refused as `gateway/input-invalid` before either
 * method runs, and in-process code below trusts the type.
 * @module @deepseek-ai/dsh-web-app/downloads/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ComponentEvent, ComponentId, ComponentInfo } from '../types.ts'
import { ComponentCatalog } from './catalog.ts'

/** The host component catalog's Remote face. */
export class ComponentCatalogGateway extends TypertRemoteService {
  /** This instance's catalog: one install at a time per mounted gateway. */
  private readonly components = new ComponentCatalog()

  constructor(ctx: Context) {
    super(ctx, 'componentCatalog')
  }

  /**
   * Probe all six components.
   * @returns one entry per component, in display order; a failed probe is reported as that entry's `problem`.
   */
  @Remote
  catalog(): Promise<ComponentInfo[]> {
    return this.components.catalog()
  }

  /**
   * Start the install job for one component; progress and outcome arrive on
   * {@link follow}. An already-installed component answers with an `installed`
   * event and starts no job.
   * @param id - the component to install.
   * @returns after the job is running, or after the installed answer was published.
   * @throws RemoteError `component/busy` when another job is already running; `component/requires` when a prerequisite is not installed; `component/unsupported` on a host with no install path for it.
   */
  @Remote
  start(id: ComponentId): Promise<void> {
    return this.components.install(id)
  }

  /**
   * Cancel the running install job.
   * @param id - the component whose job should stop.
   * @returns after the job has settled and its partial install has been cleaned up.
   * @throws RemoteError `component/not-running` when this component has no running job.
   */
  @Remote
  cancel(id: ComponentId): Promise<void> {
    return this.components.cancel(id)
  }

  /**
   * Follow install events independently of the caller's own request lifetime.
   * @param signal - the client's observation lifetime.
   * @returns the running job's latest progress first, when one is running, then every subsequent event.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<ComponentEvent> {
    return this.components.follow(signal)
  }
}
