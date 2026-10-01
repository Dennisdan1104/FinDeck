---
description: "The FinDeck roundtable host capability: built-in and custom speaker identities, the settings-backed roster, and the room engine that drives one shared transcript speaker by speaker through the LLM."
kind: "package-reference"
---

# @deepseek-ai/dsh-roundtable

English | [中文](README.zh.md)

## Summary

`dsh-roundtable` is the roundtable host capability: it registers the `roundtable` Remote and the `roundtable` settings namespace, and owns the room engine that drives one shared transcript. A table is OPENED with three choices — how deep it goes (`shallow`: a speaker may only search the web before it talks; `deep`: every read-only tool the deployment registers is in reach), which named seating is at the table, and which model every request uses — and it runs those choices until it is cleared; clearing releases the configuration, so the open-table setup is reachable again and the next table may be configured differently. Five shipped identities (bull researcher, bear auditor, macro strategist, industry expert, and a neutral moderator who always closes) and two shipped seatings (classic four, finance desk) are the base; the user's own seatings layer over them by id. A pure state machine decides the order, skips, interruptions, and @-calls; the model never chooses who speaks next. While a speaker generates, the engine publishes its unfinished turn (speech and thinking) on the room snapshot, so the page renders it growing instead of waiting for the finished turn.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition that has `ctx.settings`, `ctx.llm`, and `ctx.sessionQuery` (a seeded table reads the continued session through it; a composition without it can still open fresh tables, but refuses a seed loudly). The browser page (`dsh-client-ui-roundtable`) drives it through the Remote; the model-facing read tools live in `dsh-tool-roundtable`.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-roundtable'
  config:
    provider: deepseek-official
    model: deepseek-flash
    researchMaxSteps: 8
    shallowMaxSteps: 2
    researchMaxMillis: 120000
    researchMaxResultChars: 8000
    backgroundTools:
      - asset_run_bg
    runStalenessS: 3600
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | `deepseek` | Provider route a table starts on; the open-table choice overrides it. |
| `model` | `deepseek-flash` | Model id a table starts on; the open-table choice overrides it. |
| `researchMaxSteps` | `8` | Model requests allowed in one deep speaker's research window, the forced tool-free answer included. |
| `shallowMaxSteps` | `2` | Model requests allowed in one shallow speaker's window: one searching request before the forced answer. |
| `researchMaxMillis` | `120000` | Wall-clock budget for one speaker's research window. |
| `sharedDigestMaxChars` | `8000` | Characters of earlier deep speakers' shared read material one later speaker's opening carries. |
| `archiveDir` | `<harness home>/roundtables` | Archive root closed tables (and seed exports) are written under. |
| `researchMaxResultChars` | `8000` | Characters of one research tool result that reach the model. |
| `backgroundTools` | `['asset_run_bg']` | Tool names a deep window may call besides the read-only tools. These are submission tools that return before their work finishes; every synchronous mutating tool stays out of reach. |
| `runStalenessS` | `3600` | Seconds a ledger run may stay `running` before a turn boundary treats it as lost. |

The `roundtable` settings namespace holds the user's own seatings (`rosters`: an array of `{ id, name, members }`, where a member is `{ id, name, prompt, moderator }`) and the last table (`last`: `{ depth, rosterId, provider, model }`). A seating whose id matches a shipped one replaces it; a member whose `name` or `prompt` is empty takes the shipped identity's own. The stored `depth` must be `shallow` or `deep`: any other value fails the namespace registration rather than silently running shallow.

### Open a table, then talk

`open(depth, rosterId, provider, model, seed?)` seats a table and remembers the three choices; a deep table may pass `seed: { sessionId, title }` to continue an existing conversation (see Seeded tables). `userMessage` opens one silently with the remembered choices if none was opened yet. `archiveList(limit)` and `archiveRead(id)` serve the closed-table history the roundtable page's sidebar column renders; `undefined` takes the default 12, and the parameter is declared required-with-undefined rather than optional because a Remote caller passes every declared parameter positionally — a short call is rejected by the Client face before it reaches the host. Clearing the table releases the configuration and returns the page to the setup, which comes back pre-selected from the last choices:

- **Opens silent** — the user always speaks first; the table never starts on its own.
- **Round** — speakers take the floor in seating order, one turn each; an empty reply is recorded as 「思考后跳过」.
- **Waits for guidance** — after the last speaker the table stops; there is no automatic next round.
- **Interrupts** — a user message mid-round cancels the current speaker, joins the shared context, and the round resumes from that interrupted speaker. The message carries what the cancelled speaker had already said as a note below it, so the table answers a sentence it can see.
- **Stops** — `interrupt` cancels the speaker generating right now and hands the table back to the user. The speech it had already streamed is frozen into the transcript as an interrupted turn (text, thinking, and the calls its window made, in the order they happened), marked `interrupted` on the entry, in the logged `roundtable/turn`, and in the archive, and visually degraded on the page; no later speaker takes the floor, and the next message opens a fresh round.
- **@-call** — an @name in a user message narrows the next round to the named speaker.
- **Background runs** — a deep speaker submits long work with a background tool (`asset_run_bg`) and keeps talking instead of waiting. The engine keeps the open table's ledger of submitted runs in the live room, reads each run's record at every turn boundary, and records the finished result as a system note; the speaker that submitted it gets one supplement floor — after the speaker that just finished, before the rest of the queue — whose instruction asks for the conclusion first and then for what it corrects. Several finished runs from one speaker ride one supplement; a run still `running` past `runStalenessS`, or with an unreadable record, is recorded as lost and dropped. A run that finishes after the round ended is consumed when the user's next message opens the next round, because the engine never starts a round on its own.
- **Clears** — `reset` empties the room, releases the open-table configuration, and leaves the setup reachable again; a table that spoke archives its transcript first (`archiveDir`, default `<harness home>/roundtables`), so the conclusion outlives the process and `dsh-tool-roundtable` can serve it to the agent. Opening a different table archives the outgoing one the same way; an empty opening writes nothing, and a failed archive write keeps the old table running instead of silently losing it.
- **Survives a restart** — every change writes the open room to `<archiveDir>/live.json` (atomic tmp-write + rename), and the next process restores it: the table configuration, the transcript, the controller state, and the shared read material. A room that was mid-round when the process died comes back in `wait-user-guide` with an empty queue and no partial — the speaker generating then is gone — so the user's next message opens a fresh round. A live-room file that cannot be read or parsed is logged loud and the process starts with no table, because one corrupt file must never keep the host from booting.

The moderator always closes: a member marked `moderator` takes the floor last wherever the seating lists it, so member order is argument order and never a fight over who summarizes.

### Depth: what a speaker may do before it talks

- **Shallow** — a bounded window over one tool: the speaker may call `web_search` (`SEARCH_TOOLS`) and nothing else, then speaks. It reads no page body and no workspace file, which is what keeps the depth quick. A shallow speaker's step cap (`shallowMaxSteps`) is the mode's design rather than a research deadline, so a turn it ends is never marked truncated.
- **Deep** — a research window over the READ-ONLY tools this deployment registers plus the named background submission tools (`backgroundTools`), then the speech: the engine reads the tool definitions visible in the speaker's scope and keeps the ones that declare themselves read-only (`ToolDefinition.readOnly`), so a composition that registers another read-only tool offers it here without naming it; the background tools are named in configuration instead, because their flag contract forbids what they do to the process. A deep opening also carries the seed briefing, the shared-read digest, and the asset background-run discipline below. Both depths open with the same message — the whole transcript plus the instruction to speak — so a deep speaker researches with the table in front of it. Every window is bounded by its step cap (`researchMaxSteps` deep, `shallowMaxSteps` shallow), the whole window by `researchMaxMillis`, and each tool result by `researchMaxResultChars`; the last request carries no tool catalog and a call it asks for anyway is not run, so a window always ends in a speech. A speech records what it consulted as a citation list, and a turn whose window hit a limit is marked so the page can say it answered from what was already read; the raw tool results never enter the transcript. The window replays each of its own turns with the reasoning blocks the route emitted — thinking-mode routes require the reasoning content to ride along on tool-call turns.
- **Speaker thinking** — every speaker request runs on the table's route with that route's reasoning default, and the thinking a speaker emits is recorded with its turn: on the transcript entry, in the logged `roundtable/turn`, and in the archive, where the page shows it as a disclosure beside the speech. The entry and the live partial carry the turn's thinking and its calls as one ordered `flow` timeline — a stretch of thinking, then a call, then more thinking — so a reader sees the turn the way it was produced; the flattened `reasoning` and `tools` fields stay the authoritative record and a transcript written before `flow` existed renders from them unchanged. Thinking never joins the shared context — later speakers see speeches, not each other's drafts.
- **Seeded tables** — a deep table may continue an existing conversation: `open` names the session, the engine reads it through `ctx.sessionQuery`, renders its visible messages to a markdown file under `<archiveDir>/seeds/`, and tells every deep speaker the file's path. The conversation is never inlined into context — each speaker reads the file itself through the window's `read` tool. A seed on a shallow table is refused (no window could read it), an unreadable session fails the open loudly, and the seed never leaks into the remembered configuration.
- **Agentless research tools** — the web deployment disables root-level tools in favor of per-session presets, so a browser-driven room has no session scope to inherit. On first use the engine mints its own read-only tool scope (`agentlessResearch`, default true), mounts the read-only capabilities in it from the engine's construction-time origin context — a Remote call runs the gateway's methods with a caller-bound shadow context, and a plugin mounted under a shadow resolves its injected services from the shadow origin's fiber chain, which never declared them — and waits for the mounts to settle before the window reads its catalog. `tool-fs-search` declares a required `sampleOverCapGlobResults` (both shipped rows set false), so the engine's own mount names it explicitly. A scope that resolves no read-only tool logs a warning and its deep speakers answer without lookups; a deployment without a capability keeps that tool out of the catalog and logs why. Calls on an agentless table run the registered tool definitions directly — the registry's execution pipeline keys its checkpoint, telemetry, and session observers on a real Agent, which the room does not have, so the catalog, the caps, and the window's deadline are the only police on those reads; an agent-driven room executes through the registry as usual. A tool call a speaker writes as TEXT (DSML-ish markup) is never executed and never becomes the speech: mid-window it draws a correction notice, and markup left in a final text is stripped.
- **Shared reads** — what one deep speaker's window reads is table property: every successful call's tool, arguments, and capped result accumulate (deduplicated by tool and exact arguments) into a digest that later deep speakers' openings carry, so nobody re-fetches what the table already has. The digest flows oldest-first under `sharedDigestMaxChars`; the full per-call material stays in the logged `roundtable/turn` research records.

### Observable success and failures

`roster` returns the seatings, the table's configuration, and the room; `room` returns the live snapshot — including `partial`, the turn streaming right now; `open` returns the opened room, or throws for an unknown seating or a depth that is neither; `saveRosters` stores the user's own seatings; `userMessage` acknowledges with the updated room; `interrupt` stops the round and answers with the settled room, so it can be called while `userMessage`'s round is still generating (the Gateway dispatches each unary request as it arrives, and `userMessage` returns as soon as the round has started); `reset` clears the table and releases its configuration. A remembered seating that no longer exists seats the default one, and the room opens with a note naming the seating it lost; a remembered provider or model that is blank falls back to the deployment default. Remembering the choices is best-effort: a read-only settings provider, or a provider that refuses the write, leaves the table running and the next table on the previous values. A speaker whose request fails records a system note naming the failure and the round continues with the next speaker instead of stalling; an unknown floor name is skipped with a system note.

While a speaker generates, `room` carries `partial`: the speaker's id and name, the speech and thinking folded from the deltas so far, and the tool calls the turn has made — each call appears the moment the model starts streaming it and is updated in place when the window runs it. It covers the speaker's WHOLE turn rather than the request in flight: a deep speaker's research window makes several requests, and each one's text, thinking, and calls accumulate into the same partial, blank-line separated, so the reader keeps the turn's full thinking instead of watching it restart. The partial also carries the turn's ordered `flow` timeline — thinking and calls interleaved as they arrived — which is what a reader renders; the flattened `reasoning` and `tools` fields stay alongside it. It is a live view: the finished turn replaces it, and the partial itself is never written to the transcript, the archive, or the session log. `roundtable/turn` is appended once at the commit point where the turn joins the transcript — for a finished turn and for the frozen remainder of one the user stopped — so model-visible stays equal to logged.

The archive and the live-room file are the two durable formats, both under `archiveDir`. The archive is one JSON file per closed table (`src/archive.ts`); the live room is a single `live.json` replaced after every change (`src/live-room.ts`). Both read their transcripts back through the same validator (`src/parse.ts`), and both tolerate the fields a table written by an earlier build does not carry: `interrupted`, `tools`, and the `flow` activity timeline on an entry are optional, so an archive from before this build reads and renders unchanged. The live room additionally carries the controller state's background-run ledger; an absent ledger key restores as no submitted runs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`RoundtableGateway` (a `TypertRemoteService`) owns the live state: the table configuration, the state machine, the transcript, the busy flag, the live partial of the turn being written, a pending user message that arrived mid-round, the speech an `interrupt` froze, the supplement summaries waiting for their speakers' next floors, and the abort controller for the current speaker. Closing a table that spoke writes the transcript through `src/archive.ts` — the durable directory contract `dsh-tool-roundtable` reads back and the page's history column serves through `archiveList`/`archiveRead`. Every mutation also schedules a live-room save through `src/live-room.ts`; the debounce coalesces one polling interval into one write, each snapshot queues behind the previous write, and a service disposal flushes whatever is pending. A seeded table's export lives in `src/seed.ts`. `src/state-machine.ts` is the pure decision core — it owns phases (`wait-user-open` / `round` / `wait-user-guide`), the queue, skips, moderator-last ordering, @-call narrowing, the background-run ledger, and the explicit `interruptRound` transition back to the user, so turn order is a function of recorded events rather than of model output. `src/pending-runs.ts` is the boundary's pure decision over that ledger: reading the parsed run records, it turns finished ones into system notes and one supplement floor per submitting speaker, keeps the runs still in flight, and drops the lost ones. The engine reads the record files and applies the decision both when a round starts and after every speaker steps down. `src/identities.ts` holds the five speaking contracts and the roster vocabulary; `src/rosters.ts` resolves the shipped seatings against the user's own; `src/research.ts` is the bounded read-only window both depths run, over the catalog their breadth selects, and it rechecks the caller's cancellation between requests so a tool call that swallowed its own abort cannot open another one. The engine makes one `ctx.llm.stream` request per window step and records the folded reply; a provider failure reaches it as a terminal error chunk and becomes a skipped turn. Every request's stream passes through `mirror`, which folds each delta into the turn's live partial — carrying the earlier requests of the same turn forward across the request boundary, opening a tool call's line as soon as the model streams it, and appending thinking and calls to the partial's ordered `flow` timeline — before the window folds it, so the page sees the turn grow. `interrupt` freezes that partial, aborts the controller, and returns the machine to the user with an empty queue; the aborted speaker's drive loop records the frozen turn as it unwinds, so what the reader already saw is never dropped.

The engine writes its model-visible inputs to the session of the agent that drives the room: `roundtable/opened` (the choices, the seated speaking contracts, and the seed's session, title, and export path when the table continues one), `roundtable/message` (each user message and each note the room adds), and `roundtable/turn` (the speaking contract, the room text the request carried, the speech, the speaker's thinking, what a deep window read, and the turn's ordered `flow` timeline). A browser-driven room has no agent, so it has no session to write to.

### Source map

- `src/index.ts` — the Remote, the settings namespace, the open-table configuration, and the room engine.
- `src/state-machine.ts` — the pure phase/queue/skip/interruption state machine, the background-run ledger the state carries, and the supplement insertion that queues a finished run's speaker first.
- `src/pending-runs.ts` — the pure boundary decision over the ledger: which runs are consumed into notes and supplements, which are lost, and which stay in flight.
- `src/identities.ts` — the shipped speaking contracts and the roster/table types.
- `src/rosters.ts` — the shipped seatings, the user's own, and member resolution.
- `src/research.ts` — the deep speaker's read-only research window and its limits.
- `src/seed.ts` — the continued conversation's markdown export and its staging folder.
- `src/archive.ts` — the closed-table archive: record shape, atomic write, list, and read.
- `src/live-room.ts` — the open room's durable copy: record shape, atomic write, restore, and the shared-read budget.
- `src/parse.ts` — the validator both durable formats read a transcript entry, its tool calls, and its activity timeline through.

-----

<a id="model-experience"></a>
## Model Experience

### One speaker request

#### What the model sees

Each speaker's request carries that identity's own speaking contract as the `system` message and one user message: the full transcript so far (oldest first, newest last) plus the instruction to speak as that identity, in character, without repeating the identity label. A speaker's window opens with that same message and keeps it on every request, including the forced answer, so it researches with the table in front of it and answers the question it was asked. A deep window's opening additionally carries the seed briefing, the shared-read digest, and the asset background-run discipline — submit long work with `asset_run_bg`, keep speaking instead of waiting, and expect a supplement turn at the boundary. A supplement turn replaces the ordinary closing with the finished run's summary and asks for the conclusion first, then for what it corrects, focused on the increment rather than a repeat.

#### Token effect

Every speaker sees the whole transcript, so a round costs the sum over speakers of a context that grows with each turn — total tokens grow quadratically in round length. Both depths are windows rather than one request: a shallow speaker adds at most `shallowMaxSteps` requests, a deep speaker up to `researchMaxSteps`, and every tool result is capped per call.

#### KV Cache effect

The system message is stable per identity, but each speaker's user message differs and the transcript grows, so consecutive speaker requests share only the prefix the provider caches; there is no cross-speaker reuse beyond that.

### A truncated research window

#### What the model sees

A deep window that reaches `researchMaxSteps` or `researchMaxMillis` is told to answer now from what it already read, and its request carries no tool catalog. The speech stands; the turn is marked truncated, which the page renders as 「研究时间到，按已查到的内容发言」.

#### Token effect

The forced answer adds one short instruction to the window's context and ends it, so it bounds rather than extends the window's cost.

#### KV Cache effect

The instruction is appended after the results, so the cached prefix is unaffected.

### Skipped turns and failures

#### What the model sees

A speaker that replies with empty text is recorded as 「思考后跳过」; a provider failure is recorded as a system note naming the error, and a failure inside a research window is that same note. Both entries join the transcript and are therefore visible to every later speaker.

#### Token effect

One short transcript entry each; a failed turn costs whatever the failed request already consumed.

#### KV Cache effect

Appended to the transcript after the reusable prefix, so a skip or failure does not disturb the cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One room per host** — the engine keeps a single live table; there is no room registry, and `reset` clears that one table.
- **A restart resumes at the user, never mid-speech** — the open room is durable (transcript, phase, configuration, shared reads), but the turn in flight is not: a process that dies while a speaker generates comes back waiting for the user with `busy` false, and the speech it was writing is lost. The control state expires by design — the reading beyond the table's own transcript (the abort controller, the pending message, the partial) has no meaning in a process that is not driving the request.
- **The live-room copy is best-effort** — a disk that refuses the write logs and leaves the room running; the file is written at most once per polling interval rather than per streamed delta.
- **Opening a table clears the running one** — depth, seating, and model are the table's identity, so changing them cannot keep a transcript that was produced under another seating.
- **A speaker researches with the read-only tools the deployment declares** — the deep catalog is every visible definition carrying `ToolDefinition.readOnly` plus the configured `backgroundTools`, and a tool that never declares the flag stays out of it even when it only reads; the background tools are named in configuration because their own flag contract forbids what they do to the process.
- **The background-run ledger is table state** — opening or clearing a table drops it: a run submitted by a table that is then cleared keeps running and writes its record, but no speaker is left to receive the result. The ledger is durable with the rest of the open room (`live.json`), so a restart keeps following a run the same table submitted.
- **The run record path comes from the submitting tool** — the engine reads the absolute path the tool reported rather than deriving one from its own archive home, which is how the two asset-root conventions (the tool's library root and the Python side's `FINDECK_ASSET_DIR`) are kept apart. A deployment that points them at different directories makes the engine read a file the bridge never wrote, and the run then reads as lost.
- **The streaming partial is process-local** — `partial` exists only while a turn is in flight and only in the running host; it is never archived and never logged. An interrupted turn is the one part that outlives it, frozen into the transcript when `interrupt` stops the speaker; a partial that dies with the process is gone.
- **A browser-driven room has no owning agent** — the room scopes its research tools and writes its session events through the agent that drives it, and only an agent-scoped in-process caller supplies one today. A browser-driven room therefore runs its research tools agentless: relative paths resolve against the deployment's filesystem root, agent-scoped tool policy does not apply, and no session log records the room. Driving a room for a session needs an agent identity on the Remote — a `@RemoteScope('agent')`-style parameter or a session-bound room; neither is modeled yet.
- **The new session events are not in the persistence catalog** — `roundtable/opened`, `roundtable/message`, and `roundtable/turn` are declared by this package, and `packages/core/session/src/known-event-types.ts` is generated from the `SessionEventMap` declarations. The catalog must be regenerated (`pnpm run gen-persistence-catalog`) before a build can read back a log that carries them.
- **One route for everyone** — every speaker in a table uses the model chosen at open time; per-identity routes are not modeled.
- **No per-round count** — a table runs one round per user message; "three rounds unattended" is not expressible.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The state machine is pure and serializable so turn order is testable without the LLM; the engine feeds it speaker outcomes and the page reads the room it produces. The research window's limits are enforced on the complete window rather than per step so a single oversized page cannot fill a speaker's context and a loop cannot run forever.

</details>
