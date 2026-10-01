---
description: "Official DeepSeek Harness brand occupants for the sidebar, no longer assembled by FinDeck bundles; for maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

## Summary

This package fills the sidebar brand slots — `sidebar.brand.mark` and `sidebar.brand.name` — with the official DeepSeek Harness mark and name, and carries that artwork itself (`src/client/FishLogo.tsx`, `src/client/BrandWordmark.tsx`). **No FinDeck bundle assembles it**: the shipped profile mounts no row for this package, and the profile value its registration gate tests (`official`) is not one FinDeck sets, so the FinDeck mark and local-build label stay in the sidebar. Restore it only in a deployment whose deployed identity is DeepSeek's own. The conversation hero slot (`conversation.hero.brand.mark`) is unoccupied in every build: its declaring package renders the FinDeck mark as the fallback. It retains no runtime state and contributes nothing to model requests.

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

Mount this plugin in the browser roster of a deployment whose identity is DeepSeek's own, then arrange for the client build to set a profile value its gate accepts. FinDeck ships neither: its [web bundle](../../bundle/web-app/cordis.patch.yml) has no row for this package, and `pnpm run build` sets `DSH_CLIENT_BUILD_PROFILE=findeck` ([build environment](../../../scripts/client-build-environment.ts)).

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects which brand renders. An `official` build shows the official mark and name in the sidebar; any other value — including the `findeck` value every FinDeck build sets — leaves the shell fallbacks, the FinDeck mark and the local-build label, in place. The conversation hero shows the FinDeck mark from `dsh-client-ui-conversation` regardless of profile. The plugin still loads and validates in both cases; only the registration is profile-gated.

Restoring the official brand therefore takes two edits a deployment makes in its own composition: restore a `dsh.client` row for this package, and give the build a profile value this gate accepts — either by pointing the gate at that deployment's profile value, or by extending the profile set in [`scripts/client-build-environment.ts`](../../../scripts/client-build-environment.ts).

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar slots — and the hero slot, which this package leaves on its fallback. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar declaration, so the set works whether this row activates before or after the declarer, withdraws both occupants when the declaration collapses, and leaves no partial brand mix during HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

The mark and wordmark artwork lives in this package (`src/client/FishLogo.tsx`, `src/client/BrandWordmark.tsx`) rather than in `dsh-client-ui-primitives`, so the generic primitives every client bundle seeds statically carry no upstream brand art. Both modules take the shared icon prop type from the primitives (`import type` only, erased at build).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **Not assembled by FinDeck** — no shipped profile mounts a row for this package, and the profile value its gate tests is not one a FinDeck build sets; restoring it is a deployment's own composition change (see [Choosing the profile](#choosing-the-profile)).
- **The mark is a redrawn approximation** — its source glyph has no exportable vector geometry in the local design data, so a hand-authored recreation stands in until an exact export path exists.
- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its two slot occupants install and leave through one transactional effect.
