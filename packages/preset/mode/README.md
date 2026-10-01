---
description: "Session modes for users and maintainers switching a live session between presets, driving work-mode flows, and reading the step trail."
kind: "package-reference"
---

# @deepseek-ai/dsh-mode

English | [中文](README.zh.md)

## Summary

`dsh-mode` adds session modes over the agent-preset roster: a session starts in its composition preset's mode and you can switch the mode in place — `/mode <preset>` or the composer's mode control — which re-registers the target preset's persona in the agent's scope without touching the composition, so history and context survive the switch. A work mode additionally carries a flow declared in the preset's `preset.yml`; the `mode:flow` prompt section tells the model the steps and the current one, and the stable `flow_step` tool records the model's step declarations into the session log. The `mode` projection folds it all for clients: the current mode plus the declared step trail. Phase one is declarative only — the flow is visibility plus the model's own discipline, never a gate.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package wherever `dsh-agent-presets` is composed and sessions should be switchable or flow-visible. It takes no configuration of its own; everything it reads comes from the roster.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-mode'
```

The package injects `tools`, `systemPrompt`, `sessionProjections`, and `agentPresets`, so a composition without the roster fails at load rather than at first use.

### Switching modes

Type `/mode` to list the roster with the current mode, or `/mode <preset>` to switch: an exact id, an exact display name, or a unique prefix of either. A switch composes the agent from the target preset — its tools, skills, prompt sections, persona, and any rows behind its own realms — so the session runs that preset from its next step on. It then records `agent-preset/selected` and injects a one-line notice the transcript renders. The session log itself is untouched: history, context, and every earlier tool call stay, and a resumed session rebuilds the composition it actually ran under rather than the one its creation header names. A preset whose composition cannot mount refuses the whole switch, and the command reports why while the agent keeps running its previous preset.

A switch is not a session reset, so session-level state survives it: the todo list a session has written stays exactly as it was, in both directions, because every `todo/write` is a committed session event rather than per-preset state. Every shipped preset mounts the todo tools, so a switch never takes the progress display away either — a free mode simply shows nothing until its model writes a list of its own. What changes is the composition: the tool catalog and prompt sections the next step assembles are the target preset's.

### Work-mode flows

A preset declares its mode classification in `preset.yml`:

```yaml
mode_kind: work        # work = flow required | free = lightweight/discussion
flow:
  steps:
    - id: plan
      label: 规划      # the display name, localized by the preset author
      model: default   # default follows the session model, or provider/model
      prompt: |-       # optional: what this step does, in the model's instructions
        拆解问题，写出假设。
        确认数据口径。
```

`mode_kind: work` without a valid `flow` is broken at discovery — the roster row carries the reason and every mounting path refuses it. A `free` (or undeclared) preset owes no flow and is exempt. While a work mode is in force, the `mode:flow` prompt section lists the steps and the current one, and instructs the model to call `flow_step` at the beginning of each step; in a free mode the section instead invites short free-form labels. Declarations land as `mode/step` events; consecutive repeats fold away.

A step's `prompt` is appended under that step's entry in the flow section, indented to the entry, so what a step is FOR is stated where the model reads the flow. It adds to the agent's standing instructions rather than replacing them, and it never enters a `flow_step` result: a declaration answers with the step's id, label, and model, because the purpose is instruction text and not step data.

A step declaring `cluster` is executed by the AI cluster rather than by one model, and the flow section says so: the step's line carries ` · cluster: <strategy>`, or ` · cluster: <N> perspectives` when only viewpoints are declared, or the bare ` · cluster` when neither is; one line indented under the step's stated purpose — directly under the entry when the step states none — directs the model to run that step with the `cluster_run` tool, passing the step's task as its task argument. The closing `flow_step` guidance is unchanged.

### Session-level cluster preference

`/cluster` turns the session's AI-cluster preference on or off: no argument toggles it, `on` and `off` set it explicitly. The preference is soft and it outlives mode switches — nothing is gated, and no preset has to mount the cluster tool. While it is on, the `mode:flow` section ends with one line asking the model to prefer `cluster_run` for tasks that benefit from several independent perspectives and to skip it when a single pass is enough. A free mode always carries a line, preference or not, stating that the cluster tool is the model's to use when the composition makes it available; a work mode's step list and its own cluster-step guidance are unchanged. Setting the value already in force writes nothing, so repeated invocations never grow the log.

### Observing mode state

Interfaces read the `mode` projection: `{ mode, step, steps, cluster }` — the preset id in force, the current step (the last declaration, or null before the first), the declared trail in order, and the session's AI-cluster preference (false until it is turned on). The projection folds from the log alone, so resume and fork restore it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the package and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

Modes are logged state over the roster, the same stance plan mode takes: the composition switch commits first, then one log-only whole-value event records it (`agent-preset/selected`, which resets the trail with the mode), never a live mirror, so resume and fork recover by composing from the log.

### Switching as a composition change

A switch composes the agent from the target preset through `recompose` in `dsh-agent-presets`: the roster re-parents the agent's scope onto that preset's standing mount, so the whole inherited layer — tool registrations, skill roots, prompt sections, the preset's own persona, realm-owned services — becomes the target's for every later assembly. Nothing is torn down: the previous preset's standing mount is shared with the sessions still running it, and the agent's own scope keeps its history, its session log, and its registrations. The `tools/change` emission that follows is what lets Agent-owned overlays and client caches reconcile. On `agent/created` the same operation repairs a session whose log names a mode it was not composed from — a switch written before a mode change moved the composition. The listener awaits that repair so the corrected composition is in place before the first assembly, and swallows its own failure: a failed repair must never cost the session its agent, and it leaves the composition the agent was created with.

### The flow_step tool

The tool stays registered in every mode so the request tool catalog is stable across switches. A work-mode declaration is validated against the flow's ids and rejected with the valid list; a free-mode declaration takes any non-empty label. Re-declaring the current step is idempotent — the trail keeps one entry per real step.

### Session projection unit

The `mode` unit folds `agent-preset/selected` (blank-session recompose) and `mode/switched` into the mode with a reset trail, and `mode/step` into the trail; both mode-setting folds keep the cluster preference, which `mode/cluster` replaces whole. The wire view derives `step` as the last trail entry. `stateVersion` is 2: the added `cluster` field makes older persisted rows fail the strict state schema, so a bump discards them and refolds from `init` — the preference's pre-cluster value. The key merges into `SessionProjectionMap` from [`src/types.ts`](src/types.ts).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `ctx.modes` service, `mode` projection, `mode:flow` section, `/mode` and `/cluster` commands, `flow_step` tool |
| [`src/types.ts`](src/types.ts) | The `mode` projection-key declaration and `ModeProjection` wire value |
| [`src/client.ts`](src/client.ts) | Client-namespace re-export of the types outlet |

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Mode flow system prompt

#### What the model sees

A work mode contributes the `mode:flow` section at first-party order 100: the ordered steps, the current step and its position, and the instruction to call `flow_step` when beginning a step. A free mode contributes the free-form-label invitation instead, always closing with the line that the `cluster_run` tool is the model's to use when the session's composition makes it available. A session whose AI-cluster preference is on ends either form with the line asking the model to prefer `cluster_run` for tasks that benefit from several independent perspectives and to skip it when a single pass is enough. No mode in force (a rosterless deployment) contributes nothing.

##### Example (research mode, before the first step)

```markdown
You are running inside a multi-step workflow. The flow, in order:
1. 规划 (plan)
2. 取数 (fetch-data)
3. 分析建模 (analyze-model)
4. 验证 (validate) · cluster: synthesize
   Run this step with the cluster_run tool: pass this step's task as its task argument.
5. 报告 (report)
No step has been declared yet. Begin with step 1, 规划 (plan).
Call the flow_step tool with a step id each time you BEGIN a step, including the first. The declaration only updates the user's progress view; it does not interrupt your work.
```

#### Token effect

The section is present in every request of the mode; it is short and stable within a step. The cluster preference adds one line while it is on, so the section is one line longer until `/cluster off`.

#### KV Cache effect

The section is stable within a mode; a mode switch changes the system prompt from order 0 (the persona) onward, which is inherent to switching identity.

### The flow_step tool

#### What the model sees

The stable `flow_step` schema with one required `step` string argument. A work-mode call outside the flow's ids fails with the valid list; a repeated current step returns normally without a new log event.

#### Token effect

Each declaration is one tool call in conversation history.

#### KV Cache effect

Declarations extend the conversation normally. A composition switch replaces the request's tool block and prompt sections from the next step on, so everything before the switch is a cache miss and everything after it re-caches under the new preset.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe when session modes do not behave as you might expect or need extra care. They are current package constraints, not a roadmap.

- **Declarative only** — the flow is visibility plus the model's own discipline; nothing gates a step, redirects mid-flow, or enforces per-step models. Interruption and steering are not implemented.
- **A switch moves the whole composition** — the target preset's tools, skills, prompt sections, and persona replace the previous preset's from the next step on, and the request cache is invalidated by the new tool block. A step that was already in flight when the switch landed keeps the tools it was called with.
- **The flow section renders from a cached roster row** — the first assembly after a session start may fold before the roster read lands, contributing no section until the next assembly.
- **Free-mode labels are unvalidated prose** — only work-mode step ids are validated against the flow; a free-mode trail is whatever the model declared.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
