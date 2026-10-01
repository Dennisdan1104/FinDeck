/**
 * Host Remote owner of MCP server administration: the durable `mcp` settings
 * namespace, the runtime mounts that namespace describes, and the generated
 * `ctx.remote.mcpAdmin` namespace the settings page reads.
 *
 * Each configured server is one `@deepseek-ai/dsh-mcp-client` plugin instance
 * mounted as a child fiber of this plugin's own context — the same
 * `ctx.plugin(McpClient, config)` mount the ACP bridge performs for a
 * session's servers. The settings document is the only durable state and the
 * only composition source: `cordis.patch.yml` is never written, because the
 * plugin-patch surface cannot add a row that carries a config.
 *
 * The document is the single fact source for reconciliation. One committed
 * change disposes every mount it invalidated before mounting the replacements,
 * so a `serverName` reservation is released before it is taken again, and a
 * server that vanishes or turns `disabled` loses its child fiber, its
 * connection, and its registered tools together.
 *
 * @module @deepseek-ai/dsh-api-mcp-controller
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: declaration-merges `ctx.tools` onto Context, so the status read
// resolves the registry instead of the untyped service lookup.
import type {} from '@deepseek-ai/dsh-tools'
import type {
  McpAdminSnapshot, McpServerInput, McpServerStatus, McpServerTemplate, McpServerView, McpToolView,
} from './types.ts'

export type * from './types.ts'

/** Settings namespace owning the durable MCP server list. */
export const MCP_SETTINGS_NAMESPACE = 'mcp'

/** Server-name grammar `@deepseek-ai/dsh-mcp-client` accepts for a tool namespace. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Public tool-name prefix one `serverName` owns inside `ctx.tools`. */
const TOOL_PREFIX = 'mcp__'

/** Per-tool-call timeout (ms) for servers this page mounts; the client's own default. */
const TOOL_CALL_TIMEOUT_MS = 60_000

/** One stored server definition, resolved by the `mcp` namespace schema. */
interface McpServerSection {
  id: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  headers: Record<string, string>
  disabled: boolean
}

/** The `mcp` namespace document. */
interface McpSettings {
  servers: McpServerSection[]
}

/**
 * Durable MCP server list. `env` and `headers` carry the `secret` role so the
 * generic configuration surface redacts them; this controller never projects
 * either value onto the wire at all.
 */
const settingsSchema = Schema.object({
  servers: Schema.array(Schema.object({
    id: Schema.string().required(),
    serverName: Schema.string().required().pattern(SERVER_NAME_PATTERN),
    transport: Schema.union([Schema.const('stdio'), Schema.const('streamable-http')]).default('stdio'),
    command: Schema.string().default(''),
    args: Schema.array(String).default([]),
    env: Schema.dict(String).default({}).role('secret'),
    cwd: Schema.string().default(''),
    url: Schema.string().default(''),
    headers: Schema.dict(String).default({}).role('secret'),
    disabled: Schema.boolean().default(false),
  })).default([]),
}) as unknown as Schema<McpSettings>

/** One live child fiber mounted for a configured server. */
interface ServerMount {
  /** Definition the instance was built from; a different one re-mounts. */
  readonly signature: string
  /** Child fiber owning the client, its connection, and its tool registrations. */
  readonly fiber: Fiber
}

/** What is known about one server's mount before its tools answer for it. */
interface RuntimeState {
  /** `connecting` until the initial connect settles; `error` when it was refused. */
  readonly phase: 'connecting' | 'settled' | 'error'
  /** Failure text of a refused mount or configuration. */
  readonly error?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `mcpAdmin` Remote namespace. */
    mcpAdmin: McpController
  }
}

/**
 * Host service backing the generated `ctx.remote.mcpAdmin` namespace. Every
 * method answers with the whole snapshot — the durable definitions merged with
 * the live state — so one accepted response leaves the page consistent instead
 * of returning a delta the caller has to fold.
 */
export class McpController extends TypertRemoteService {
  /** The namespace owner scope, absent until the settings service is composed. */
  private settingsScope: SettingsScope<McpSettings> | undefined
  /** Live child fibers, keyed by the configured server id. */
  private readonly mounts = new Map<string, ServerMount>()
  /** Runtime state per server id of the live mount. */
  private readonly runtime = new Map<string, RuntimeState>()
  /** Serialized reconciliation chain: one document change or reconnect at a time. */
  private tail: Promise<void> = Promise.resolve()

  /**
   * Register the `mcpAdmin` namespace, then own the `mcp` settings namespace
   * once a settings provider is present. The child fiber holds the namespace
   * registration and its reconciliation together, so losing the provider
   * unmounts every server this controller added.
   * @param ctx - Host context where the settings provider and tool registry may be mounted.
   */
  constructor(ctx: Context) {
    super(ctx, 'mcpAdmin', { namespace: 'mcpAdmin' })
    ctx.inject(['settings'], (scoped) => {
      const scope = scoped.settings.register(MCP_SETTINGS_NAMESPACE, settingsSchema, { base: { servers: [] } })
      this.settingsScope = scope
      scoped.effect(() => {
        // A stored document may already carry servers — a restart, or a file
        // edited outside this process. Mounting here rather than in the
        // constructor gives that first pass the same path as every later change.
        void this.reconcile(scope.get()).catch(error => this.warn('initial reconciliation', error))
        const unwatch = scope.watch(next => this.reconcile(next))
        return async () => {
          unwatch()
          this.settingsScope = undefined
          await this.enqueue(() => this.releaseAll())
        }
      }, 'mcp-controller: settings-scoped server mounts')
    })
  }

  /**
   * List every configured server with its live state.
   * @returns the durable definitions merged with the current connection state and tools.
   */
  @Remote
  list(): McpAdminSnapshot {
    return this.snapshot()
  }

  /**
   * The curated catalog of well-known MCP servers the page can prefill a
   * definition from. Static data: adoption is an ordinary `upsert` once the
   * user edits and submits the form.
   * @returns the template catalog.
   */
  @Remote
  templates(): McpServerTemplate[] {
    return MCP_SERVER_TEMPLATES.map(template => ({ ...template, args: [...template.args], needsEnv: [...template.needsEnv] }))
  }

  /**
   * Create or update one server definition and apply it to the runtime.
   * @param server - the submitted definition; an empty `id` creates a server.
   * @returns the snapshot after the write and its mount reconciliation.
   * @throws RemoteError when the definition is invalid, its name is taken, no settings provider is mounted, or the document refuses the write.
   */
  @Remote
  async upsert(server: McpServerInput): Promise<McpAdminSnapshot> {
    const scope = this.scope()
    const stored = scope.get().servers
    const existing = server.id.length === 0
      ? undefined
      : stored.find(candidate => candidate.id === server.id)
    if (server.id.length > 0 && existing === undefined) {
      throw new RemoteError('mcp/not-found', `no configured MCP server has id "${server.id}"`, { id: server.id })
    }
    const entry = normalize(server, existing, stored)
    const servers = existing === undefined
      ? [...stored, { ...entry, id: mintId(stored) }]
      : stored.map(candidate => candidate.id === existing.id ? { ...entry, id: existing.id } : candidate)
    await this.write(scope, servers)
    return this.snapshot()
  }

  /**
   * Drop one server definition and unmount it.
   *
   * Named `deleteServer` rather than `remove` because the browser's Remote
   * namespace service owns `remove(kind, method, token)` for its own method
   * ledger; a Remote method of that name fails every namespace mount at once.
   * @param id - stored id of the server to remove.
   * @returns the snapshot after the write and its mount reconciliation.
   * @throws RemoteError when no server carries the id, no settings provider is mounted, or the document refuses the write.
   */
  @Remote
  async deleteServer(id: string): Promise<McpAdminSnapshot> {
    const scope = this.scope()
    const stored = scope.get().servers
    if (!stored.some(candidate => candidate.id === id)) {
      throw new RemoteError('mcp/not-found', `no configured MCP server has id "${id}"`, { id })
    }
    await this.write(scope, stored.filter(candidate => candidate.id !== id))
    return this.snapshot()
  }

  /**
   * Store one server's disabled flag, unmounting or mounting it accordingly.
   * @param id - stored id of the server to switch.
   * @param disabled - whether the server stays out of the runtime.
   * @returns the snapshot after the write and its mount reconciliation.
   * @throws RemoteError when no server carries the id, no settings provider is mounted, or the document refuses the write.
   */
  @Remote
  async setDisabled(id: string, disabled: boolean): Promise<McpAdminSnapshot> {
    const scope = this.scope()
    const stored = scope.get().servers
    if (!stored.some(candidate => candidate.id === id)) {
      throw new RemoteError('mcp/not-found', `no configured MCP server has id "${id}"`, { id })
    }
    await this.write(scope, stored.map(candidate => candidate.id === id ? { ...candidate, disabled } : candidate))
    return this.snapshot()
  }

  /**
   * Drop one server's live connection and mount a fresh instance from the same
   * definition — the manual retry after a server was fixed, or after a
   * reconnect loop gave up.
   * @param id - stored id of the server to reconnect.
   * @returns the snapshot after the new instance was mounted; a definition that
   *   is still `disabled` is left unmounted.
   * @throws RemoteError when no server carries the id.
   */
  @Remote
  async reconnect(id: string): Promise<McpAdminSnapshot> {
    const scope = this.scope()
    const server = scope.get().servers.find(candidate => candidate.id === id)
    if (server === undefined) {
      throw new RemoteError('mcp/not-found', `no configured MCP server has id "${id}"`, { id })
    }
    await this.enqueue(async () => {
      await this.unmount(id)
      if (!server.disabled) this.mount(server)
    })
    return this.snapshot()
  }

  /** The page state: the stored definitions projected onto their live runtime facts. */
  private snapshot(): McpAdminSnapshot {
    const settings = this.ctx.get('settings')
    const servers = this.settingsScope?.get().servers ?? []
    return {
      writable: settings?.writable ?? false,
      servers: servers.map(server => this.view(server)),
    }
  }

  /** Project one stored definition plus its live facts onto the wire view. */
  private view(server: McpServerSection): McpServerView {
    const state = this.runtime.get(server.id)
    const tools = this.toolsOf(server.serverName)
    return {
      id: server.id,
      serverName: server.serverName,
      transport: server.transport,
      command: server.command,
      args: [...server.args],
      cwd: server.cwd,
      url: server.url,
      disabled: server.disabled,
      envSet: Object.keys(server.env).length > 0,
      headersSet: Object.keys(server.headers).length > 0,
      status: statusOf(server, state, tools),
      ...state?.error === undefined ? {} : { error: state.error },
      tools,
    }
  }

  /**
   * The tools one server currently owns in the registry. `mcp-client` registers
   * every discovered tool as `mcp__<serverName>__<rawName>`, so the registry
   * itself is the live answer to "is this server connected, and to what".
   */
  private toolsOf(serverName: string): McpToolView[] {
    const tools = this.ctx.get('tools')
    if (tools === undefined) return []
    const prefix = `${TOOL_PREFIX}${serverName}__`
    return tools.schemas()
      .filter(schema => schema.name.startsWith(prefix))
      .map(schema => ({ name: schema.name.slice(prefix.length), description: schema.description }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  }

  /** Resolve the mounted settings scope, or report how to supply it. */
  private scope(): SettingsScope<McpSettings> {
    const scope = this.settingsScope
    if (scope === undefined) {
      throw new RemoteError(
        'mcp/rejected',
        'settings service is absent: this deployment does not mount a settings provider (e.g. @deepseek-ai/dsh-settings-file) to store the MCP server list',
        { reason: 'settings provider absent' },
      )
    }
    return scope
  }

  /** Persist one server list, then apply it to the runtime before answering. */
  private async write(scope: SettingsScope<McpSettings>, servers: readonly McpServerSection[]): Promise<void> {
    try {
      await scope.update({ servers: servers.map(server => ({ ...server })) })
    } catch (error: unknown) {
      throw new RemoteError(
        'mcp/rejected',
        `storing the MCP server list failed: ${messageOf(error)}`,
        { reason: messageOf(error) },
        { cause: error },
      )
    }
    await this.reconcile(scope.get())
  }

  /** Queue one document value and settle after the runtime matches it. */
  private reconcile(next: McpSettings): Promise<void> {
    return this.enqueue(() => this.applyDocument(next))
  }

  /** Serialize one runtime operation behind every earlier one. */
  private enqueue(operation: () => Promise<void> | void): Promise<void> {
    const run = this.tail.then(operation)
    // The chain tail stays fulfilled: one refused operation must not strand
    // every later change, and the caller still receives the real rejection.
    this.tail = run.catch(() => undefined)
    return run
  }

  /**
   * Bring the live mounts to the document's set: dispose every mount the
   * document no longer describes (or describes differently) before mounting
   * the replacements, because a `serverName` is reserved for as long as one
   * instance holds it.
   */
  private async applyDocument(next: McpSettings): Promise<void> {
    const desired = new Map(next.servers.map(server => [server.id, server]))
    for (const [id, mount] of [...this.mounts]) {
      const server = desired.get(id)
      if (server !== undefined && !server.disabled && mount.signature === signatureOf(server)) continue
      await this.unmount(id)
    }
    for (const server of next.servers) {
      if (server.disabled || this.mounts.has(server.id)) continue
      this.mount(server)
    }
  }

  /** Dispose one server's child fiber and forget its runtime state. */
  private async unmount(id: string): Promise<void> {
    const mount = this.mounts.get(id)
    this.mounts.delete(id)
    this.runtime.delete(id)
    if (mount !== undefined) await mount.fiber.dispose()
  }

  /** Dispose every mount; the teardown of the settings-owned registration. */
  private async releaseAll(): Promise<void> {
    for (const id of [...this.mounts.keys()]) await this.unmount(id)
    this.runtime.clear()
  }

  /**
   * Mount one client instance for a configured server. `failOnStartupError` is
   * false: a server that cannot start is a row state the page shows, never a
   * failure that could unload this controller or the Harness around it.
   */
  private mount(server: McpServerSection): void {
    const config = clientConfigOf(server)
    this.runtime.set(server.id, { phase: 'connecting' })
    let fiber: Fiber
    try {
      fiber = this.ctx.plugin(McpClient, config)
    } catch (error: unknown) {
      this.runtime.set(server.id, { phase: 'error', error: messageOf(error) })
      return
    }
    this.mounts.set(server.id, { signature: signatureOf(server), fiber })
    const settle = (state: RuntimeState): void => {
      // A superseded generation settles after its disposal; only the mount that
      // still owns this id may publish a state.
      if (this.mounts.get(server.id)?.fiber !== fiber) return
      this.runtime.set(server.id, state)
    }
    void fiber.await().then(
      () => { settle({ phase: 'settled' }) },
      (error: unknown) => { settle({ phase: 'error', error: messageOf(error) }) },
    )
  }

  /** Contained diagnostic: a reconciliation failure must not escape the watcher. */
  private warn(subject: string, error: unknown): void {
    this.ctx.logger.warn(`mcp-controller: ${subject} failed: ${messageOf(error)}`)
  }
}

/** The live connection state one row reports. */
function statusOf(
  server: McpServerSection,
  state: RuntimeState | undefined,
  tools: readonly McpToolView[],
): McpServerStatus {
  if (server.disabled) return 'disabled'
  if (state?.phase === 'error') return 'error'
  if (state === undefined || state.phase === 'connecting') return 'connecting'
  return tools.length > 0 ? 'connected' : 'disconnected'
}

/** The exact client config one stored definition mounts, and the mount identity. */
function clientConfigOf(server: McpServerSection): McpClient.Config {
  const common = {
    serverName: server.serverName,
    toolCallTimeoutMs: TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: false,
  }
  if (server.transport === 'stdio') {
    return {
      ...common,
      transport: 'stdio',
      command: server.command,
      args: [...server.args],
      env: { ...server.env },
      cwd: server.cwd,
    }
  }
  return {
    ...common,
    transport: 'streamable-http',
    url: server.url,
    headers: { ...server.headers },
  }
}

/** The mount identity: two equal signatures describe one identical instance. */
function signatureOf(server: McpServerSection): string {
  return JSON.stringify(clientConfigOf(server))
}

/**
 * Validate one submitted definition and merge it over the entry it replaces.
 * The stored environment and headers survive a submission that does not carry
 * them, because the page that renders the form never received either value.
 * @param input - the submitted definition.
 * @param existing - the stored entry being updated, when the id names one.
 * @param stored - every stored entry, for the name-collision check.
 * @returns the merged, schema-conformant entry (its id is the caller's to set).
 * @throws RemoteError when the name is malformed or taken, a stdio server has no command, or the URL is not absolute HTTP(S).
 */
function normalize(
  input: McpServerInput,
  existing: McpServerSection | undefined,
  stored: readonly McpServerSection[],
): McpServerSection {
  const serverName = input.serverName.trim()
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new RemoteError(
      'mcp/invalid',
      `serverName "${input.serverName}" must match ${String(SERVER_NAME_PATTERN)}`,
      { field: 'serverName' },
    )
  }
  if (stored.some(candidate => candidate.serverName === serverName && candidate.id !== existing?.id)) {
    throw new RemoteError(
      'mcp/conflict',
      `serverName "${serverName}" is already used by another configured server`,
      { serverName },
    )
  }
  const env = input.env ?? existing?.env ?? {}
  const headers = input.headers ?? existing?.headers ?? {}
  if (input.transport === 'stdio') {
    const command = input.command.trim()
    if (command.length === 0) {
      throw new RemoteError('mcp/invalid', 'a stdio server needs a command to start', { field: 'command' })
    }
    return {
      id: existing?.id ?? '',
      serverName,
      transport: 'stdio',
      command,
      args: [...input.args],
      env,
      cwd: input.cwd.trim(),
      url: '',
      headers,
      disabled: existing?.disabled ?? false,
    }
  }
  const url = input.url.trim()
  if (!isHttpUrl(url)) {
    throw new RemoteError('mcp/invalid', `"${input.url}" is not an absolute HTTP(S) URL`, { field: 'url' })
  }
  return {
    id: existing?.id ?? '',
    serverName,
    transport: 'streamable-http',
    command: '',
    args: [],
    env,
    cwd: '',
    url,
    headers,
    disabled: existing?.disabled ?? false,
  }
}

/** Whether a value is an absolute HTTP(S) URL. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_invalidUrl) {
    return false
  }
}

/** Mint an id no stored entry occupies, keeping the document's ids short. */
function mintId(servers: readonly McpServerSection[]): string {
  const used = new Set(servers.map(server => server.id))
  for (let index = servers.length + 1; ; index += 1) {
    const candidate = `server-${index}`
    if (!used.has(candidate)) return candidate
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The curated MCP server catalog the settings page offers. Every entry is a
 * stdio command line run through the user's own package runner; `<…>` tokens
 * in `args` mark the values the form asks the user to supply.
 */
const MCP_SERVER_TEMPLATES: readonly McpServerTemplate[] = [
  {
    id: 'memory',
    label: 'Memory',
    description: 'Knowledge-graph long-term memory: the agent remembers entities and relations across sessions.',
    transport: 'stdio',
    serverName: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    needsEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    description: 'Read, write, and search files inside the directories you allow.',
    transport: 'stdio',
    serverName: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '<directory-to-allow>'],
    needsEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning with revision and branching for hard problems.',
    transport: 'stdio',
    serverName: 'thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    needsEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    id: 'fetch',
    label: 'Fetch',
    description: 'Fetch web pages and convert them to Markdown for the agent to read.',
    transport: 'stdio',
    serverName: 'fetch',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    needsEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'playwright',
    label: 'Playwright',
    description: 'Drive a real browser: navigate pages, click, fill forms, and take screenshots.',
    transport: 'stdio',
    serverName: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    needsEnv: [],
    homepage: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Read and manage GitHub repositories, issues, and pull requests.',
    transport: 'stdio',
    serverName: 'github',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    needsEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'context7',
    label: 'Context7',
    description: 'Up-to-date library documentation and code examples fetched straight into the prompt.',
    transport: 'stdio',
    serverName: 'context7',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    needsEnv: [],
    homepage: 'https://github.com/upstash/context7',
  },
  {
    id: 'time',
    label: 'Time',
    description: 'Current time and timezone conversion tools.',
    transport: 'stdio',
    serverName: 'time',
    command: 'uvx',
    args: ['mcp-server-time'],
    needsEnv: [],
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },
]

export default McpController
