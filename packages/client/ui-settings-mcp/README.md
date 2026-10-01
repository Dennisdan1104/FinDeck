---
description: "MCP servers settings page for the dsh web client: the configured servers, their live connection state and tools, and the editor that changes them."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-settings-mcp

## Summary

`dsh-client-ui-settings-mcp` is the MCP servers settings page of the dsh web client. It lists every configured Model Context Protocol server with its transport, connection state, and the tools the server currently exposes, and it owns the editor that creates, updates, disables, reconnects, and deletes a definition. Every control writes through the Host's `mcpAdmin` Remote namespace, so a change lands in the durable `mcp` settings document and is applied to the runtime before the page answers — nothing here edits `cordis.patch.yml` or asks for a restart.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open **MCP** from the Settings navigation. Each row shows the server name, its transport (`stdio` or `streamable HTTP`), a status dot with its word, the command or URL it connects to, and whether environment variables and headers are stored. Expanding **Tools** lists the tool names and descriptions the server currently exposes — the same names it contributes to the model as `mcp__<serverName>__<rawName>`.

The switch stops and starts one server without deleting it: a disabled server keeps its definition, is unmounted immediately, and its tools leave the model catalog. **Reconnect** drops the live connection and mounts the server again — the retry after fixing a broken command, or after a reconnect budget was exhausted. **Edit** opens the definition in place; **Remove** asks for confirmation and then deletes the definition and its mount together. **Add server** opens the same editor empty, and every Add click replaces whatever draft was open with a fresh one for that request.

The editor switches its fields with the transport: a stdio server takes a command, one argument per line, a working directory, and environment variables; a Streamable HTTP server takes the endpoint URL and request headers. Environment variables and headers enter as `NAME=VALUE` lines; the Host never sends their stored values back, so both fields start empty and leaving one empty keeps whatever is stored, while typing anything replaces the whole map.

Below the configured rows, **Templates** offers the Host's curated catalog of well-known servers. Each card shows the label, description, a homepage link, and badges for the requirements the template leaves to the user — the environment variable names it expects and a hint when its arguments contain `<placeholder>` tokens. **Add** on a card only prefills the new-server editor with the template's name, transport, command, and arguments; nothing is saved until the user replaces the placeholders, fills the environment variables, and submits through the ordinary form. A card whose suggested name is already taken by a configured server keeps its button disabled with a tooltip naming the conflict. The catalog loads lazily once; a failure renders inline with a retry button and never disturbs the server list.

A server that cannot be mounted shows its refusal on the row, and the section prints the failure of the last write. When the settings document is read-only, every control is disabled and the page says so.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page holds no facts of its own. `ctx.remote.mcpAdmin.list()` answers the whole snapshot — every definition merged with the connection state and tool list the Host observes — and each of `upsert`, `remove`, `setDisabled`, and `reconnect` answers the whole snapshot again after its own change, so one accepted response replaces the store's rows and a row can never show a half-applied edit. A superseded response is dropped by a generation counter.

Connection state is read rather than pushed: there is no Host event for it. The section loads when it opens and after every accepted write, and while a server has not settled it schedules a bounded series of follow-up reads (one every 1.5s, at most eight). The budget restarts only on the next open or write, so the page never keeps polling in the background.

Environment variables and headers are write-only by construction: the snapshot carries `envSet`/`headersSet` booleans and never a value, so the editor tracks those two fields as "touched" instead of comparing text — an empty textarea cannot distinguish "keep the stored map" from "clear it".

The template catalog rides its own slice of the page snapshot with its own generation counter and load guard: `ctx.remote.mcpAdmin.templates()` answers static data, so a settled success is never re-fetched, while a failure stays retryable. Adopting a template is pure Client behavior — it opens the new-server editor with a draft built from that template (arguments joined one per line, empty url/cwd) and then flows through the unchanged `upsert` path; the Host learns nothing about templates.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the domain base whose `settings.section` slot this page registers into.
- [api-mcp-controller](../../api/mcp-controller/README.md) — the Host owner of the durable list, the runtime mounts, and the snapshot.
- [mcp-client](../../mcp/mcp-client/README.md) — the client each enabled server is mounted as.

-----

<a id="model-experience"></a>
## Model Experience

Indirect: mounting a server is the model-visible effect. Its tools appear in the model-facing catalog at the next turn and leave it as soon as the entry is disabled, removed, or fails to start. The page itself adds no prompt content.

#### KV Cache effect

The prompt prefix changes when the tool catalog changes, exactly as it does for any other registration; the page adds no content of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Status is sampled, not subscribed.** A server that connects or drops while the page sits idle shows its new state at the next refresh, because the Host exposes no push channel for it.
- **A server with no tools reads as disconnected.** The Host observes connectivity through the tool registry, which is the only status `@deepseek-ai/dsh-mcp-client` exposes; a live server that exposes no tool cannot be told apart from a server that is down.
- **The editor has no per-key environment editing.** Environment variables and headers are stored as whole maps, matching their `role('secret')` declaration in the settings schema; a one-key change rewrites the map.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A settings page that reads one Remote namespace and owns one page store, with no cross-plugin mutable relation.
