---
description: "Build-static first-party Session format codec and adjacent migration assembly for persistence readers."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-catalog

English | [中文](README.zh.md)

## Summary

`dsh-session-format-catalog` gives persistence one deterministic Session format reader without consulting mounted plugins. It assembles the frozen v0, v1, v2, and v3 codecs with the adjacent v0-to-v1, v1-to-v2, and v2-to-v3 edges, checks the complete gap-free chain at module initialization, and exposes physical dispatch, header-only classification, migration, and current encoding through `sessionFormatCatalog`.

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

### When to use it

Import this library from persistence and test-support readers that need the complete first-party released-format inventory before any feature plugin mounts. Feature compositions do not register or reorder its entries. A reader that opens a parent Session whose children are historical uses `createSessionFormatCatalogWithChildren()` instead of the static catalog, so the V3→V4 edge knows that parent's child evidence. No runtime invariant companion is published because construction rejects an invalid static inventory and each read validates its complete result; the catalog retains no independently mutable runtime relationship.

### Entry point

```text
const descriptor = sessionFormatCatalog.readHeader(physicalHeader)
const restore = sessionFormatCatalog.createRestore(physicalHeader, { recovery: 'strict', validation: 'current' })
for (const row of rows) restore.decodeRow(row)
const current = restore.finish()
```

Import `sessionFormatCatalog` from the package root. JSONL readers pass the parsed physical header to `createRestore()` with an explicit recovery policy and validation scope, feed every parsed row to `decodeRow()`, and read the validated current artifact from `finish()`. Writers serialize only validated current values, through `encodeCurrentHeader()` and `encodeCurrentEvent()`. Listing calls `readHeader()` and never opens event bodies. Header reads validate every adjacent target and then restore the final header through the installed current Session package.

A parent Session's V3→V4 edge requires that parent's complete child evidence. `collectParentChildEvidence()` reads it from the parent's own decoded source artifact — its `subagent/catalog` facts after the inherited cut — and a parent that recorded no children yields an empty array the caller passes explicitly rather than omitting. `historicalSessionFormatCatalog` keeps the V0–V3 readers available for callers that must inspect a child's own log while collecting that evidence, so gathering prerequisites never reopens a current Session.

The catalog contains all supported historical readers directly. A profile cannot add, remove, or reorder an edge by mounting a feature plugin. Its peer dependency on `dsh-session` supplies the installed current event vocabulary and current restoration rules, while historical edge validators remain frozen.

The `./message-projections` entry exports `currentSessionMessageProjections`: the first-party pure definitions a detached reader passes to `foldSurface()` or `Session.create()` when it replays a log that contains a plugin-owned message-projection event without mounting that plugin's runtime listener.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/generated.ts`](src/generated.ts) is the static owner of codec and edge ordering. [`src/current.ts`](src/current.ts) delegates final header, envelope, message, surface, seed, and current request-header validation to the installed Session semantics. [`src/children.ts`](src/children.ts) rebinds the V3→V4 edge to one parent's child evidence and derives that evidence from the parent's own log; [`src/historical.ts`](src/historical.ts) re-exposes the V0–V3 readers for prerequisite collection. The low-level constructor rejects duplicate codecs, duplicate edges, gaps, and entries beyond the current version before any Session read can begin.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Migration machinery](../session-format/README.md) — catalog construction and dispatch behavior.
- [Released v0 to v1 edge](../session-format-v0-to-v1/README.md) — codec and validator ownership.
- [Released v1 to v2 edge](../session-format-v1-to-v2/README.md) — Assistant stream embedding and cardinality-changing reference remapping.
- [Released v2 to v3 edge](../session-format-v2-to-v3/README.md) — system heads, audited references, PTC and preset names, and canonical envelopes.
- [Released v3 to v4 edge](../session-format-v3-to-v4/README.md) — tool-role results, producer sources, parent catalogs, and native V4 admission.
- [JSONL persistence](../session-persistence-jsonl/README.md) — immutable generation naming and exclusive publication.

-----

<a id="model-experience"></a>
## Model Experience

### Catalog dispatch

#### What the model sees

Nothing directly. The catalog only restores the `SessionEvent` history consumed by request reconstruction.

#### Token effect

Zero direct tokens.

#### KV Cache effect

No direct effect; restored history determines cache identity in its consumer.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **First-party build inventory only** — external migration ownership and distribution are not supported.
- **Generated ordering is closed** — runtime plugin registration cannot supply a missing historical edge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
