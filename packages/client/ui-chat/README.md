---
description: "Browser Chat target that renders Session conversation nodes, details, historical images, actions, localization, and scroll state."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-chat

English | [中文](README.zh.md)

## Summary

The browser Chat target for Conversation assembly. It registers Chat event definitions and snapshot construction, supplies `useChat`, renders transcript nodes and details, and owns Chat-specific stores, actions, localization, and scroll restoration; historical image URLs resolve through the Conversation-owned per-session cache (`ctx.uiConversation.imageUrl`). Its Assistant and Turn Tail definitions fold packed historical Assistant runs without expanding their members. A `developer-message` Definition shares Context presentation with `input-message`, so an incremental tool-set change renders as a context row instead of an unknown row. Steering classification retains only next-step Inbox IDs through persistent splice state; next-turn splices create no Chat Context. Local submission echoes (`SessionSnapshot.pendingSubmissions`) retain the surface selected when the submit begins: transcript echoes render at the flow tail, steering echoes render with the pending-steering marker, and queued echoes stay out of Chat. Each echo is hidden per render once a user/steering node or queue occurrence carries its prompt `rpcId`, so the handoff is atomic.

## Table of Contents

- [System prompt row](#system-prompt-row)
- [Turn token usage](#turn-token-usage)
- [Turn Process Folding](#turn-process-folding)
- [Scroll ownership](#scroll-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="system-prompt-row"></a>
## System prompt row

Chat shows a collapsed `System prompt` row for each non-empty initial or resumed request, explicit message-series start, or real system-field change. It does not repeat the row for same-series config-only or tool-only changes, tool steps, or retries. The row appears before that request's user messages, matching the provider envelope, and expands to the exact model-visible text with its original line breaks. A `system/message` appended inside a series owns its own card at that position and titles itself `System prompt update`. A partial history window renders a non-initial header conservatively until the preceding page arrives; a header without a system prompt creates no row.

-----

<a id="turn-token-usage"></a>
## Turn token usage

A completed Turn shows an expandable usage row only when the loaded window includes `turn/start` and every started model attempt reports safe, exact usage. The row omits unavailable optional buckets. Incomplete or contradictory accounting hides the complete disclosure instead of presenting a partial total.

-----

<a id="turn-process-folding"></a>
## Turn Process Folding

Settings → General exposes a persisted four-mode conversation-display preference in the `ui-chat` namespace; `Standard` is the default. [presentation-policy.ts](src/client/presentation-policy.ts) translates that persisted value into one presentation policy — whole-Turn folding, step grouping, live process detail, and settled reasoning preview — and every seat and renderer selects a single policy field instead of comparing the mode enum:

| Mode | Whole-Turn folding | Step grouping | Live process detail |
|---|---|---|---|
| `Compact` | yes | collapsed | no |
| `Standard` | yes | collapsed | yes |
| `Detailed` | yes | collapsed turns only, history grouped | yes |
| `Verbose` | no | none | no |

Persisted values from the earlier three-mode preference still validate and read as a current mode: `compact` keeps its name and meaning, and `grouped` reads as `standard`, `normal` as `verbose`, `expanded` as `detailed` through the fixed `LEGACY_FORK_MODE_MAP` in [chat-settings.ts](src/chat-settings.ts) — applied in memory, so the stored key changes to a current mode only when the reader next picks one. Verbose leaves process rows visible and renders no Turn-process control; each reasoning block renders as a quiet Think row that starts collapsed and keeps the reader's own open choice, which the enclosing Turn's fold resets. In Compact mode, the System prompt remains independently visible before the opening User throughout the Turn. Context injection, reasoning, Assistant material, Tool rows, and Retry rows remain expanded while a Turn is open. At `turn/end`, its latest Step becomes the final-answer boundary only when it contains non-blank text, an image, or an unknown visible block—and no Tool-call block; preceding Context injection, reasoning, earlier Assistant material, Tool rows, and Retry rows then collapse by default. The control reports Turn-wide durable counts for non-subagent Tool calls, reply-bearing Assistant messages before the final answer, and subagent delegation calls; zero-valued segments are omitted, the Tool and subagent figures are mutually exclusive, and neither System prompt nor Context injection contributes a count. When all three counts are zero, the process still folds and the control reads `Thought for a while`. Process rows carry no border, background, or divider: the Turn's process reads as part of the message flow, and every row sits in the tertiary label tier at the tertiary font size, one step under the secondary tier. User and steering messages, System prompt, error, max-token, and turn-tail rows stay outside, and a closed Turn with no final answer keeps all process evidence visible. A newly available process control is inserted without changing the relative order of existing rows: opening human input precedes the control and process rows from their first projection, while System prompt remains above that input. While older history remains available through Load earlier, process controls stay absent and no members are hidden; once history is complete, every eligible closed Turn uses the collapsed default immediately. Stable Chat Node Seats keep every renderer mounted, hidden members add no flow spacing, and a closed control sits 8px above its answer only when no independent input intervenes. Completion collapse does not depend on tail-follow position, so a reader above the tail may see the transcript reflow. An automatic collapse that would hide keyboard focus keeps the group open and leaves focus in place; a manual close focuses the process control before hiding its members. In Grouped mode a Turn's process renders as quiet rows interleaved with its own narration: one row counting the Turn's context injections at the Turn's process front, one Think row per reasoning segment inside the Assistant message, and one aggregated row per uninterrupted run of Tool calls. The counts aggregate Tool names into browse, web-search, web-fetch, shell, file-mutation, subagent, and other families, and their localized segments are joined into one line. `write` and `edit` calls render as path chips carrying their argument-derived added and removed line counts inside their run's member list, and `bash` and `pwsh` calls render as member rows whose expanded body is the terminal block — the `$` prompt line over the command's output on the code-block surface — so neither family appears twice; a call whose arguments are still incomplete keeps its own row. Every member row is a single line at the tertiary tier, ellipsized past the column, and every tool row leads with its call's status character — `✓` settled, `⟳` running, `✗` failed — instead of a coloured badge. Every other member keeps its own renderer. Every fold in the process area is one primitive — the segment, the Think row, the action run, and the context row differ only in variant and copy — so a fold's chevron points right while folded and down while open everywhere, and every folded body is indented under its header behind one hairline with `hidden="until-found"`. A Turn's context injections always merge into that single row, one injection or ten, and a Turn that declares no boundary keeps the row at its process front. The grouped plan is the grouped transcript's only render source: a partially loaded window renders through the same rows as a complete one, so no context injection can appear as a row of its own and the structure never changes under the reader as history arrives. A run that is still executing is the one default-open row; it collapses to its summary as soon as the run settles, and an opened row lists its members under a 1px hairline indented 12px. Above those rows the Turn's declared steps fold them once more: each `flow_step` declaration opens one segment titled with the step name its flow strip shows — the declaration carries the step id, so the segment reads the mode roster through the presets remote for that label — and a Turn that declares no step falls back to its todo list, where the item entering progress titles the segment until it leaves progress again. A segment is a container: everything declared inside its boundary renders in its body in flow order — reasoning rows, action runs, the Assistant's narration, and the Turn's context injections, which lead the first segment — indented under its header behind one hairline. Folding a segment takes that whole stretch with it; two exceptions stay outside: the opening before the first declaration, and a settled Turn's closing answer, which no fold may hide. A segment header is the one heavier row — ink title, the product accent on its in-progress and settled marks, and its runs' aggregate counts. A Turn with neither a declaration nor a todo transition keeps the flat quiet rows. The session-scoped store records the reader's explicit open choice per Turn and never removes it, so a row the reader closed while it ran stays closed; the Compact control reads that choice directly ([folding decision](../../../.agents/notes/implemented/feature/2026-08-14-web-turn-process-folding.md), [ordering decision](../../../.agents/notes/implemented/bug-fix/2026-08-26-stable-turn-process-order.md)).

-----

<a id="scroll-ownership"></a>
## Scroll ownership

Chat restores semantic anchors across history prepend and renderer remounts. While the reader is pinned to the floor, `ResizeObserver` follows the new floor and selects the latest loaded Turn without reading row geometry. Once the reader moves away, flow-height changes preserve the top position and the reading-line geometry selects the active Turn. Turn-rail previews paint above sticky Markdown code-block banners, while the rail frame remains inside the transcript band above the composer ([loaded-Turn navigation](../../../.agents/notes/implemented/feature/2026-08-25-loaded-turn-chat-navigation.md)).

In a grouped display mode — `Compact`, `Standard`, and `Detailed`'s historical Turns — the process-group body is itself a scrollport, capped at `min(400px, 50vh)` with `scrollbar-gutter: stable`; [ChatGroupSeat.tsx](src/client/chat/ChatGroupSeat.tsx) marks the two scroll edges so [ChatGroupSeat.module.css](src/client/chat/ChatGroupSeat.module.css) can mask the top and bottom fade only where more content is reachable. The verbose display mode instead marks the group root with `data-group-expanded-mode`, which drops the cap, the fades, and every observation and animation the group controller owns.

[use-scroll-follow.ts](src/client/chat/use-scroll-follow.ts) supplies independent controllers for shared bottom thresholds, follow intent, and native scrolling; [use-process-scroll.ts](src/client/chat/use-process-scroll.ts) owns group observation, initial placement, and the edge fades. Opening a group whose Turn is still open positions it at the bottom and a closed group at the top, and that placement stays immediate. Within a group, wheel, touchstart, and any pointerdown interrupt an active smooth animation, including presses on tool cards; ArrowUp/ArrowDown, PageUp/PageDown, Home/End, and Space keys also interrupt it unless a child has prevented the key's default action; editable controls are not excluded. Interruption needs no scroll displacement, and subsequent position sampling decides whether following continues. Group growth uses native smooth scrolling unless reduced motion is requested: it retains an in-flight target until `scrollend`, and arrival at that target or its shrink-clamped position continues toward the latest floor, while stopping anywhere else releases following. Outer following remains immediate, and a bottom-follow request within tolerance positions immediately whenever no animation is outstanding, so a fractional no-op cannot leave a pending smooth target.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders logged conversation state in the browser and registers nothing model-facing.

#### KV Cache effect

None; Chat presentation does not assemble or mutate provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The transcript reflects the loaded Session window** — older transcript nodes become available only after Session Controller loads the preceding event page. Turn navigation is wider than the window: the rail merges the loaded Turns with the host `turnOutline` projection, so every started Turn gets a fixed-pitch mark (10px apart; a ladder taller than the frame scrolls inside it with gradient fades), and activating an unloaded mark pages history through the Turn's `turn/start` seq before landing on its row. Without the projection (assemblies not mounting `dsh-session-turn-outline`) the rail falls back to loaded Turns only.
- **Rail previews are card-sized** — one prompt line (50 characters) and up to three response lines (120), on loaded and unloaded Turns alike; an unloaded Turn's response arrives from the outline only once the Turn settled, so an open Turn previews its prompt (or just the Turn number) until then.
- **File chips are not yet wired into group bodies** — TurnProcessFileChip and countsLine in [TurnProcessRows.tsx](src/client/chat/TurnProcessRows.tsx) are retained from the previous grouped transcript, but the current process groups render their members through the ordinary Tool rows and place no chip row inside a group; re-wiring them belongs to the work-details follow-up.
- **Fork-local fold components have no consumer** — [FoldRow.tsx](src/client/chat/FoldRow.tsx), TurnProcessFileChip, and countsLine are kept deliberately as fork-local components rather than deleted, and no renderer mounts them today; the process seats render their own headers. A reader adding a fold reuses FoldRow instead of writing a fourth variant.
- **`settledReasoningPreview` has no selector yet** — the field stands in [presentation-policy.ts](src/client/presentation-policy.ts) and no seat reads it, so no mode currently changes a settled reasoning row's preview; wiring it into the Think row belongs to the reasoning-row follow-up.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation and Slot registration enforce Chat target consistency.
