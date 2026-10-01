# Agent Note: A roundtable speaker hears the room, and the room is logged

Status: implemented

English | [中文](2026-09-11-roundtable-grounding-and-logged-room.zh.md)

## Problem

The roundtable's open-table configuration shipped with three defects that made the feature unusable, plus two architectural gaps:

- A deep speaker never received the room. The engine built the transcript plus the turn instruction only in the shallow branch, and the deep branch handed the research window an empty message list, so the first deep request was the speaker contract plus a tool catalog with no user question and no prior speech. The speaker researched blind and spoke ungrounded, which contradicted the package README's own description of the request.
- The open-table configuration could never be reached again. Opening a table set the table and nothing cleared it, while the page renders the setup only while no table is open — so depth, seating and model were frozen for the life of the host process. The shipped copy promised the setup returned when the table was cleared.
- A user-authored seating could never hold more than one member. The control labelled "add a person" created a new seating, and nothing added a member to the seating being edited. Nothing could mark which member closes either, though the roster model and the state machine both support a moderator.
- The package wrote no session events, so nothing reaching a speaker request was reconstructable from the log, against the repository rule that model-visible input requires a session event.
- Research tool executions ran with no agent, so relative paths resolved against the deployment's working directory rather than the user's workspace, and session-scoped guards and the user's approval policy never observed the call.

## Decision

- The engine builds the room context once and hands the same opening message to both the shallow request and the deep research window, so every speaker request — including the forced final answer — starts from the transcript and the turn instruction.
- Clearing the table releases the open-table configuration. The setup returns pre-selected from the remembered choices, and the copy in both locales says exactly that. No new action or Remote method was added, because the promise the UI already made is this behaviour.
- The seating editor gains a real "add a member to this seating" control, a separately labelled control for creating a new seating, and a one-closer radio group. A new seat is seeded from the first shipped identity the deployment lists, so it is speakable before the user types anything.
- Three session events are declared by `SessionEventMap` merge and appended at their commit points: the opened table with its seated speaking contracts, each joined room entry, and each finished turn carrying the exact room text the request used, the speech, its citations, whether a limit ended the window, and a deep turn's tool traffic.
- A remembered seating that no longer exists resolves to the default at configuration time and records one system entry naming what was lost, so a stale settings value cannot reject a user's message.
- Remembering the table skips the write when the settings provider is read-only and contains a write failure with a logged warning; opening a table never depends on it.
- The research window propagates the caller's abort to tool execution alongside the deadline.
- An unknown depth and an unknown mode kind are refused by name instead of being silently coerced.

## Alternatives considered

**Give the deep speaker its own research prompt and let it re-derive the question.** Rejected: the room text is what makes a speaker's turn answerable, and re-deriving it would let two speakers disagree about what was asked.

**Add an explicit "configure a new table" action instead of releasing on clear.** Deferred: clearing already means "this discussion is over" and the UI copy already promised the setup would return. A second way to reach the same state would need its own confirmation copy and Remote surface.

**Mark the roundtable events ignorable so older builds could read a log containing them.** Rejected: the events carry model-visible input, and `ignorable` would let a build skip input a later model request depends on. The generated event catalog is regenerated instead.

## Consequences

- A deep speech answers the question that was asked; a speaker that researched without finding anything still answers from the room.
- The open-table configuration is reachable again after the first table, and the setup shows the seating that will actually be used.
- A custom seating can hold several members, be reordered, and name one closer.
- A roundtable run driven by an agent is reconstructable from the session log. The shipped browser path still has no agent identity on the wire, so on that path the room is not logged and research tools run without session scope; both are recorded as limitations in the package README, and making them true needs an agent identity established through the Remote call.
- Regenerating the persistence catalog is part of this change: the events are required-on-read, so a build without the regenerated catalog refuses a log that contains them.
