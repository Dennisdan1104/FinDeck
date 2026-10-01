---
description: "Sessions settings page for the dsh web client: the stored-session inventory with whole-log counts, rename, per-session export, and confirmed removal."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-settings-sessions

## Summary

`dsh-client-ui-settings-sessions` is the Sessions settings page of the dsh web client. It lists every session stored on this server — title, whole-log turns and steps, last activity, workspace, and log size — and gives each row the three administration actions that act on the stored session itself rather than on this page. **Rename** writes an explicit title through the session's own rename verb, **Export** downloads the log through the Host's session-log archive route, and **Delete** asks for confirmation and then discards the stored log permanently.

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

Open **Sessions** from the Settings navigation. Every stored session is one row: its title (or an untitled marker), an **Open** badge while the server has it open, and a metadata block with turns, steps, last activity, the working directory it was created in, and the size of its stored log.

- **Rename** swaps the title for an input; saving writes a user-owned title event, which pins it against automatic title generation.
- **Export** downloads the session's log as a ZIP archive holding its canonical JSONL, streamed by the Host, so archive size is never bounded by this page.
- **Delete** asks for a second click before it acts. The removal is permanent: the session and its stored log leave the server, and the row disappears from this list and from every sidebar the browser has open.

A session the server currently has open cannot be removed; its row carries the **Open** badge and its Delete button is disabled with the reason on the tooltip.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page holds no facts of its own. `ctx.remote.sessionsAdmin.list()` answers the whole inventory, and `remove` answers the whole inventory again after its removal, so one accepted response replaces the store's entries and the rows can never show a half-applied change. A single `busySessionId` in the store disables every row's actions while one mutation is in flight.

Rename is deliberately not a `sessionsAdmin` method: it calls the existing `ctx.remote.session.rename`, which already settles the `title` projection cell it answers with, and then re-reads the inventory — because renaming opens the session on the Host, which its row then reports.

Export is a link, not a read: the Host already streams a canonical-JSONL ZIP from `/api/session.export?sessionId=…`, so the page hands that URL to the browser download manager instead of transferring the log through a Remote and re-implementing a size cap.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the domain base whose `settings.section` slot this page builds on.
- [api-sessions-admin-controller](../../api/sessions-admin-controller/README.md) — the Host owner of the inventory and the removal.
- [session-log-export](../../session-query/session-log-export/README.md) — the Host route and `/export` command this page links to.

-----

<a id="model-experience"></a>
## Model Experience

Indirect: removing a session destroys the history a later resume would have replayed, and renaming pins a title that the next assembled prompt's session metadata carries. The page itself adds nothing to a request.

#### KV Cache effect

None directly; a removed session is never resumed again, and a title change lands outside the model-visible request sequence.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A session the Host has open cannot be removed from here.** The Host holds its write handle and the persistence backend holds its write lock; the page reports the row as open rather than deleting an artifact a writer is appending to. Renaming a session opens it, so a rename immediately before a delete blocks that delete until the session is closed.
- **Rows are as complete as the projection checkpoints behind them.** A session whose projections were never checkpointed lists without a title, counts, or last activity; the page shows a dash rather than folding its log.
- **There is no clear-all action**, because no Host operation removes more than one session.
- **Row order is host order** (most recently active first); the page adds no sorting or filtering of its own.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A nav-entry-only section plugin that reads one Remote namespace, calls the existing session rename verb, and links to the Host's log archive route; it owns no cross-plugin mutable relation.
