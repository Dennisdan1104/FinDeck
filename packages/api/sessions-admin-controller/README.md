---
description: "Host Remote owner for stored-session administration: the durable session inventory with sizes and whole-log counts, and permanent removal of one stored session."
kind: "package-reference"
---
# Sessions Admin Controller

## Summary

`@deepseek-ai/dsh-api-sessions-admin-controller` exposes the generated `ctx.remote.sessionsAdmin` namespace. It answers one row per **stored** session â€?identity, title, whole-log turn/step counts, last activity, workspace, and physical artifact size â€?and removes one stored session on request. It is the management sibling of `ctx.remote.session.list()`: it reads the persistence store directly rather than the live Session registry, so it also describes a session this process never opened, and it carries the two facts a conversation list has no reason to pay for, byte size and whole-log counts.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as a Loader entry in a profile whose browser surfaces session history.

`list()` answers every session the mounted persistence backend can describe, most recently active first. Each row carries the durable identity and creation time, the latest accepted title, the last human prompt time, whole-log turns and closed steps, the working directory the session was created in, the artifact's byte size, and whether the session is currently open in this Host process. Title, counts, and last activity come from the projection registry â€?the live cut for an open session, the projection cache's zero-I/O checkpoint for a cold one â€?so listing never opens a session log. A session whose projections were never checkpointed is still listed; the fields those projections supply are absent rather than invented, and a checkpoint that fails its schema leaves that one row thin instead of failing the list.

`deleteSession(sessionId)` delegates to `ctx.sessionPersistence.remove()`, which owns the artifact layout and takes the session's cross-process write lock before unlinking it. The answer is the whole list after the removal. Removal refuses three ways: the session is open in this process (`sessions-admin/open`), another process holds its write lock (`sessions-admin/owned`), or no stored session carries the id (`sessions-admin/not-found`). On success the controller emits `api-session/removed`, the same forwarded event a disposed live session produces, so every connected browser drops the row from its session list without a second round trip.

Renaming is deliberately **not** implemented here: `ctx.remote.session.rename` already owns that verb, including the title projection update it settles, and the settings page calls it directly.

There is no batch or clear-all operation, because no backend method removes more than one session. Adding one would need its own bounded, resumable operation rather than a loop over `deleteSession()`.

-----

<a id="model-experience"></a>
## Model Experience

None directly: this package only reads and removes stored artifacts. It adds no prompt section, no tool, and no session event. Removing a session destroys the history a later resume would have replayed, which is a deployment-visible effect rather than a model-visible one.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The inventory is projection-thin for sessions that were never checkpointed.** A session whose projections have no row lists with its identity, creation time, size, and workspace only. Reconstructing the missing fields would mean folding the log, which a list read must not do.
- **A seeded (forked) session contributes only its title.** Its inherited cut is not recorded in the header, so the projection cache cannot be addressed for it; only `cachedPredecessorTitle` is readable.
- **Removal is not undoable and leaves no tombstone.** A derived index that survives the process (the Workspace registry's membership list) drops the id on its own next write, not at removal time; the session-search index reconciles its rows at the next search.
- **An open session cannot be removed.** The Host holds its write handle and the persistence backend holds its lock; the page reports the row as open and disables the action rather than deleting an artifact a writer is appending to.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers â€?click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The controller owns no cross-plugin mutable relation: it projects two established seams (persistence and projections) onto the wire and delegates removal to the persistence backend, which already owns the artifact layout and its write lock.
