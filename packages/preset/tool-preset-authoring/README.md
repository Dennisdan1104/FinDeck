---
description: "Model-facing authoring of session modes: list the roster, then create or rewrite one mode's display text and flow steps without touching its plugin composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-preset-authoring

English | [中文](README.zh.md)

## Summary

A session mode is a preset's authorable half: its display name, its description, and — for a work mode — the ordered flow steps the session runs. This package gives the model two tools over that half. `mode_list` answers the roster with each mode's steps; `mode_write` creates a mode by copying an existing preset and replacing only its `preset.yml`, or rewrites one the user owns. The composition beside it — which plugins the session mounts — never crosses the seam, so a mode these tools write cannot grant a session a capability its source preset did not already have. The tools exist because a hand-written mode has no validation and no feedback: a step id that is not kebab-case, a model that is neither `default` nor a `provider/model` route, or a work declaration with no steps each yields a preset discovery reports as broken. Every write passes the same rule discovery applies.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in a preset composition whose sessions should author modes — the shipped `cordis` preset is the one that does. It reads `ctx.tools` and the host's `ctx.agentPresets` roster; it registers no service and takes no configuration.

```yaml
- id: tool-preset-authoring
  name: '@deepseek-ai/dsh-tool-preset-authoring'
```

### When to choose it

Use it where a person is meant to shape how an agent works step by step and would otherwise hand-edit `preset.yml`. A session that only runs an existing mode has nothing to write; the tools stay idle until the request is to create or change one.

### What the model gets

- `mode_list` — every composable preset with its id, display name, trust, description, and steps in order (`id`, `label`, `model`, the step's stated purpose, and its `cluster` declaration when it carries one). `trust: user` marks the modes a write can change.
- `mode_write` — create (with `from`, the source preset whose composition is copied) or rewrite (with the mode's own `id`). Fields the call omits keep the stored value, except `steps`, which replaces the whole list. A step's `model` defaults to `default`, and its `prompt`, when given, joins the model's standing instructions for every request the session makes — not only when that step begins. A step may also declare `cluster` to have the AI cluster run it: `perspectives` names 2 to 8 member viewpoints (omit it for the runner's default panel) and `strategy` is `synthesize` or `vote` (omit it for `synthesize`).

### Observable success and failures

A stored mode answers with what the roster now resolves — its id, name, and steps — and says whether the call created or updated it. Every refusal names its rule: a non-kebab-case id, an id already taken, a work declaration without steps, a step model that is neither `default` nor a `provider/model` route or that carries a control character, a blank prompt, a `kind` outside `work` and `free`, an unknown copy source (`agent-preset/not-found`), and a preset that ships with the deployment or lies outside its writable root (`agent-preset/read-only`). A refused write leaves no directory behind.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design concept

The tools are a thin consumer of the roster service: every write goes through `AgentPresets.save`, which validates the flow by the same rule discovery applies, copies an existing preset's whole directory for a create, and writes only `preset.yml` for either path. Reading the roster back after the write — rather than echoing the request — is what makes the answer the mode a new session will actually run.

### Source map

- `src/index.ts` — the two tool registrations, the tool-to-request translation, and the roster rendering.

-----

<a id="further-exploration"></a>
## Further Exploration

- [agent-presets package](../agent-presets/README.md) — the roster, the mode declaration, and the authoring write it owns.
- [mode package](../mode/README.md) — what a declared flow drives at run time: the flow prompt section, `flow_step`, and the step trail.
- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-preset-authoring) — the generated schema reference for the two tools.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`mode_list` / `mode_write` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-preset-authoring), where `mode_write` carries the statement that a mode is what a session's steps are and not which plugins it mounts.

#### Token effect

Fixed schema cost per request where the tools are visible, in the presets that mount this row.

#### KV Cache effect

Prefix-stable while the tool definitions and visibility are unchanged.

### Tool results and errors

#### What the model sees

`mode_list` renders one line per mode, its steps indented beneath a work mode's entry. `mode_write` renders what was stored, the steps in order, and the statement that the composition was not touched. A refusal renders the validation rule that refused the call.

#### Token effect

Cost scales with the number of modes and the length of each step's stated purpose; a write adds only its own result.

#### KV Cache effect

Append-only; newly visible results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when these tools are a poor fit. They are current package constraints, not a task backlog.

- **A rewrite replaces the whole step list** — there is no per-step edit, so a change to one step restates every step; `mode_list` is what makes that affordable.
- **A create copies one preset's composition whole** — there is no "standard plus one plugin row", at this layer or the one below it.
- **Shipped modes are refused** — only user presets are writable, so a mode derived from `standard` keeps that source's composition and can never edit it.
- **A write does not re-compose a running session** — a session already composed keeps the plugin composition it started with, and only sessions created afterwards resolve the new one; the declared steps are different, because `flow_step` re-reads the roster, so a rewritten flow reaches a running session at its next step declaration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
