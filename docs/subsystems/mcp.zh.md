# MCP

[English](mcp.md) | 中文

Model Context Protocol（MCP）把外部工具服务器接入 Harness。[`mcp-client`](../../packages/mcp/mcp-client/README.md) 是每服务器一个的连接插件：通过 stdio 或 Streamable HTTP 连接，并把发现的每个工具以稳定的公开名 `mcp__<serverName>__<rawName>` 注册到 [`ctx.tools`](tools.md)。[`mcp-resources`](../../packages/mcp/mcp-resources/README.md) 拥有按作用域划分的资源注册表 `ctx.mcpResources`，以及某个作用域在至少有一个提供方时暴露的三个共享发现/读取工具。[`api-mcp-controller`](../../packages/api/mcp-controller/README.md) 拥有 Host Remote 命名空间 `ctx.mcpAdmin`，把服务器列表持久化在 `mcp` [设置](settings.md)命名空间中，并为每个启用的条目挂载一个客户端实例。

## 职责

每个已配置的服务器是一个 `mcp-client` 条目，既可以在 profile 中静态挂载，也可以由控制器根据设置文档挂载。客户端拥有自己的连接代际、重连策略、已发现的工具代际以及 `serverName` 预留；服务器本身不贡献共享的 `ctx.mcp` 服务。公开工具名携带已配置的 `serverName`，因此两个暴露相同原始工具名的服务器仍然互相区分，而同一作用域内重复的 `serverName` 会让第二个实例在加载时失败。

资源访问是另一条按作用域划分的接缝。连接为自己的服务器提供 `McpResourceProvider` 操作；某个作用域中第一个可见的提供方会为该作用域注册 `list_mcp_resources`、`list_mcp_resource_templates` 和 `read_mcp_resource`，移除最后一个提供方则移除它们。资源名在任何网络请求之前先在调用方 Agent 的作用域中解析，因此不可见的名字会在不联系服务器的情况下失败。规范资源 JSON 对程序化调用方保持可用，而二进制载荷在投影到模型文本时成为描述。

## 限制

MCP 的 prompts、elicitation 和资源订阅不在桥接范围内。不暴露任何工具的服务器会以空工具集连接。`mcp-resources` 只在其作用域有可见提供方时才发布那三个工具，因此仅挂载该服务不会向模型目录添加任何内容。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
