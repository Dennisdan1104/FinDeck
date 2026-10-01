---
description: "The FinDeck red/blue adversarial review: editable red and blue prompts under the rbcheck settings namespace, the /rb-check command a human runs, and the rb_check tool the agent itself calls — red first, blue second, conclusion written back."
kind: "package-reference"
---

# @deepseek-ai/dsh-redblue

English | [中文](README.zh.md)

## Summary

`dsh-redblue` is the red/blue adversarial review: it registers the `rbcheck` settings namespace, which holds the user-editable red-team (attacker) and blue-team (respondent) prompts, the `/rb-check <report path|thesis id>` command a human runs, and the `rb_check` tool the agent itself calls. Both entries inject the same structured instruction carrying both prompts in order — red first, then blue, then the write-back steps — and the owning session's model performs the phases sequentially in one run; the tool's inject is claimed at the calling agent's next step boundary, so the review continues the same turn. Both prompts are store-backed with shipped defaults, so resetting to default is a plain write of empty strings.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition that has `ctx.settings`, `ctx.commands`, and `ctx.tools`. The write-back step reuses `thesis_mark` when the target is a thesis id, so mount `tool-thesis` alongside it for that path.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-redblue'
```

No plugin configuration. The prompts are user settings under `rbcheck`:

| Field | Default | Meaning |
|---|---|---|
| `redPrompt` | the shipped red-team contract | Injected as the first phase; an empty value means "use the default". |
| `bluePrompt` | the shipped blue-team contract | Injected as the second phase; an empty value means "use the default". |

### What the command does

`/rb-check <报告路径|命题id>` takes one argument naming the deliverable under review. The handler resolves the stored prompts (empty means default) and injects a single `system-reminder` message containing the target, the red phase, the blue phase, and the write-back steps; the model then runs the phases in order and appends the conclusion to the report's red/blue section, or calls `thesis_mark` when the target is a thesis id. An empty argument returns a usage error without injecting anything.

### Observable success and failures

The command returns a success line naming the target, or a usage error for an empty argument. The `rb_check` tool takes one `target` argument and returns `{ target, queued }` — the instruction arrives at the calling agent's next step, so the model completes both phases before other work; an empty target or a non-agent caller is rejected. A malformed `rbcheck` value is refused by the settings schema at registration; a failed model phase surfaces through the ordinary session stream, and the user can interrupt the run at any point.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package is one plugin body: it registers the `rbcheck` scope with the shipped prompts as the settings base, and registers the `/rb-check` command whose handler composes the instruction with `buildRbCheckInstruction` (exported pure so tests and reuse share the exact text). The orchestration is deliberately left to the session: the command injects one message and returns, so the phases appear in the session log as ordinary model work that can be steered or interrupted.

### Source map

- `src/index.ts` — the `rbcheck` schema and defaults, `buildRbCheckInstruction`, and the command registration.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-thesis) — the `thesis_mark` schema the write-back step uses for a thesis target.
- [Settings catalog](../../../docs/config-catalog.md) — how the `rbcheck` namespace appears to the settings surfaces.

-----

<a id="model-experience"></a>
## Model Experience

### The `/rb-check` instruction

#### What the model sees

One injected user message (`system-reminder`) carrying the whole review contract: the target, the red-team prompt, the blue-team prompt, and the numbered write-back steps.

#### Token effect

Cost scales with the two prompts; the shipped defaults are about ten lines each, and stored overrides replace them verbatim.

#### KV Cache effect

The message is appended as ordinary user input after the reusable request prefix, so a check does not disturb the cacheable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One round** — each entry injects red then blue once; there is no automatic re-attack after the defense, and a second review is a second `/rb-check` or `rb_check` call.
- **Prompt editing is global** — the `rbcheck` namespace holds one prompt pair, so a change applies to every check rather than per preset or session.
- **The model performs the phases** — the package injects instructions, not an enforced pipeline; a model that skips the blue phase or the write-back produces a short transcript rather than a refusal.
- **The write-back targets text** — the report section is appended by the model; there is no structured record of an individual attack point beyond what the model writes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The command injects one message and returns, so the phases are ordinary logged model work the user can steer or interrupt. `buildRbCheckInstruction` is exported pure so tests pin the exact injected text.

</details>
