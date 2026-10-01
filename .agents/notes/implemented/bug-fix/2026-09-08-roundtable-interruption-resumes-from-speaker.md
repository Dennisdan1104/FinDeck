# Agent Note: Roundtable interruption resumes from the interrupted speaker

Status: implemented

English | [中文](2026-09-08-roundtable-interruption-resumes-from-speaker.zh.md)

## Problem

The roundtable engine makes one `ctx.llm.stream` request per speaker. `LlmRuntime.stream` normalizes an aborted request into a terminal `finish` chunk whose `reason.kind` is `'error'` instead of throwing, and the engine checked `controller.signal.aborted` only inside its `catch` branch — unreachable for both an abort and a provider failure. Two defects followed. A user message sent mid-round aborted the current request, but the engine recorded that speaker as 「思考后跳过」, ran the remaining queue, and only then applied the pending message by opening a fresh round from the top; the interruption contract in `state-machine.ts` was never exercised. A provider failure was rendered as a think-then-skip as well, hiding an infrastructure failure behind the speaker's own decision.

## Decision

`speak` inspects the terminal chunk and throws when `reason.kind === 'error'`, so a provider failure reaches `runRound`'s catch, which records a system note naming the failure and advances with a skipped turn. `runRound` checks `controller.signal.aborted` after the request returns, not only in the catch: an interrupted turn is not recorded, and the pending user message re-opens the round from the interrupted speaker through the state machine's interrupt branch. `tests/state-machine.spec.ts` (16 cases) and `tests/roundtable.spec.ts` (10 cases) pin both behaviors.

## Alternatives considered

**Treat an abort as a skipped turn.** Rejected: it hides the interruption and advances the queue past a speaker the user asked to steer.

**Render a provider failure as 「思考后跳过」.** Rejected: it mislabels an infrastructure failure as the speaker's own decision and gives the user no signal.

**Restart the round from the top after an interrupt.** Rejected: the user's message joins the shared context, and the R13 contract resumes from the interrupted speaker.

**Re-request the interrupted speaker inside the same loop iteration.** Rejected: the interrupt arrives as a new user message, and `onUserMessage` owns that state transition; the engine must exit and let it drive.

## Consequences

- An interrupt cancels the current request, records no turn for that speaker, and resumes from that speaker with the user message in context.
- A provider failure appears as a system note and the table keeps moving instead of stalling.
- The engine depends on `LlmRuntime`'s normalized finish chunks: an adapter that throws instead of finishing still lands in the same catch, but a future adapter that reports failure through another channel would need `speak` updated.
