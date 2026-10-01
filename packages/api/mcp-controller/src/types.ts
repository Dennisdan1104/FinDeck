/**
 * Browser-safe vocabulary of the MCP server administration surface. The
 * definitions are user configuration and the rest are live facts; environment
 * variables and request headers never ride any of these types, so a secret
 * cannot reach a browser through the read that renders the page.
 *
 * @module @deepseek-ai/dsh-api-mcp-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The submitted server definition is not usable: a field failed its own rule. */
    'mcp/invalid': { readonly field: string }
    /** Another configured server already uses the submitted `serverName`. */
    'mcp/conflict': { readonly serverName: string }
    /** No configured server carries the requested id. */
    'mcp/not-found': { readonly id: string }
    /** The durable document refused the write, or no settings provider is mounted. */
    'mcp/rejected': { readonly reason: string }
  }
}

/**
 * Connection state of one configured server, as the Host currently observes it.
 *
 * `connected` is observed through the tool registry: the mounted client
 * registers each of its tools on `ctx.tools`, so a live server with at least one
 * tool is connected. A server that exposes no tool at all reads as
 * `disconnected` — see the package README's known limitations.
 */
export type McpServerStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error'

/** One tool a connected server currently exposes, without its schema. */
export interface McpToolView {
  /** Raw MCP tool name, without the `mcp__<serverName>__` public prefix. */
  readonly name: string
  /** Server-supplied description, empty when the server did not send one. */
  readonly description: string
}

/** One configured MCP server: its durable definition, live state, and tools. */
export interface McpServerView {
  /** Stable id the document owns; the key every write and switch addresses. */
  readonly id: string
  /** Local namespace of the model-facing tool names (`mcp__<serverName>__<tool>`). */
  readonly serverName: string
  /** Transport the Host mounts this server with. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Executable of a stdio server; empty for a Streamable HTTP server. */
  readonly command: string
  /** Verbatim arguments of a stdio server. */
  readonly args: readonly string[]
  /** Working directory of a stdio server; empty means the Host's own. */
  readonly cwd: string
  /** MCP endpoint of a Streamable HTTP server; empty for a stdio server. */
  readonly url: string
  /** Whether the durable `disabled` flag keeps this server unmounted. */
  readonly disabled: boolean
  /** Whether environment variables are stored; their values never leave the Host. */
  readonly envSet: boolean
  /** Whether request headers are stored; their values never leave the Host. */
  readonly headersSet: boolean
  /** Current connection state. */
  readonly status: McpServerStatus
  /** Failure text when the mount or its configuration was refused. */
  readonly error?: string
  /** Tools the server currently exposes, name-sorted. */
  readonly tools: readonly McpToolView[]
}

/** The complete page state: every configured server plus document writability. */
export interface McpAdminSnapshot {
  /** Every configured server, in document order. */
  readonly servers: readonly McpServerView[]
  /** Whether the settings document accepts writes; false disables every control. */
  readonly writable: boolean
}

/**
 * One submitted server definition. Environment variables and request headers
 * are write-only: an absent field keeps the stored map, while an empty map
 * clears it, so a form that never received a value cannot delete one.
 */
export interface McpServerInput {
  /** Stored id to update; an empty string creates a new server. */
  readonly id: string
  /** Local namespace of the model-facing tool names. */
  readonly serverName: string
  /** Transport the Host mounts this server with. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Executable of a stdio server; ignored by the HTTP transport. */
  readonly command: string
  /** Verbatim arguments of a stdio server; ignored by the HTTP transport. */
  readonly args: readonly string[]
  /** Working directory of a stdio server; empty means the Host's own. */
  readonly cwd: string
  /** MCP endpoint of a Streamable HTTP server; ignored by the stdio transport. */
  readonly url: string
  /** Replacement environment variables; absent keeps the stored map. */
  readonly env?: Record<string, string>
  /** Replacement request headers; absent keeps the stored map. */
  readonly headers?: Record<string, string>
}

/**
 * One curated MCP server template the page offers for one-click adoption.
 * Adopting a template is a form prefill on the Client and an ordinary
 * `upsert` on the wire — nothing here mounts by itself.
 */
export interface McpServerTemplate {
  /** Stable template identity. */
  readonly id: string
  /** Display name of the server (e.g. `Filesystem`). */
  readonly label: string
  /** What the server gives the agent, in the template's own words. */
  readonly description: string
  /** Transport the prefilled definition uses. */
  readonly transport: 'stdio' | 'streamable-http'
  /** Suggested local tool namespace; still user-editable. */
  readonly serverName: string
  /** Prefilled executable of a stdio template. */
  readonly command: string
  /** Prefilled arguments; a `<placeholder>` token marks a value the user must supply. */
  readonly args: readonly string[]
  /** Environment variable names the template expects the user to fill in. */
  readonly needsEnv: readonly string[]
  /** Project or documentation link. */
  readonly homepage: string
}
