---
description: "Host Remote owner for MCP server administration: the durable mcp settings namespace and the runtime mounts it describes."
kind: "package-reference"
---
# MCP Controller

## Summary

`@deepseek-ai/dsh-api-mcp-controller` exposes the generated `ctx.remote.mcpAdmin` namespace and owns the durable `mcp` settings namespace. It stores the user's MCP server list in the settings document, mounts one `@deepseek-ai/dsh-mcp-client` plugin instance per enabled entry, and answers the whole page state — every definition merged with its live connection state and tool list — from one read. Changes take effect at runtime: each committed document change disposes the mounts it invalidated before mounting the replacements, so nothing has to be written to `cordis.patch.yml` or the Host restarted.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as a Loader entry in a profile whose browser surface owns MCP servers. The `mcpAdmin` namespace is registered in the constructor, independently of the settings service, so an invocation over an incomplete composition reports a named error instead of a missing method.

`list()` answers the page state: every stored server with its name, transport, command or URL, disabled flag, whether environment variables and headers are stored, its connection state, and the tools it currently exposes. `writable` reports whether the settings document accepts writes.

`upsert(server)` creates or updates one definition. An empty `id` creates a server and the Host mints the id; any other id must already exist. `env` and `headers` are write-only: an absent field keeps the stored map, and an empty map clears it — the page that renders the form never received either value, so it can never delete one by accident. A `serverName` that another entry already uses is refused as `mcp/conflict`; a malformed name, a stdio server without a command, and a URL that is not absolute HTTP(S) are refused as `mcp/invalid`. `deleteServer(id)`, `setDisabled(id, disabled)`, and `reconnect(id)` complete the surface. The delete method is not named `remove`: the browser's Remote namespace service owns `remove(kind, method, token)` for its own method ledger, and a Remote method of that name fails every namespace mount in the client at once.

Every write answers with the whole snapshot after its mount reconciliation ran, so the page never renders a half-applied change. `reconnect` disposes the live instance and mounts a fresh one from the same definition — the manual retry for a server that was fixed after its reconnect budget was exhausted.

`templates()` answers the curated catalog of well-known MCP servers (memory, filesystem, sequential-thinking, fetch, Playwright, GitHub, Context7, time). It is static data with no side effects: the page prefills its add form from a template, and adoption is an ordinary `upsert` once the user replaces the `<placeholder>` argument tokens and fills the environment variables `needsEnv` names.

Environment variables and request headers are stored as ordinary plain text in the user's settings document, the same trust level as a `.env` file. They are marked `role('secret')` so the generic configuration surface redacts them, and this controller never projects either value onto the wire: the snapshot carries `envSet` and `headersSet` instead.

## Model Experience

Indirect: mounting a server is the model-visible effect. A server's tools appear in the model-facing catalog as `mcp__<serverName>__<rawName>` at the next turn, and disappear from it as soon as the entry is disabled, removed, or fails to start.

#### KV Cache effect

The prompt prefix changes when the tool catalog changes, exactly as it does for any other registration: a mounted or unmounted server invalidates the cached catalog and the next request re-reads it. The controller itself adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`connected` is observed through the tool registry.** `@deepseek-ai/dsh-mcp-client` exposes no status query, so a server counts as connected exactly while at least one `mcp__<serverName>__*` tool is registered. A server that legitimately exposes no tool reads as `disconnected` even though its transport is up.
- **A failed initial connection reads as `disconnected`, not as an error.** The client mounts with `failOnStartupError: false` so a bad definition cannot unload the Host; its first failure is logged by the client and the supervisor keeps retrying. Only a refused mount or an invalid definition (a duplicate `serverName`, a config the client's schema rejects) is reported as `error` with its message.
- **A hand-edited duplicate `serverName` does not fail the document.** It is refused at the next `upsert`, and the second entry shows the client's own duplicate-name error as its row state; registering a validation hook instead would unload this controller for the whole deployment.
- **Server status is read, not pushed.** The page refreshes on open, after every write, and while a server is still connecting; a server that connects or drops while the page is idle shows its new state at the next refresh.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The mounts are child fibers of this plugin's own context, one per configured server, and the settings document is their only source. One reconciliation disposes every invalidated mount before mounting its replacement: `@deepseek-ai/dsh-mcp-client` reserves a `serverName` in a process-wide map for as long as an instance holds it, so a rename or a config change must release the old reservation first. The reconciliation chain is serialized, and the watcher and every Remote write both funnel through it — a write therefore answers with the state its own change produced rather than racing its own watcher.

</details>

**Runtime invariant:** No companion is published. The settings namespace owns storage and change notification and `@deepseek-ai/dsh-mcp-client` owns its own connection and tool lifecycle; this package only wires them and projects the result onto the wire.
