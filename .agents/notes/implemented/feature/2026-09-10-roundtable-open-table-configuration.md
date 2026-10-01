# Agent Note: roundtable open-table configuration — depth, seating, and model

Status: implemented

English | [中文](2026-09-10-roundtable-open-table-configuration.zh.md)

> AlphaDeck work order B (requirements R13). Records why a table's depth, seating, and model became choices made at open time rather than deployment configuration, and why the deep table's research tools are a fixed whitelist inside the engine.

## Problem

A roundtable ran on deployment configuration alone: `provider` and `model` came from the plugin's cordis config, the roster was four shipped identities plus a settings array nobody could write, and every speaker made exactly one request per round with no tools and no thinking parameters. The user could not say "dig into this one" or "seat five people for this", and the custom-identity path the page's own copy pointed at ("add them in System settings") did not exist in any shipped surface.

## Decision

**A table is opened with three choices, and they are the table's identity.** `open(depth, rosterId, provider, model)` seats a table, writes the three choices to the `roundtable` settings namespace, and clears whatever table was running. Depth, seating, and model are not settings that mutate a live discussion: a transcript produced under one seating cannot be re-attributed to another, so changing them opens a new table. `userMessage` opens one silently with the remembered choices when none was opened, so the first message is never refused for a missing setup, and `reset` keeps the configuration — clearing a table is not closing it.

**A seating is a named, ordered list, and the user's list replaces the shipped one by id.** `src/identities.ts` holds five shipped identities and two shipped seatings (`classic`: bull, bear, macro, moderator; `finance`: the same plus the industry expert); `src/rosters.ts` layers the user's own seatings over them. A member naming a shipped id and stating nothing keeps that identity's name and contract, which is what makes editing a shipped seating cheap; a member stating its own keeps both. Editing `classic` stores a `classic` seating, so the shipped list stays the fallback rather than a thing to patch.

**The moderator is a flag, not an id.** The old state machine moved the speaker whose id was literally `moderator` to the end, which breaks the moment a user names their own closer. Ordering now reads `identity.moderator`, so member order is argument order and the seating's closer is whatever the seating marks — including a seating that marks none, which speaks exactly in the order it lists.

**The deep table's research window is bounded inside the engine.** A deep speaker alternates requests and tool calls until it answers or a limit ends the window; the whitelist (`web_search`, `web_fetch`, `read`, `glob`, `grep`) is fixed in `src/research.ts`, the catalog advertised to the model is that whitelist intersected with what the deployment registers, a call outside it is refused with a reason, and the final request carries no catalog at all. That last property is what makes the window terminate in a speech: a limit can never end in another call the engine would have to refuse. Limits apply to the complete window — requests, wall clock, and characters per result — because one oversized page would otherwise fill the speaker's context.

**The transcript keeps the conclusion, not the research.** A deep turn records a citation list (the tool plus what it was pointed at) and the speaker's own text; the raw tool results exist only inside the request it was researching in. The table reads what was consulted; the argument for what it means is the speech.

**The seating editor and the AI share the metadata-only boundary.** `saveRosters` carries names, speaking contracts, member order, and the moderator flag — never a plugin, a tool, or a permission — so the same four fields a person edits on the page are the complete set a caller can state.

## Alternatives considered

**Depth as a per-message setting** — rejected. "Dig into this one" reads naturally, but a table's context is shared: two speakers researching and two not would produce a transcript whose turns are not comparable, and the engine's per-turn behavior would depend on state the transcript does not record.

**Rounds-per-open ("three rounds unattended")** — deferred with the requirement. The engine runs one round per user message by design (the table stops for guidance), and an unattended count would need its own cancellation and cost story.

**Per-identity models** — rejected for this work order. The requirement is one model chosen at open time, and a per-seat route would multiply the catalog UI without a stated need.

**Approval prompts inside the research window** — rejected. Four speakers × several steps × a round would ask the user to approve a dozen read-only reads; the alternative is not to research at all, which is the feature. The whitelist is the safety property instead: nothing in it can change the workspace, the session, or the process.

**Filtering the catalog by the whitelist but allowing the call** — rejected. Advertising one set and executing another is the kind of asymmetry that makes a model's failures unattributable; the refusal message names the whitelist so the speaker can correct itself.

## Consequences

The roundtable page now opens on a setup screen with the three choices seeded from the last table, and the seating editor writes the settings namespace the page's help text used to point at a nonexistent surface for. The shipped set gained an industry-expert seat and a five-person finance seating. Every request in a table uses the model chosen at open time, so the deployment's `provider`/`model` config is a starting default rather than the route. A deep table costs up to `researchMaxSteps` requests per speaker plus the speech — three to ten times a shallow round — and its transcript shows sources where a shallow one shows nothing. The `roundtable` settings namespace changed shape (`identities` → `rosters` + `last`); no shipped surface had ever written it.

## Verification

`packages/skill/roundtable/tests/state-machine.spec.ts` covers ordering with a moderator listed first, a roster with none, and @-call narrowing. `packages/skill/roundtable/tests/roundtable.spec.ts` drives the real gateway over an in-memory settings provider and a gated fake LLM: the shipped rosters and their member resolution, a user seating replacing a shipped one, `open` remembering its choices and refusing an unknown seating, the remembered table opening on the first message, per-table routing, and a deep table researching through the whitelist, refusing a shell call, speaking with citations, and recording a research failure as a skipped turn. `packages/skill/roundtable/tests/research.spec.ts` covers the window itself: its catalog, both refusals, the result cap including the failure prefix, the forced tool-free final request, and the provider-failure path. `packages/client/ui-roundtable/tests/roundtable.client.spec.tsx` renders the setup, asserts the three choices reach `open`, exercises the seating editor's reorder and save payload, and renders a deep turn's citations.
