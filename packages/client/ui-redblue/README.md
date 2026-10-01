---
description: "The red/blue prompt editors card in System settings: two textareas over the rbcheck settings namespace, where an empty value means the built-in default."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-redblue

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-redblue` is the red/blue prompt editors card: one `settings.general.item` row (`redblue-prompts`) inside the System settings section, rendering two textareas over the `rbcheck` settings namespace. Saving writes both prompts through the settings Remote; an empty textarea means "use the built-in default", so the reset buttons write empty strings rather than duplicating the shipped prompt text.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in a web profile after `ui-shell`, the settings surface, and the redblue host package that registers the namespace. It requires `ctx.slots`, `ctx.locale`, and the settings Remote faces it reads.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-client-ui-redblue'
```

No configuration. The card mounts in the System settings section; the prompts it edits are read by the host `/rb-check` command.

### What the card shows

- **Red prompt** — the attacker's review contract, with a reset-to-default button.
- **Blue prompt** — the respondent's defense contract, with its own reset button.
- **Save** — one button that writes both prompts; it reports the save timestamp on success and the failure text on error, and stays disabled until the initial read settles.

### Observable success and failures

A failed initial read renders the card's error line; a failed save renders the failure text beside the buttons and leaves the typed text in place. Saving an empty prompt is valid — it is the documented way to return to the built-in default.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`RedblueCard` holds the two textarea values, the loaded flag, the busy flag, and the last-save timestamp; `src/client/index.ts` registers the `settings.redblue` dictionary and the card row, and adapts the settings Remote into the card's `load` / `save` props. The card never reads the namespace directly, so the host package stays the only owner of the prompt defaults.

### Source map

- `src/client/index.ts` — dictionary registration, the `redblue-prompts` card row, and the `load` / `save` adapters.
- `src/client/RedblueCard.tsx` — the card: two textareas, reset buttons, save and error state.
- `src/client/locales.ts` — the `settings.redblue` dictionary keys.

-----

<a id="model-experience"></a>
## Model Experience

None, as the card only reads and writes the settings namespace; the host redblue package owns the prompt text the model actually receives.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One global prompt pair** — the card edits the single `rbcheck` namespace, so a change applies to every `/rb-check` run rather than per preset or session.
- **Plain textareas** — there is no prompt preview, diff, or character counter; the saved text is what the command injects.
- **No prompt validation** — any text is accepted; an unusable prompt fails later as a model-behavior problem, not as a save error.
- **Reset writes empty strings** — resetting does not copy the shipped defaults into the namespace, so the card shows empty textareas and the host substitutes the defaults on read.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The card writes empty strings for reset because the host substitutes the shipped defaults on read; the namespace's base holds the default text, so the card never duplicates it.

</details>
