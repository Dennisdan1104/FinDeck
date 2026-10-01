# Agent Note: R9 flow system phase one — session modes over the preset roster

Status: implemented

English | [中文](2026-09-05-r9-flow-system-phase-one.zh.md)

> AlphaDeck work order P1-4 (requirements R9 phase one). Records why session modes ride the preset roster's persona mechanism instead of a new prompt path, and why the flow is declarative only in phase one.

> **The switch mechanism this note chose is superseded** by [a mode switch recomposes the session's preset](../bug-fix/2026-09-11-mode-switch-recomposes-the-preset.md): a switch now composes the agent from the target preset. Everything below about the flow, the `preset.yml` mode declaration, and the two UI slots still ships; the persona-only switch, `mode/switched`, and `filePersonaConfig` do not.

## Problem

AlphaDeck sessions compose from agent presets (`研究模式` and friends), and the product requires two capabilities the roster did not offer: switching a live session to another preset's mode without losing history (R9 in-session switching), and showing where a flow-driven session currently is (R9 read-only flow visualization). The existing composition switch (`agentPresets.select`) is deliberately blank-session-only — swapping tools mid-conversation would leave logged tool calls the new composition cannot make — so it cannot serve the first requirement, and nothing recorded step progress for the second.

## Decision

**Modes are logged state over the roster, not composition changes.** A switch writes one `mode/switched` event, then re-registers the target preset's persona section in the agent's scope through `agent.ctx.systemPrompt.section` — the same scoped-shadowing mechanism a mounted persona row and `dsh-subagent`'s per-child persona already use. The composition (tools, skills, sandbox) never changes, which is exactly why switching stays legal after the conversation has started. Resume restores a logged switch the same way: on `agent/created`, when the projection's mode differs from the composition preset, the persona is re-registered from the target preset's composition file (`filePersonaConfig`, new in `dsh-agent-presets`).

**The mode declaration lives in `preset.yml` beside the display metadata, but is semantic where display text degrades.** `mode.ts` in `dsh-agent-presets` validates `mode_kind: work|free` (absent = free) and the `flow.steps` shape (kebab-case unique ids, non-empty labels, `default` or `provider/model` per step). A `work` preset without a valid flow is broken at discovery — the roster row carries the reason, so every mounting path refuses it — because a work preset without a flow cannot run the mode system. `free` carrying a flow is refused as contradictory: the format exists to drive the work-mode machinery, and accepting a declaration nothing would honor would teach authors to ignore the marker.

**Steps are declared by the model, recorded durably, and folded for clients.** The `mode:flow` prompt section (first-party order 100, a new `MODE_FLOW` slot in `dsh-system-prompt`) lists the work flow and the current step, or invites short free-form labels in a free mode. The stable `flow_step` tool (registered in every mode so the tool catalog never changes across switches) validates work-mode declarations against the flow ids and appends `mode/step`; consecutive repeats fold away in the `mode` projection, whose wire view `{ mode, step, steps }` the Web step strip renders. `agent-preset/selected` (blank-session recompose) resets the trail with the mode.

**Phase one is declarative only.** Nothing gates a step, redirects mid-flow, or enforces per-step models — per the requirements, the flow is 声明 + 可视化; interruption, redirection, and per-step model binding arrive with phase two. The per-step `model` field is declared and displayed (the strip resolves `default` against the session's `modelSelection` projection) but not yet enforced.

**The UI surfaces are two conversation slots.** `conversation.input.mode` (the composer mode selector, beside the plan control) and `conversation.session.flow` (the strip under the session header) are declared by `ui-conversation` and occupied by the new `dsh-client-ui-mode` plugin. The selector executes `/mode <id>` through the shared command channel, so the dropdown and the slash command are one action with one log record; both surfaces read the host-computed `mode` projection, never client optimism.

## Alternatives considered

**Reuse `agentPresets.select` for in-session switching** — rejected. Its blank-session-only contract is load-bearing (logged tool calls must remain executable); weakening it for persona-level switching would couple two different guarantees. The new `mode/switched` event keeps the composition switch intact and adds a weaker, explicitly prompt-level transition.

**A new prompt-section mechanism for switched personas** — rejected. `systemPrompt.section`'s scoped shadowing already does exactly this; a second path would duplicate the registry's core semantics.

**Deriving step progress from turn/tool events** — rejected. Inferring "which flow step is this" from tool names is guesswork the model can simply state; an explicit declaration is cheaper, auditable in the log, and survives compaction by living in the projection fold.

## Consequences

Sessions can switch modes at any point with history intact; the step bar reflects declared progress in real time; resume and fork restore both. A mode switch changes the system prompt from order 0 onward (inherent to switching identity). The `dsh-mode` package is host-plane in the Web composition (beside the roster it reads), so every preset's session gets the command, the tool, and the fold — not only work modes. R11 (scheduled tasks binding to a flow) can now name the flow format; R9 phase two extends the same event vocabulary with interruption and steering.

## Verification

`packages/preset/mode/tests/mode.spec.ts` drives the real plugin stack over temp preset directories: the projection fold, `/mode` listing/switch/refusals (unknown, ambiguous, broken), the persona override's install/replace/restore (resume shape), the `mode:flow` section's work/free/absent arms, `flow_step` validation and idempotence, and HMR disposal. `packages/client/ui-mode/tests/components.client.spec.tsx` renders both seats over projection stubs: roster filtering, switch dispatch and refusal snap-back, the step bar's done/current/pending states with per-step models, and the free-mode trail. `packages/preset/agent-presets/tests` cover the mode declaration's accept/reject shapes at discovery and the shipped five-step research flow.
