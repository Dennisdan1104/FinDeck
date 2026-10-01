# Agent Note: Todo progress persists across turns

Status: implemented

English | [中文](2026-09-12-todo-progress-persists-across-turns.zh.md)

Supersedes [Todo plan strip clears on the next turn](2026-07-28-todo-plan-clears-on-next-turn.md), which owns the reasoning that this note reverses.

## Problem

`todo_write` stores whole-list snapshots on the session log, and interactive hosts render the latest list as the user's progress panel (web TodoPanel via the `todos` projection). The [turn-boundary clear](2026-07-28-todo-plan-clears-on-next-turn.md) made that panel an artifact of a single turn: the list written in turn N was gone at the start of turn N+1. The rule assumed the model would restate the whole list at the top of every continuing turn, and the tool description said so — but a model that plans once and keeps working does not restate, and the panel then stays empty for the rest of the session. A preset switch made it worse without being the cause: the switch itself starts no turn and clears nothing, so the panel survived the switch and disappeared on the next message the user sent. The progress panel is durable state the user follows; it is not a per-turn artifact the harness may retire on its own.

## Decision

The standing plan is the latest `todo/write` in the log, full stop. No turn boundary changes it: `turn/start` and `turn/end` are both no-ops for the `todos` projection, so only a later write moves the panel, and a write carrying an empty list is the explicit clear.

### Host projection (web)

`dsh-tool-todo`'s `todos` projection unit folds the rule in `apply`: it returns `event.data.todos` for every `todo/write` and returns the same state reference for every other event, `turn/start` included. The unit is registered at `stateVersion` 3 (was 2) so persisted projection-cache rows folded under the turn-scoped rule are discarded instead of served. This is a client runtime projection over the same event set, so `SESSION_FORMAT_VERSION` is not involved and no session event is added, removed, or changed.

The two other folds of the same rule were updated with it: the keyless connection fixture's `backscanTodos` (and its `session/projection` push condition, which no longer advances on `turn/start`), and `agent_inspect`'s `foldSession` in `dsh-tool-subagent-control`, which serves a subagent's standing list under the projection's lifetime.

### Model-facing discipline

The progress panel is now the model's own running statement of where the work stands, and the tool description says what moves it: update an item the moment its step lands, rewrite the whole list whenever the plan changes (a task may go back to `pending`), send an empty list once the whole plan is abandoned, and use `todo_read` to recover the exact list after a context compaction. The four shipped presets (`standard`, `deep-think`, `cordis`, `minimal`) carry a sentence in their own voice to the same effect. The former instruction to restate the whole list as the first action of every continuing turn is removed: it existed only to undo the clear.

## Alternatives considered

- **Keep the clear and require a restatement each turn** — the shipped behavior this note reverses. It makes correctness depend on the model remembering a bookkeeping step, and its failure mode is a silently empty progress panel rather than a visible error.
- **Clear once every item is `completed`** — an automatic retire hides an abandoned or partly finished plan the same way, and it makes the panel's lifetime a function of the model's status labels rather than of the model's intent.
- **Clear on `turn/end`** — hides the finished checklist while the user is still reading the answer that completed it.
- **Append an empty `todo/write` on turn start** — mutates the log for a display rule and invents a write the model never authored.

## Consequences

The panel a user sees at the end of a turn is still there at the start of the next one, after a mode switch, and after reopening the session. Clearing is entirely the model's decision, expressed as an empty write, so a plan the model never abandons stays visible. A model that finishes a plan without clearing it leaves that plan on screen into the next turn — accepted, because the panel is the user's durable progress record and the model owns it, and the description tells it to send the empty list when the plan is done with. Coverage: the `todos` projection unit's own assertions, the keyless fixture's assembled web snapshot, and `agent_inspect`'s fold.
