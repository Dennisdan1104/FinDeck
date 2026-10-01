# MCP

English | [中文](mcp.zh.md)

Model Context Protocol (MCP) attaches external tool servers to the harness. [`mcp-client`](../../packages/mcp/mcp-client/README.md) is a per-server connection plugin: it connects over stdio or Streamable HTTP and registers each discovered tool on [`ctx.tools`](tools.md) under the stable public name `mcp__<serverName>__<rawName>`. [`mcp-resources`](../../packages/mcp/mcp-resources/README.md) owns the scoped resource registry `ctx.mcpResources` and the three shared discovery/read tools a scope exposes while it has at least one provider. [`api-mcp-controller`](../../packages/api/mcp-controller/README.md) owns the Host Remote namespace `ctx.mcpAdmin`, stores the durable server list in the `mcp` [settings](settings.md) namespace, and mounts one client instance per enabled entry.

## Responsibilities

Each configured server is one `mcp-client` entry, mounted either statically in a profile or by the controller from the settings document. The client owns its connection generation, its reconnect policy, its discovered tool generation, and its `serverName` reservation; a server contributes no shared `ctx.mcp` service of its own. The public tool name carries the configured `serverName`, so two servers exposing the same raw tool name stay distinct, and a duplicate `serverName` inside one scope fails the second instance at load.

Resource access is a separate, scoped seam. A connection supplies `McpResourceProvider` operations for its own server; the first provider visible in a scope registers `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource` for that scope, and removing the last provider removes them. Resource names are resolved in the calling Agent's scope before any network request, so a name that is not visible fails without contacting a server. Canonical resource JSON stays available to programmatic callers while binary payloads project into model text as descriptions.

## Limits

MCP prompts, elicitation, and resource subscriptions are not bridged. A server that exposes no tools connects with an empty tool set. `mcp-resources` publishes its three tools only while a scope has a visible provider, so mounting the service alone adds nothing to the model catalog.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmcpadmin--mcpcontroller"></a>

### `ctx.mcpAdmin` — `McpController`

Host service backing the generated `ctx.remote.mcpAdmin` namespace. Every method answers with the whole snapshot — the durable definitions merged with the live state — so one accepted response leaves the page consistent instead of returning a delta the caller has to fold.

```ts cordis-catalog
/**
 * List every configured server with its live state.
 * @returns the durable definitions merged with the current connection state and tools.
 */
@Remote list(): McpAdminSnapshot

/**
 * The curated catalog of well-known MCP servers the page can prefill a
 * definition from. Static data: adoption is an ordinary `upsert` once the
 * user edits and submits the form.
 * @returns the template catalog.
 */
@Remote templates(): McpServerTemplate[]

/**
 * Create or update one server definition and apply it to the runtime.
 * @param server - the submitted definition; an empty `id` creates a server.
 * @returns the snapshot after the write and its mount reconciliation.
 * @throws RemoteError when the definition is invalid, its name is taken, no settings provider is mounted, or the document refuses the write.
 */
@Remote async upsert(server: McpServerInput): Promise<McpAdminSnapshot>

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
@Remote async deleteServer(id: string): Promise<McpAdminSnapshot>

/**
 * Store one server's disabled flag, unmounting or mounting it accordingly.
 * @param id - stored id of the server to switch.
 * @param disabled - whether the server stays out of the runtime.
 * @returns the snapshot after the write and its mount reconciliation.
 * @throws RemoteError when no server carries the id, no settings provider is mounted, or the document refuses the write.
 */
@Remote async setDisabled(id: string, disabled: boolean): Promise<McpAdminSnapshot>

/**
 * Drop one server's live connection and mount a fresh instance from the same
 * definition — the manual retry after a server was fixed, or after a
 * reconnect loop gave up.
 * @param id - stored id of the server to reconnect.
 * @returns the snapshot after the new instance was mounted; a definition that
 *   is still `disabled` is left unmounted.
 * @throws RemoteError when no server carries the id.
 */
@Remote async reconnect(id: string): Promise<McpAdminSnapshot>
```

Source: [`packages/api/mcp-controller/src/index.ts`](../../packages/api/mcp-controller/src/index.ts)

<a id="ctxmcpresources--mcpresourceruntime"></a>

### `ctx.mcpResources` — `McpResourceRuntime`

Scoped resource access plus three tools shared by configured MCP servers.

```ts cordis-catalog
/**
 * Register one server and expose resource tools while that scope has providers.
 * @param server - configured server name, unique in this scope.
 * @param provider - connection-owned resource operations.
 * @returns the effect disposer for this exact registration.
 */
register(server: string, provider: McpResourceProvider): () => void
```

Source: [`packages/mcp/mcp-resources/src/index.ts`](../../packages/mcp/mcp-resources/src/index.ts)
<!-- END GENERATED cordis-surface -->
