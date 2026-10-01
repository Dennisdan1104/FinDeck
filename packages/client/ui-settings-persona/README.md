---
description: "System-prompt personalization for the dsh web client: the Host `system-prompt` settings namespace plus the System settings row and the System-prompt page that edit it."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-persona

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-persona` owns the user's personalization of the system prompt, at both ends. Its Host half registers the `system-prompt` settings namespace and mirrors that value into prompt sections: a non-empty `personaPrefix` renders just after the deployment persona, a non-empty `personaSuffix` just after first-party guidance, and non-empty `customInstructions` at the very end of the prompt. Its browser half is the editor of that namespace — three textareas and one Save button — mounted twice over one shared scope: as the `settings.general.item` row (`system-prompt`) inside the System settings section, and as the `settings.section` page (`system-prompt`) the shell's System-prompt destination routes to. Both occurrences read the same namespace and re-seed from its revision, so an edit through either one is what the other shows.

Every field's composition base is the empty string, so an absent or cleared field contributes no section at all rather than an empty one. A cleared field disposes its section through the same effect that registered it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the editor in a web profile next to the settings surface. The plugin requires `ctx.slots`, `ctx.locale`, and `ctx.settingsScope`; its Host half activates only when the profile also composes a settings provider and `dsh-system-prompt`.

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-persona'
```

No configuration. Open **System** (`settings.general.item` lives in the General section's column) or the shell's **System prompt** page, and edit:

- **Persona prefix** — rendered before first-party guidance, at section order `1`.
- **Persona suffix** — rendered after first-party guidance, at order `10210`.
- **Custom instructions** — appended at the end of the system prompt, at order `10220`.

Save writes all three fields of the `system-prompt` namespace. Saving an empty field is the documented way to remove that section again.

### When a change takes effect

Prompt assembly runs once per model step (`ctx.systemPrompt.assemble()`), so a committed value is in the very next request of every session — no restart and no new session is needed. The namespace is registered with `applies: 'live'` for that reason. The loop logs the changed system prompt as a `request/header` event with reason `change`, so a mid-session personalization stays reconstructable from the session log.

### Observable success and failures

While the namespace is still loading, and whenever the Host document is read-only or the browser is remote enough that its settings stay process-local, the textareas and Save are disabled and the row says the store is read-only. A failed write renders the failure text beside the button and leaves the typed text in place. A committed write re-seeds the textareas from the Host revision.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host half (`src/index.ts`) registers the namespace with `base` equal to the empty personalization, then subscribes: `sync` disposes the section currently registered for each field and registers a fresh one when the new text is non-empty. Everything it creates belongs to the `ctx.inject(['settings', 'systemPrompt'])` fiber, so losing either service disposes the sections along with the namespace.

The browser half binds the same namespace through `ctx.settingsScope` and mirrors its snapshot into each occurrence's store; `SystemPromptRow` reads the mirror through `props.useStore`, keeps its drafts in component-local state, and re-seeds them whenever the Host revision moves. Each occurrence owns its store handle and its own mirror subscription, because a store's only writer is the apply-world listener of the entry it was mounted for. Save writes the three fields through the scope's revision-fenced `set` calls.

### Source map

- `src/persona-settings.ts` — the namespace, field names, section names, schema, and the empty base, shared by both halves.
- `src/index.ts` — Host half: namespace registration and the section mirror.
- `src/client/index.ts` — dictionary registration, the scope binding, the two editor occurrences (the System row and the System-prompt page), and each occurrence's store mirror.
- `src/client/SystemPromptRow.tsx` — the editor: three textareas, Save, error state.
- `src/client/store.ts` — the row's store declaration.
- `src/client/locales.ts` — the `settings.systemPrompt` dictionary keys.

-----

<a id="model-experience"></a>
## Model Experience

This package is the end-user editor of the system prompt. Its model-visible effect is exactly the sections it registers: `settings:persona-prefix` at order `1` (after `harness:identity` and `deployment:persona-prefix`, before all first-party guidance), `settings:persona-suffix` at `10210` (after the deployment suffix at `10200`), and `settings:custom-instructions` at `10220` (last). Empty text registers no section, so clearing a field is what keeps the prompt unchanged.

#### KV Cache effect

Any save that changes a rendered section invalidates provider prefix reuse from the first changed system-prompt token, exactly as a deployment `personaPrefix` change does. Editing one field does not disturb the sections before it, so reuse survives up to the changed section.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Global, not per agent** — the sections are registered in the root scope, so they apply to every agent of the deployment. An agent preset that registers its own `deployment:persona-prefix` shadow keeps the user's prefix and suffix; one that declares `complete: true` replaces the whole prompt and drops the user's text with it.
- **No preview of the assembled prompt** — the row edits three fields and shows no rendered result; the registration order this package relies on is documented above instead.
- **Plain textareas** — no character count, formatting help, or validation. Any text is accepted; a `{{variable}}` reference in the text is interpolated strictly and an unknown one fails that assembly loudly.
- **One process-local revision at a time** — an external settings-document edit that lands while the user has unsaved drafts re-seeds the textareas and discards those drafts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The user sections carry names of their own (`settings:*` rather than `deployment:persona-prefix`/`deployment:persona-suffix`) because the prompt registry always registers the deployment pair globally: registering a same-named global section is a duplicate registration and throws. The scoped persona row (`dsh-persona`) can reuse those names because a scoped section shadows a global one, which is not available to a root-scope contributor.

</details>
