---
description: "Model-facing roundtable_list and roundtable_read tools over the durable roundtable transcript archive, for users and maintainers composing or debugging the finance research roundtable."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-roundtable

English | [中文](README.zh.md)

## Summary

`dsh-tool-roundtable` gives the agent read access to past roundtables. The `dsh-roundtable` engine archives a table's complete transcript when the table closes (opening a different table, or clearing it); these tools serve that archive to the model: `roundtable_list` returns the recent tables' headers — when each ran, which roster and model it seated, how deep it went, how many speaker turns it recorded, the opening topic — and `roundtable_read` returns one table's full transcript with every user message, speaker turn (its text, its thinking, and its citations), and system note. The agent uses them to recall what a roundtable concluded and to cite it in reports. The engine and this package share only the directory contract (`dsh-roundtable/archive`, default `<harness home>/roundtables`).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount it wherever the roundtable engine runs and the agent should be able to recall past tables. It requires only `ctx.tools`; the archive directory is created by the engine, and an absent directory simply lists empty.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-tool-roundtable'
```

| Field | Default | Meaning |
|---|---|---|
| `archiveDir` | `<harness home>/roundtables` | Archive root; the same default the roundtable engine writes to |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-roundtable) is the exhaustive source for the accepted field.

### What each call does

`roundtable_list { limit? }` returns up to `limit` (1–50, default 10) newest-first summaries. `roundtable_read { id }` returns the table configuration plus the complete transcript; a malformed id or a corrupted archive file fails loud with the archive id and the reason.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tools are a thin model-facing adapter over `dsh-roundtable/archive`: `listRoundtableArchives` and `readRoundtableArchive` own the defensive parsing, the id pattern (which doubles as the traversal guard), and the atomic write the engine uses. This package adds no storage of its own.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema and the two tool registrations |
| [`../roundtable/src/archive.ts`](../roundtable/src/archive.ts) | The archive directory contract: record shape, write, list, read |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Roundtable engine](../roundtable/README.md) — when and how a table archives.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-roundtable) — the schemas the model receives.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-roundtable) — every accepted config field.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`roundtable_list` / `roundtable_read` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-roundtable).

#### Token effect

Fixed schema cost per request where the tools are visible; the read result scales with the archived table's transcript length.

#### KV Cache effect

Prefix-stable while the definitions are unchanged.

### Tool-call history and result

`roundtable_list` renders one line per archived table; `roundtable_read` renders the transcript as `[kind] name: text` lines with citation and truncation markers. Failures render the archive id and the parse failure.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tools are a poor fit. They are current package constraints, not a task backlog.

- **Read-only** — the tools cannot open, steer, or close a table; the table lifecycle stays with the roundtable page and its Remotes.
- **Close-time archiving only** — a table archives when it is closed after speaking; a table still running when the process exits is not archived (the agent-driven logging path is the only record there).
