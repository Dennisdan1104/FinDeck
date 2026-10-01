/**
 * MCP settings page store: one snapshot joining the Host's `mcpAdmin`
 * administration surface with the page's own loading state. The Host stays the
 * single fact source — every write answers with the whole snapshot after its
 * mount reconciliation ran, so the page re-renders from one accepted response
 * instead of folding a delta.
 *
 * Connection state is read, not pushed: the page reloads when it opens, after
 * every accepted write, and while a server is still connecting. That last part
 * is what makes a connect visible within a couple of seconds without a
 * permanent poll — the follow-up budget is spent only on a load the user
 * started or a server that has not settled yet.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  McpAdminSnapshot, McpServerInput, McpServerTemplate, McpServerView, RemoteResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Delay between two status reads while a server has not settled yet (ms). */
const FOLLOW_UP_DELAY_MS = 1_500

/** Status reads one user-visible load may chain before the page waits for the next open. */
const MAX_FOLLOW_UPS = 8

/** The curated-template slice: static Host data, loaded lazily once per page. */
export interface McpTemplatesState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Template-load failure text. */
  error: string | null
  /** The catalog the Host answered, in catalog order. */
  items: readonly McpServerTemplate[]
}

/** Page snapshot. */
export interface McpSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load or whole-write failure text. */
  error: string | null
  /** Whether the Host document accepts writes for this namespace. */
  writable: boolean
  /** Every configured server with its live state, in document order. */
  servers: readonly McpServerView[]
  /** The recommended-template catalog, on its own load track. */
  templates: McpTemplatesState
}

/** The MCP settings page controller (one per settings surface). */
export class McpSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<McpSettingsState> = createSnapshotStore<McpSettingsState>({
    status: 'idle', error: null, writable: false, servers: [],
    templates: { status: 'idle', error: null, items: [] },
  })

  /** Latest templates answer wins; the catalog loads independently of the server list. */
  private templatesGeneration = 0

  /** Latest accepted answer wins; a superseded response never overwrites a newer one. */
  private generation = 0
  /** Status reads already chained by the load the user is looking at. */
  private followUps = 0
  /** Pending status read during a connect, cleared by the next load or write. */
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param ctx - the page plugin's context, whose `remote.mcpAdmin` namespace
   * carries the snapshot and every write.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Refresh the whole snapshot from a fresh follow-up budget. The section calls
   * this when it opens, so the state the user sees is the state the Host has now.
   * @returns settlement after the answer is published either way.
   */
  async load(): Promise<void> {
    this.followUps = 0
    await this.fetch()
  }

  /**
   * Load the curated-template catalog once. A settled success is final — the
   * data is static — while a failure leaves the slice in `error`, from which
   * the section's retry button calls this again.
   * @returns settlement after the answer is published either way.
   */
  async loadTemplates(): Promise<void> {
    const status = this.store.getSnapshot().templates.status
    if (status === 'loading' || status === 'ready') return
    const generation = ++this.templatesGeneration
    this.store.update((state) => { state.templates.status = 'loading'; state.templates.error = null })
    const response = await this.ctx.remote.mcpAdmin.templates()
    if (generation !== this.templatesGeneration) return
    this.store.update((state) => {
      if (!response.ok) {
        state.templates.status = 'error'
        state.templates.error = response.error.message
        return
      }
      state.templates.status = 'ready'
      state.templates.error = null
      state.templates.items = response.value
    })
  }

  /**
   * Create or update one server definition.
   * @param server - the submitted definition; an empty id creates a server.
   * @returns the failure message, or undefined once the Host accepted the write.
   */
  upsert(server: McpServerInput): Promise<string | undefined> {
    return this.mutate(() => this.ctx.remote.mcpAdmin.upsert(server))
  }

  /**
   * Delete one server definition and unmount it.
   * @param id - stored id of the server to remove.
   * @returns the failure message, or undefined once the Host accepted the write.
   */
  remove(id: string): Promise<string | undefined> {
    return this.mutate(() => this.ctx.remote.mcpAdmin.deleteServer(id))
  }

  /**
   * Store one server's disabled flag.
   * @param id - stored id of the server to switch.
   * @param disabled - whether the server stays out of the runtime.
   * @returns the failure message, or undefined once the Host accepted the write.
   */
  setDisabled(id: string, disabled: boolean): Promise<string | undefined> {
    return this.mutate(() => this.ctx.remote.mcpAdmin.setDisabled(id, disabled))
  }

  /**
   * Drop one server's live connection and mount it again.
   * @param id - stored id of the server to reconnect.
   * @returns the failure message, or undefined once the Host accepted the call.
   */
  reconnect(id: string): Promise<string | undefined> {
    return this.mutate(() => this.ctx.remote.mcpAdmin.reconnect(id))
  }

  /** Run one Host call, publish its snapshot, and report its failure. */
  private mutate(operation: () => Promise<RemoteResult<McpAdminSnapshot>>): Promise<string | undefined> {
    this.followUps = 0
    const generation = ++this.generation
    return operation().then((response) => {
      this.publish(generation, response)
      return response.ok ? undefined : response.error.message
    })
  }

  /** Read the snapshot without resetting the follow-up budget. */
  private async fetch(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    this.publish(generation, await this.ctx.remote.mcpAdmin.list())
  }

  /** Publish one response's snapshot unless a newer operation already took over. */
  private publish(generation: number, response: RemoteResult<McpAdminSnapshot>): void {
    if (generation !== this.generation) return
    if (!response.ok) {
      this.cancelFollowUp()
      this.store.update((state) => { state.status = 'error'; state.error = response.error.message })
      return
    }
    const snapshot = response.value
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.writable = snapshot.writable
      state.servers = snapshot.servers
    })
    this.scheduleFollowUp(snapshot.servers)
  }

  /**
   * Read the state again while a server has not settled, up to the budget. The
   * budget is what keeps this from becoming a permanent poll: it starts again
   * only when the user opens the page or issues a write.
   * @param servers - the servers just published.
   */
  private scheduleFollowUp(servers: readonly McpServerView[]): void {
    this.cancelFollowUp()
    if (!servers.some(server => server.status === 'connecting')) {
      this.followUps = 0
      return
    }
    if (this.followUps >= MAX_FOLLOW_UPS) return
    this.followUps += 1
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.fetch()
    }, FOLLOW_UP_DELAY_MS)
  }

  /** Drop the pending status read, if one is armed. */
  private cancelFollowUp(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

/**
 * Fill one localized template's `{name}` placeholders.
 * @param template - dictionary string carrying the placeholders.
 * @param values - placeholder name to text; wire data stays verbatim.
 * @returns the rendered label.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}
