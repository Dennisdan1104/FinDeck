# Agent Note: A mode switch recomposes the session's preset

Status: implemented

English | [中文](2026-09-11-mode-switch-recomposes-the-preset.zh.md)

> Supersedes the switch mechanism of [R9 flow system phase one](2026-09-05-r9-flow-system-phase-one.md): the persona-only switch that note chose is replaced by a real composition switch.

## Problem

`dsh-mode` shipped in-session switching as a persona swap: one `mode/switched` event, the target preset's persona re-registered in the agent's scope, the composition untouched. A live session could therefore hold a prompt describing one preset's capabilities while running another preset's plugins. A session created on `standard` (研究模式) and switched to `cordis` (创造模式) received the Cordis persona — "Load the `editing-cordis-compositions` skill before writing or changing a composition", "Use the `mode_list` and `mode_write` tools for it" — while its skill catalog listed only the finance skills and its tool catalog held neither authoring tool. `skill` answered `Error: skill "editing-cordis-compositions" is unknown or no longer available`, exactly the guardrail an unknown name deserves; there was no tool to answer `mode_write` at all.

## Decision

**A mode switch composes the agent from the target preset.** `ModeController.switch` calls `agentPresets.recompose(agent.ctx, preset.id)`, which re-parents the agent's scope onto the target preset's standing mount, and only then records the fact and injects the notice. Tools, skill roots, prompt sections, persona, and realm-owned services become the target's from the next step on. `dsh-agent-presets` already owned this operation for blank sessions (`select`); a mode switch is the same operation under a different gate — the blank-session lock stays the preset picker's contract, while the user's mode gesture stays legal after the conversation has started.

**The switch records `agent-preset/selected`, not a mode-level event.** That is the fact a resume rebuilds a composition from (`dsh-agent-presets`' `agentPreset` projection), so a switched session resumes onto the preset it actually ran rather than its creation header's. The `mode` projection already folds it, so the step trail resets the same way. `mode/switched` stays declared and folded because released logs carry it.

**The persona override path is gone.** `filePersonaConfig`, the per-session override registry, and the `agent/created` persona re-registration are deleted: the composition's own persona row is the only persona a session shows. `applyLoggedMode` survives as a repair, and now recomposes instead of shadowing — when a resumed session's projection names a mode its created composition does not match, which is what a log written by the persona-only era looks like, it performs the composition switch that log describes.

**The composition commits before the record.** A target whose composition cannot mount throws out of `recompose` before anything durable is written; a failed `agent-preset/selected` append composes the previous preset back, so the log and the running composition cannot disagree. `/mode` reports a mount failure as a command error rather than losing the command to an exception.

## Alternatives considered

**Refusing to switch once a turn has started** — rejected. That is `select`'s blank-session contract, correct for a preset picker and wrong for the mode gesture, which exists to move a live session.

**Deferring the recompose to the next turn boundary** — rejected. The tool block and prompt sections are assembled per step, so a switch between steps already lands in the safe place; deferring further would leave the chosen mode and the running capabilities disagreeing for a whole turn.

**Keeping the persona override as the fallback for an unmountable composition** — rejected. It restores the exact mismatch being removed: a prompt advertising capabilities the session does not have.

## Consequences

- A session switched mid-conversation keeps its log, its history, and its earlier tool calls; every later step runs the target preset. A step already in flight when the switch landed keeps the tools it was called with.
- Session-level state is not part of the composition: the todo list a session has written survives the switch unchanged, because every `todo/write` is a committed session event and every shipped preset mounts the todo tools. No turn boundary retires that list either, so the progress panel a switch leaves standing is the one the session keeps.
- The request KV cache is invalidated at the switch, because the tool block changes.
- The AlphaDeck mode roster's four entries are now four genuinely different agents: 创造模式 delivers the Cordis toolset and its composition skill, 极简模式 its shell-and-editor composition (plus the todo list every mode mounts), 深研模式 its own.
- `ui-skill`'s catalog invalidation and `ui-commands`' directory reset, both already bound to the forwarded `agent-preset/selected` event, now fire on a mode switch, so the skill catalog a switched session reads is the new composition's.
- A preset that mounts a complete persona (`complete: true`, minimal) applies that complete prompt only while its own composition is mounted, which is the condition the flag was written for.

## Verification

The switched composition is observable end to end with no model request: a session on 研究模式 lists the ten finance skills in the composer's `/` menu; switching it to 创造模式 through the header mode control appends `agent-preset/selected: cordis` to the session log and the same menu then lists those ten plus `cordis-plugin-development` and `editing-cordis-compositions`.

## Related

- [R9 flow system phase one](2026-09-05-r9-flow-system-phase-one.md) — owns the flow system this note keeps, and the persona-only switch this note replaces.
