---
description: "The FinDeck roundtable page: a full-bleed room — phase/seating head strip, height-filling shared transcript, pinned steering composer — over the roundtable Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-roundtable

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-roundtable` is the roundtable primary page (U6/R13): one `settings.section` row (`roundtable`) that renders as a full-bleed room — a head strip (live phase, the running table's facts, the seating) over a shared transcript that fills the remaining height with the steering composer pinned below it. While no table runs, the room's body hosts the open-table setup (and the seating editor) as a centered card and renders no composer: seating a table is that card's own action, so the page offers a steering input only once a table is open. The host engine owns every decision — depth, speaking order, the read-only research window, think-then-skip, interruption, and @-call narrowing — so this page only sends the three open-table choices (plus, for a deep table, the conversation to continue), user messages, polls the room, and renders what the room reports: it polls every 200 ms while a speaker generates, rendering the unfinished turn the engine publishes (speech and thinking) as a growing last entry, and every 2 s otherwise. While the page is open, the shell's sidebar shows the roundtable history column (`sidebar.section`) instead of the workspaces browser: the table open right now at the top, then the closed tables newest-first, both re-read on a 2.5 s interval while the column is visible, so a table opened or closed during the visit joins the list without a reload; one click to read an archive, one click back to the live room.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in a web profile after `ui-shell` and the roundtable Remote. It requires `ctx.slots`, `ctx.locale`, and the mounted `roundtable` and `session` Remote faces — the second only to read the same model catalog the session selectors offer.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-client-ui-roundtable'
```

No configuration. The section id is `roundtable`, and it renders through the shell's `shell.page` hole laid out full-bleed — the shell drops the centered page column for this section, so the page spans the main area and owns its scrolling.

### What the page shows

- **Open-table setup** — the three choices (depth, seating, model) whenever no table is open, each pre-selected from the last table the user opened, plus the seating editor; nothing is a required form field beyond pressing open. The setup is the room's empty state: it renders as a centered card in the room's body, and its open button is what seats a table — the page renders no composer until one is open. A deep table adds the continue-a-conversation picker (project, then one of its conversations): the engine exports the conversation to a file its speakers read themselves — never inlined into context — and earlier speakers' reads are shared table-wide. Clearing the table releases its configuration, so the setup returns and the next table may be opened differently. A deployment with no configured provider explains that instead of showing an empty model list.
- **History column** — the `sidebar.section` entry (`src/client/RoundtableHistory.tsx`) that replaces the workspaces region while the page is open: the table open right now pinned at the top for as long as one is (its seating and depth, the speaker turns recorded so far, its opening user message, and an in-progress badge while a speaker generates), then the recent closed tables (`archiveList`), newest first, both re-read every 2.5 s while the column is on screen (and immediately when the tab becomes visible again), so a table opened or closed during the visit appears on its own; selecting an archive renders that transcript read-only (`archiveRead`) in the same room layout (meta strip, no composer), and the top row — or the button below the list — goes back to the live room. No table open means no top row: the column is then the archive list alone.
- **New Table action** — the shell's primary nav button reads *New Roundtable* while this page is open and emits `shell/new-roundtable`; the page releases the running table (the host archives a table that spoke) and lands back on the open-table setup, dropping whatever the history column had selected.
- **Phase strip** — the current phase (waiting for the user, in round, waiting for guidance), the configuration the table runs, the busy hint, the speaking queue in order, the round count, and a reset button with a confirmation.
- **Seating** — the seats of the roster the table seated, shipped identities badged; the chip of the identity holding the floor is marked.
- **Transcript** — every entry in order, grouped into rounds: a round opens at each user message and its turns follow under it, with extra space and a hairline separating one round from the next. A speaker turn renders as its own hairline card, so a run of speakers reads as a stack of messages rather than one continuous text flow, and every entry closes with a bottom bar in the session page's message-footer idiom: a copy action on the left (the entry's own text, a speaker's as its Markdown source, with the shared icon-swap success feedback) and right-aligned meta — the interrupted marker, how many calls the turn made, how many sources it read, and its clock. The room records no token usage and no turn duration, so those two session-page stat pills have no counterpart here. A user message renders as its own highlighted block (tinted fill, accent rule on the left, bold label) rather than as another speaker paragraph. Entries are user messages, speaker turns (including 「思考后跳过」), and system notes; a user message is quoted verbatim as plain text while every speaker turn's speech renders as Markdown through the shared conversation renderer; a speaker turn that carried thinking shows it as a disclosure above the speech, and inside that disclosure the turn's thinking and its tool calls render interleaved in the order they happened (the engine's `flow` timeline, a compact Markdown segment per stretch of thinking and a tool row per call); a transcript written before `flow` existed falls back to the flattened thinking above the flattened call list; a deep speaker's turn carries its sources behind one collapsed row that names their count, each row pairing the tool with its subject and, for a web page, a link to the short destination rather than the full URL; a turn whose research window hit a limit carries the note that it answered from what was already read. A turn the user stopped mid-way — the engine freezes the speech that had already streamed rather than dropping it — renders as a visually degraded block (muted text, a dashed rule on the left, an 「已打断」 chip in the bottom bar, and a closing note) with its thinking and its tool calls kept, and its thinking disclosure expanded like the streaming turn it replaced. The turn being generated sits last: the room publishes the text, thinking, and tool calls it has folded so far as `partial` — for a deep speaker, the whole turn across its several requests, since the engine accumulates rather than restarts — and the page renders it as an entry that keeps growing: a 「发言中…」 marker beside the speaker's name, a blinking caret after the text, and the thinking disclosure expanded for that turn so the reasoning arrives as it streams; the finished turn replaces it. The view follows the newest entry only while the reader is already at the bottom: the scroll position, not the render, decides, so a reader who scrolled up to re-read is never dragged back by the next poll.
- **Tool calls** — a deep speaker looks things up before it talks, and those calls render as a compact row per call, in the same idiom as the session page's tool rows: a state dot (ongoing while the call runs, done, error, or interrupted when the stop caught it mid-flight), the action's localized name (`web_search`, `web_fetch`, `read`, `read_image`, `grep`, `glob`; any other tool keeps its wire name), one line naming what the call acted on, and a state chip. Expanding a row shows the call's argument JSON, capped at 2000 characters, in a monospace block. The same rows render under a streaming turn — a call appears the moment the model starts streaming it and updates in place when the window runs it — and under a settled or interrupted transcript entry, and in a turn that carries a `flow` timeline each row sits at the point in the thinking where the call happened. The result text is not rendered; what the speaker concluded from a call is its speech.
- **Composer** — rendered only while a table is open; the setup card and the read-only archive view have none. One input for steering a round or @-calling a named identity, with one action button that is 「发送」 while the table is idle and 「打断」 while a speaker generates. The interrupt button is enabled whatever the draft holds: it cancels the speaker generating right now and freezes what it had already said into the transcript as an interrupted turn, so nothing the reader watched arrive disappears; the table then waits for the user, and the next message opens a fresh round instead of queueing behind the speakers. Beside the field, the `@` control opens a list of the running table's own seats above the input — the identities the head strip shows, picked by pointer or by the arrow keys — and a pick writes `@name` at the caret and hands the keyboard back to the field; a seat renamed with a space in it is called by its identity id, because the host reads a call as one whitespace-delimited token. Escape, a pick, or a pointer outside closes the list.

### Seating editor

The editor writes names, speaking contracts, member order, the closing member, and member additions/removals through `saveRosters`; a shipped seating is edited as a copy that replaces it by id, and the page refetches the rosters after a save. Adding a person grows the seating being edited and starts that seat from a shipped identity, so a user-authored seating is not capped at one member; a separate control starts a new seating. It sends nothing but those four fields per member — the seating is discussion configuration, so it can never reach a plugin or a permission.

### Observable success and failures

A failed load renders an error line with a retry button; a failed send renders the same line, and a refused `open` keeps the setup on screen with the host's reason. For as long as a table is open the page polls the room — every 200 ms while a speaker generates, which is the cadence `partial` grows at, and every 2 s otherwise; a closed table is not polled at all. The history column keeps its own 2.5 s reads of the live room and the archive listing while it is visible: a failed listing read replaces the rows with the failure line, while a failed room read only leaves the last live row in place, since the next interval is already on its way.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`RoundtablePage` holds the room view, the rosters, the remembered table, the model options, and a failure flag; it polls the room for as long as a table is open (200 ms while a speaker generates, 2 s otherwise), keeps the transcript at its newest entry while the reader is near the bottom, and renders the flat entry list as rounds — a round opens at each user message, and the separation between rounds is drawn from that grouping rather than from any field the entry carries. Following the transcript is a ref-held flag updated from the container's own `scroll` event and applied after a room update, rather than a callback ref that scrolls on every render: the partial grows every poll, and a render-driven scroll would fight a reader who scrolled up. The `partial` the room reports renders as one more entry, keyed by speaker id, so its thinking disclosure mounts once per turn instead of collapsing again on every poll. Tool calls are presentation over data the room already carries: `TurnActivity` draws a turn's process from its `flow` timeline (`FlowDisclosure` — compact Markdown reasoning segments and `ToolActivityLine` rows in the order they happened) and falls back to a plain thinking disclosure over the flattened call list for an entry or partial that carries no timeline, so an interrupted turn's frozen calls, a live turn's running ones, and an old archive all read alike; the row expands to the raw argument JSON the engine recorded — the page never calls a tool or fetches a result itself. The setup adopts a configuration that arrives after the first render — whichever of the three choices changed — until the user touches a control. `src/client/index.ts` registers the `ui.roundtable` dictionary, the section row, and the history column, unwraps each Remote result into the value the page renders, and flattens the session model catalog into the `provider/model` options. The history selection lives in `src/client/history-store.ts` — a module store shared by the two separately mounted slot components — while the column's freshness belongs to the column itself: it re-reads the archive listing and the live room on its own interval — the room rides the listing's tick rather than a faster cadence of its own, because the page already polls the room every 200 ms while a speaker generates and the row shows only seating, depth, turn count, and the busy flag — and it sorts the archive rows by `closedAt` rather than trusting the served order. The live row's seating name comes from the same `roster` read the setup screen makes, so one request serves both the room snapshot and the name. The shell chrome's *New Roundtable* action reaches the page as the `shell/new-roundtable` event, which `src/client/index.ts` projects into a `newTable` observable the renderer binds as the page's `useNewTable` seat; the page owns the reaction (drop the archive selection, `reset`, read the released configuration back).

### Source map

- `src/client/index.ts` — dictionary registration, the `roundtable` section row, and the `load` / `models` / `open` / `saveRosters` / `room` / `send` / `interrupt` / `reset` adapters.
- `src/client/RoundtablePage.tsx` — the room: setup (with the deep table's continue picker), phase strip, seating, transcript, the thinking/tool flow timeline, interrupted-turn rendering, composer, and the read-only archive view.
- `src/client/RoundtableHistory.tsx` — the sidebar history column.
- `src/client/history-store.ts` — the archive selection shared between the column and the page.
- `src/client/locales.ts` — the `ui.roundtable` dictionary keys.

-----

<a id="model-experience"></a>
## Model Experience

None, as the page only renders room snapshots; the host engine owns every model request and the page never composes one.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One room** — the host keeps a single live table, so this page renders that table only; there is no room list or per-room route.
- **Incremental display rides polling, not push** — the Remote is a unary RPC, so the host cannot push; while a speaker generates the page reads the room every 200 ms, so a delta reaches the screen up to one interval after the engine folded it. The history column re-reads the live room and the archive listing every 2.5 s while it is visible, so a newly opened or closed table — and the in-progress badge — can appear up to that late.
- **The room survives a host restart, its in-flight turn does not** — the engine persists the open room (transcript, phase, configuration) and this page re-reads it on mount, so a restarted host shows the same table. A speaker that was generating when the process died comes back as a finished-looking room waiting for the user, with that turn lost; the page renders whatever the room reports and has no restart-specific state of its own.
- **A tool row shows the call, not its result** — the room records each call's tool, arguments, one-line subject, and state, so the page renders exactly that; the result text stays in the engine's session log, and the page never fetches it.
- **A seat's identity id is fixed in the editor** — the four writable member fields are name, contract, order, and the closer; the id is shown read-only, so an added seat starts from a shipped identity and authoring a brand-new identity is deferred to the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The host engine owns turn order; the page's only job is to send messages and poll the room. The 200 ms generating interval, the 2 s idle interval, and the history column's 2.5 s room-and-listing interval are page-local choices, not host contracts.

</details>
