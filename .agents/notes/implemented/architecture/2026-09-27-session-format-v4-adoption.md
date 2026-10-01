# Agent Note: Session format upgrades to V4 through an adjacent v2→v3→v4 migration chain

Status: implemented

English | [中文](2026-09-27-session-format-v4-adoption.zh.md)

## Problem

This fork released Sessions at `SESSION_FORMAT_VERSION = 2` ([types.ts](../../../../packages/core/session/src/types.ts)) and admitted every upstream event V2 could not model by registering the name read-only in [upstream-event-vocabulary.ts](../../../../packages/core/session/src/upstream-event-vocabulary.ts) instead of changing the format. Staying at V2 was a recorded recommendation, not merely an implementation state: UPSTREAM_REPORT.md §5.2 item 4 advised maintaining V2 and deciding `ignorable` per new event, and the 0.1.6 architecture survey recommends the same as its option A.

Two costs of that position do not shrink through per-event registration.

Registration makes a foreign log readable; it produces nothing. Every entry in `upstream-event-vocabulary.ts` is log-only, the module is deliberately not re-exported from the package index, and this build appends none of those events. `system/message`, `developer/message`, and the deferred tool schemas upstream carries through them had no producer here, so the distance between what this fork could read and what it could write grew with each upstream release.

The same generation gap was also paid on every port. The 0.1.7 port met `createSystemMessage` with parameters this build's message model does not have, a missing `displayReason`, and recorded fixtures whose bodies match the ported code only after edits — adapter work caused by the V2/V4 message-model difference rather than by the features being ported.

## Decision

This fork is at upstream V4: `SESSION_FORMAT_VERSION` is 4, the writer stamps 4, and body reads compose two new pure edge packages, `@deepseek-ai/dsh-session-format-v2-to-v3` and `@deepseek-ai/dsh-session-format-v3-to-v4`, after the existing v0→v1 and v1→v2 edges through the same build-static catalog. [Released Session formats migrate on body read](2026-08-31-released-session-format-migrations.md) keeps ownership of how a migration is published: the source generation keeps its path, bytes, and inode, only a version-named successor is added, and no committed generation is moved, overwritten, or deleted. [Session log versioning](2026-08-10-session-log-version-mechanism.md) keeps ownership of when a version bump is required and of equal-version `ignorable` behavior.

This note supersedes the V2 position recorded in `UPSTREAM_REPORT.md` §5.2 item 4, in the survey's option A, and in the two comment blocks of `upstream-event-vocabulary.ts` that state it.

### What V4 makes reachable

- **Deferred tool loading (`defer_loading`)** — tool definitions stop traveling as complete schemas on every request and are loaded when the model needs them. A profile mounting hundreds of tools pays that saving on every call. The V2 request header carries one assembled `tools` array and no field representing a deferred schema set.
- **Tool-set changes inside a session** — `system/message` and `developer/message` are the surface events that record a tool addition or removal at a given turn and step, with `headerSeq` naming the earlier `request/header` that defines the additions. V2 has no surface representation for a tool-set change, so a session cannot gain or lose tools without restarting.
- **A message model without the tool-result impostor** — a tool result is a first-class message with `role: 'tool'` instead of a content block inside a user message, and each message `source` is a producer-declared kind rather than one shared plugin fallback, so two producers cannot claim one source id; `plugin:<name>` survives only as the migration edge's fallback for a plugin string it cannot map.
- **Repairs the chain applies to existing logs** — the v2→v3 edge promotes the header's rendered system prompt into messages and remaps local event references, PTC names, and preset names; the v3→v4 edge lifts tool results, renames message sources, closes interrupted turns the log itself proves unfinished, and appends missing parent-catalog facts. Every rewrite lands in the successor generation; the predecessor keeps its bytes.

### Durable Session strings are committed data

The concrete mistake to avoid is treating a string stored in a Session log as a code identifier that may be renamed where it is read. The upstream 0.1.6→0.1.7 upgrade broke this user's models and presets through that class of change: presets moved from a disk-directory scan to profile declarations, and the home-level `settings.yaml` moved to per-profile locations, so a build that changed only where it looks lost every model and preset (rescued session record).

An event type name, a message or source id, a preset name, or a tool name already written by a released build is committed data. It is renamed by remapping it inside the successor generation's migration edge, never in place, and a current-build reader keeps a stored spelling alive until the edge owning its remap exists. `tool/code-dispatch*` is the live example: this build appends `tool/ptc-dispatch*` and keeps the pre-rename spellings registered read-only because released V2 logs carry them; under the v2→v3 edge that remap belongs to the edge's frozen released-V2 inventory, and this build appends only `tool/ptc-dispatch*`.

`upstream-event-vocabulary.ts` stays the temporary home for names whose owning package has not been ported. Deleting an entry requires that the owning package declares the `SessionEventMap` member itself, because members are unique across merges.

### Version-consistent commit points and reversal

The chain shipped in milestones, and M3 and M4 were the only version-consistent commit points: between them the tree was neither committed nor released.

Two consequences follow. First, a stored path derived from the current version is wrong at every intermediate point: in this project's batch 1, a version-derived log name (`session.v4.jsonl.zstd`) reached a running process while that session's on-disk log was still V2, and the turn died with `ENOENT` on the missing path. Second, a version-switch change is verified against fixtures or an isolated `DSH_HOME`, never against the live session store, until a version-consistent point is reached.

An older build cannot read a Session written as V4: `assertVersion` refuses any stored header whose version is not the build's own `SESSION_FORMAT_VERSION` ([storage-contract.ts](../../../../packages/session/session-persistence/src/storage-contract.ts)). Retained v2 and v3 generations are evidence for inspection and copying, not downgrade or automatic-fallback support, which the published-format policy already states for retained lower generations. M3 and M4 are the only commits a rollback may return to.

## Consequences

The update costs two migration packages plus a `packages/llm` message-model refactor, the `core/session` event vocabulary, and every consumer aligned to the new model — more work than the entire 0.1.7 port, which the user accepted.

It buys a codebase where upstream feature code ports without a message-model adapter, a request path that can defer tool schemas, a surface that can carry tool-set changes and the system prompt as its head node, and a migration chain that repairs provable inconsistencies in existing logs instead of carrying a growing read-only vocabulary of events this build can never write.

The version-bearing statements agree with the shipped generation: `SESSION_FORMAT_VERSION` in `packages/core/session/src/types.ts`, the read-only legacy spellings in `upstream-event-vocabulary.ts`, `docs/subsystems/session.md`, the generated `docs/persistence-catalog.md`, and §5.2 item 4 of `UPSTREAM_REPORT.md`.

## Verification

This fork ships no gates. The build — `pnpm run build`, whose `tsc -b` is the type check — and execution against real input are what establish correctness. Each edge is exercised against released fixture logs under an isolated `DSH_HOME`, the complete chain is exercised in one pass from a released V2 fixture to a current V4 artifact, and the full build runs at M3 and M4. No real user session store is an input to verification.

## Alternatives considered

- **Stay at V2 and decide `ignorable` per event** — the superseded decision. Rejected because it cannot reach deferred tool loading or in-session tool changes (no surface event exists to carry them), keeps the message-model adapter tax on every upstream port, and leaves this build permanently unable to write events it already reads.
- **Bump the version without the two edges** — refuse released V2 logs and start fresh generations. Rejected: it discards already-released user data and contradicts the published-format policy this repository follows.
- **Adopt V3 only** — take the system-prompt surface head and canonical envelopes, leave tool-role results and namespaced sources for later. Rejected: `role: 'tool'` and `plugin:<name>` sources belong to V4, so the message-model refactor and consumer alignment would be paid twice while the tool-set surface stays unusable.
- **Rename durable names in place** — write `tool/ptc-dispatch*` where old logs say `tool/code-dispatch*`, or let a reader trust a new profile declaration. Rejected: this is the storage-migration class that already destroyed this user's models and presets, and it makes a stored log unreadable to the build that wrote it.
- **Rewrite the committed generation instead of publishing a successor** — already rejected by the published-format policy: it destroys the evidence a migration is checked against and makes the filename disagree with its contents.
