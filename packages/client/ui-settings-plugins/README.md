---
description: "Plugins settings page for the dsh web client: the section chrome, the configurable host-plane plugin cards stacked in the system region, and the settings.plugin.item extension point."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-plugins` is the **Plugins** settings page of the dsh web client: the section owns the navigation entry, the heading, and the single page-body seat, while the body registrant composes the user-managed plugin cards and the collapsed system region. This package's own `configurable` view stacks inside that system region and shows one expandable card per Host plugin whose configuration a user owns: a card shows the plugin's name and what it governs, and expanding it reveals hand-written controls bound to that plugin's settings namespace, each field marking whether the user overrode it and offering a reset back to the value the deployment composed. Cards stage edits locally and write only on save, with every write fenced by the namespace revision the form read.

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

Open the Plugins section in Settings and expand the **System plugins** region to edit the host-plane plugins this deployment composes. The cards appear in this order: the shell executor (`bash`), the agent loop's tool-call parallelism (`agent-loop`), delegation limits (`subagent`), subagent model selection (`subagent-model-selection`), the DeepSeek search provider (`web-search-deepseek`), the model-facing web tools (`tool-web`), the local fetch transport (`web-fetch-http`), and a read-only report of the selected web providers (`web`).

### What appears here

The `configurable` view reads which settings namespaces the Host serves and dispatches one slot key per namespace, so what renders is the intersection of two ledgers: the namespaces a live Host plugin registered, and the cards registered under those keys. A served namespace no card claims renders nothing, and a card whose namespace this deployment does not serve is never dispatched. The empty line waits for the Host's first answer, so an unanswered read never reads as "this deployment configures no plugin".

### Editing and saving

A card stages what the user types and writes it only when they save. Each control renders staged text, so what is on screen is exactly what a save would store; **Discard** drops the drafts, and a card holding unsaved edits says so on its header even while collapsed. A successful save collapses the card after the read-back confirms the writes; a failed save keeps the card open, reports the failure, and retains the drafts for correction. A reset stages the composed default rather than writing immediately, and a draft the field does not accept blocks the save instead of being dropped. The Host is the only authority on whether a value was accepted.

The Subagent card stages its permission switch and exact model checkboxes together. Enabling requires at least one selected adapter route. Saving submits `enabled` and `allowedModels` in one mutation fenced by the revision where that draft began; a newer Host revision marks the draft failed instead of restoring a revoked route. Disabling retains the selected routes for later reuse. Available models are grouped by provider, while saved routes absent from the current catalog appear last and remain removable. Adapter names and model descriptions remain live directory metadata and are not stored, and the card refreshes them after adapter changes, settings commits, and reconnects.

The Subagent limits card stages delegation depth and the shared online capacity together; each admits only a whole number at or above the bound the Host schema asserts, so an unsendable draft blocks the save. Those two values reach every delegation attempt, so editing them changes limits only for work not yet delegated; capacity already in use stays online. The Web tools card stages enablement and the numeric bounds the two web tools run under; both mid-card bounds re-register the tools from the saved section, so a model that already read the previous tool description is unaffected until the next turn. Two controls per card sit behind the **Advanced** disclosure: the search provider's version header and answer-token cap, and the two tool-call budgets.

Web search, web tools, and web fetch each persist ordinary configuration fields; the Web providers card is the exception, reporting the provider this deployment selected for search and each fetch with no control at all, because that selection is a deployment fact rather than a user preference.

### Secret-role fields

A key control starts blank, reports only whether one is configured, and writes through the credentials domain rather than the settings section; a blank draft writes nothing and keeps the stored key.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The section is page chrome plus one extension point and one dispatch rule: the body registrant owns the layout, feature plugins own their cards, and the `configurable` view pairs served namespaces with registered cards by slot key.

### The page-body and card extension points

The section declares `settings.plugins.body`, the one page-body seat its registrant fills. The inventory package's body declares `settings.plugins.system` — the seat the body opens inside its collapsed system region — and this package registers its `configurable` contribution there. That contribution declares the nested `settings.plugin.item` slot, keyed on the settings namespace a card edits. A plugin that ships a browser half registers its own card under its own namespace and owns every part of it: chrome, controls, and copy. System views stack in the contribution's `order`; cards follow registration order.

### The write path

Saving writes staged fields through the client settings scope, which fences each write or ordered mutation with the namespace revision the draft read, so a form that has drifted from the document is refused rather than overwriting a concurrent change. A field's presence in the raw user layer — not its value — is what marks it overridden; a reset clears that field so it re-inherits the composition layer. Secret-role fields never ride a response; the card re-reads on the forwarded `credentials/reference-updated` event for the reference it watches.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings base, the page body, and the durable seams behind the cards.

- [ui-settings](../ui-settings/README.md) — the domain base declaring `settings.plugins.body`, `settings.plugins.system`, and the settings scope.
- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.md) — the Plugins page body that opens this view's seat.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [credentials](../../credentials/README.md) — the credential-reference seam secret fields write through.
- [ui-settings-general](../ui-settings-general/README.md) — the settings shell hosting this section.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define which plugins appear and how fresh the list is; they are current package constraints.

- **Only host-plane plugins appear** — a plugin an agent preset mounts carries its configuration inline in that preset's `agent.cordis.yml` and cannot register a settings namespace at all, so this section lists nothing for it. Editing those values remains the preset editor's job.
- **A card still needs a browser bundle** — the browser half must be a `dsh.client` package built in the client module system's lazy-CJS factory format, and the `clientBundle` preset that emits it lives in `../../../packages/client/tsdown.client.ts` rather than a published package, so a plugin outside this repository has to reproduce that build itself.
- **The served namespaces re-read on two signals only** — the wire announces settings-document commits and connection resets, not registrations, so a namespace whose owner registers after the view's read joins the list on the next document commit or reconnect.
- **The shell card follows the composed executor** — the POSIX and PowerShell executor families share the `bash` namespace because a host composes exactly one of them, so the served schema differs by platform (PowerShell adds `pwshPath`) even though the card edits the same two fields on both.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This is a browser-side settings surface whose node half owns no event stream or mutable runtime data; the layering and write refusals are Host contracts covered by the owning plugins and the api-proxy.
