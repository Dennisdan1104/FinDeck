# Agent Note: One owner for session catalog publication

Status: implemented

English | [中文](2026-09-11-skill-catalog-publication-extraction.zh.md)

## Problem

`dsh-tool-asset-library` reimplemented roughly 150 lines of `dsh-tool-skill`: the same `digestCatalogEntries`, `catalogHistory`, `catalogMessage` and `readCatalogEntries`, under the same names with the same algorithms and the same error-string shapes. The asset-library package already imported `escapeText` from `@deepseek-ai/dsh-skill`, so the shared module was reachable. The copy also lost a parameter: upstream's `catalogDescription(value, maxLength)` takes the limit, the copy hardcoded `CATALOG_DESCRIPTION_MAX_LENGTH`. The repository's own `duplication` gate exists to catch exactly this and reported four clones.

## Decision

The publication decision moves to one owner in `@deepseek-ai/dsh-skill`: a `SessionCatalog` descriptor plus `publishSessionCatalog(catalog, session, messages, entries)` and `catalogDescription(value, maxLength)`. Both tools describe their catalog — message-source kind, diagnostic name, how to digest and read entries, how to render — and the shared module decides whether this is a first publication, no change, or a replacement.

The genuinely different parts stay package-owned and are reached only through the descriptor: `renderCatalogMessage`, `renderCatalogUpdate` and each package's `readCatalogEntries`. Their model-facing prose, XML envelope (`<available_skills>` against `<available_assets>`), entry fields and durable source kinds differ, and merging them would need a template language.

`publishSessionCatalog` takes an explicit `Session` rather than an `Agent`, so `dsh-skill` gains exactly one runtime dependency (`dsh-session`); `SessionSeq` is a branded number and needs no shared instance.

## Alternatives considered

**Merge the renderers too.** Rejected: the two catalogs differ in envelope, entry fields and prose, so one renderer would need a template DSL — more machinery than two small functions. The duplication gate reports no clone over the result.

**Leave the copy and exempt the package from the gate.** Rejected: the copy had already drifted (the lost `maxLength` parameter), which is the failure the gate exists to find.

**Take `Agent` instead of `Session`.** Rejected: it would widen the interface beyond what publication reads, and the repo rule is to keep the agent or session explicit at the interface that owns the operation rather than widening a leaf helper.

## Consequences

- One owner for "what has this session already published"; a change to digesting, retirement or compaction handling reaches both catalogs.
- `dsh-skill` carries a runtime dependency on `dsh-session`.
- The two renderers remain separate by design; a future third catalog is expected to bring its own renderer and reuse only the decision.
- The asset catalog's description cap is still a module constant while tool-skill's is a `Config` field. Parameterising the shared helper exposes the asymmetry without resolving it.
