---
description: "The model-facing FinDeck two-level memory tools: write a durable note into the global or the calling project's store, read one back by slug, and list both stores."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

English | [中文](README.zh.md)

## Summary

An agent that learns something worth keeping — a user preference, a project convention, the reason an approach was abandoned — has nowhere to put it: session logs are read back as history, not consulted as knowledge. This consumer package gives the model three tools over two plain-file memory stores. `memory_write` upserts one titled markdown entry, `memory_read` reads one entry by slug from exactly one store, and `memory_list` lists one or both stores newest first.

The global store is `<harness home>/memory` (the configured home, `$DSH_HOME`, else `~/.findeck`); the project store is the `memory/` directory of the project directory `resolveProjectDir` derives for the workspace that owns the calling session's working directory. The two stores are namespaces rather than one hierarchy — a read names its store and a miss there is a miss — and an omitted scope on a write means the project store, which fails loud for a session whose working directory belongs to no workspace.

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

Mount the plugin to give the agent durable memory. It requires `ctx.tools`; the global store directory is package configuration, and the project store is read from the optional `ctx.workspaceRegistry`, so a composition without a workspace service still offers the global store.

### When to choose it

Use it in FinDeck compositions where the agent should carry facts across turns and sessions: user preferences, project conventions, decisions and the reasons behind them. A composition that wants durable knowledge to live in versioned files under the repository should keep using the filesystem tools instead — memory is not a document store, and nothing indexes it.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    globalDir: '~/.findeck/memory'
```

| Field | Default | Meaning |
|---|---|---|
| `globalDir` | `<harness home>/memory` | Root of the user-wide store, holding one `<slug>.md` per entry; created on first write. |

The project store takes no configuration: it follows the workspace that owns the calling session's working directory.

### What the model gets

Three tools with strict argument validation:

- `memory_write` — write or overwrite one entry, returning `{ slug, path, scope }`. `title` and `content` are required; `scope` selects the store and `slug` overrides the title-derived kebab-case id.
- `memory_read` — read one entry from one store, returning `{ slug, title, content, scope, path, mtime }`. Both `slug` and `scope` are required.
- `memory_list` — list one or both stores, returning `{ scope, entries, note? }` where each entry carries `slug`, `title`, `scope`, and `mtime`, newest first.

### Observable success and failures

A write reports the path it wrote. A read of an absent slug fails with the store it searched, and a read never falls back to the other store. Rejections are loud and name the rule: an empty or multi-line `title`, a `slug` that is not kebab-case (which is also the path-traversal guard), and a title with no letter or digit to derive a slug from.

The scope default is the one failure worth knowing: `memory_write` without `scope` addresses the project store, and a session whose working directory belongs to no workspace fails with a message that names the working directory and points at `scope: "global"`. Listing follows the same rule without failing — `memory_list` returns the entries it found plus a `note` explaining that the project store is unavailable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design concept

Memory is files-first: one entry is one `<slug>.md` file whose first line is `# <title>` and whose remaining lines are free-form markdown. There is no frontmatter, no index, and no database, so a user reads, diffs, and hand-edits the same files the tools write, and the file's modification time is the entry's update time. Writes go through a temporary file in the same directory and a rename, so a crash cannot leave a half-written entry.

The project store is derived per call, not cached: the plugin reads `ctx.workspaceRegistry` opportunistically, picks the deepest registered workspace path that contains the calling session's header `cwd`, and asks `projectMemoryDir(resolveProjectDir(workspace))` for the directory. Two sessions in different projects therefore never share a project store, and a composition with no workspace registry degrades to the global store instead of failing to load.

### Source map

- `src/index.ts` — tool registration, the `globalDir` config, scope resolution, slug derivation and validation, entry parsing, atomic writes, and the store listing.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory) — the generated schema reference for the three tools.
- [`@deepseek-ai/dsh-workspace`](../../workspace/workspace/README.md) — the workspace entity and `resolveProjectDir`, which own the project directory this package's project store lives under.
- [Base bundle](../../bundle/base/README.md) — the FinDeck composition that mounts this plugin.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`memory_list` / `memory_read` / `memory_write` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-memory). The three descriptions state when to reach for memory, that the two stores are separate namespaces, and that an omitted `scope` fails loud rather than falling back to the global store.

#### Token effect

Fixed schema cost per request where the tools are visible. Files are not sent to the model on mount: nothing is added to the prompt, and entries reach the context only through a `memory_read` or `memory_list` result the model asked for.

#### KV Cache effect

Prefix-stable while the tool definitions and visibility are unchanged. Memory content enters the conversation only as a tool result, so it appends after the reusable prefix.

### Tool results and errors

#### What the model sees

`memory_write` renders `memory "<slug>" written to the <scope> store: <path>`. `memory_read` renders the title with the update time and the entry body. `memory_list` renders one `- [<scope>] \`<slug>\`: <title> (updated <mtime>)` line per entry, newest first, and appends the store note when the project store did not resolve. Errors render the rule that refused the call or the store that did not hold the slug.

#### Token effect

A listing costs one line per entry; reading an entry costs its full body, which is whatever the writer stored. Nothing bounds entry size, so a large entry is a large result.

#### KV Cache effect

Append-only; newly visible results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when memory is a poor fit. They are current package constraints, not a task backlog.

- **Nothing is injected into the prompt** — the model must call `memory_list` or `memory_read` to see anything; a composition that wants memory recalled automatically needs a pre-step publisher of its own.
- **No search, no index, no ranking** — `memory_list` returns every entry of the addressed stores, and a slug is the only lookup key.
- **No size bound** — an entry is written and returned whole; nothing truncates or spills a large body.
- **No concurrency control** — two writers racing on the same slug end with one of the two files, and nothing detects the loss.
- **Project membership is path containment** — the store follows the deepest registered workspace whose path contains the session's working directory; a workspace disabled in the registry is invisible here even if its directory still exists, and a session working outside every registered path silently loses its project store at write time.
- **`mtime` is the only update time** — rewriting an entry with identical content still moves it in the listing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
