---
description: "Session-mode surfaces for the Web GUI: the composer mode selector and the flow progress strip; for users and maintainers of session modes."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mode

English | [中文](README.zh.md)

## Summary

This package renders the two session-mode surfaces in the Web GUI: the composer's mode selector — a compact menu over the preset roster that switches the session through the `/mode` command channel, with a free-mode AI-cluster toggle beside it that sets the session preference through `/cluster` — and the flow strip under the session header, which shows a work mode's declared steps with done/current/pending states and the current step's model, or a free mode's declared label trail. Mode behavior itself — the `/mode` command, the `mode` projection, the `flow_step` tool, the flow prompt section — belongs to `dsh-mode`; this package only renders the projection and sends what a user could equally type. A pick the composed skill-forge intake claims is not a switch at all: it opens that flow's own session picker.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` and `dsh-mode`; the selector then occupies the composer's mode seat beside the plan control and the title bar's mode seat, and the strip occupies the slot under the session header. Switching executes `/mode <id>` — the same action the slash command performs — so the dropdown and the command are one action with one log record.

### What the surfaces show

The selector shows the current mode's display name and offers the other healthy roster rows, each labeled with its mode kind; a mode the session's project layer supplied is marked with a `project` badge. The strip renders nothing while no mode is in force (a rosterless deployment) or the roster has not loaded. A work mode renders the flow's steps in order — completed steps filled dots, the current step in the accent color, pending steps dimmed — with the current step's label and model in the strip's right cluster, after the owner-threaded trajectory control; before the first declaration the first step reads as current. A step whose declaration carries an AI cluster shows a `cluster` badge beside its label. A free mode renders a "free mode" badge plus the trail of declared labels. In a free mode the composer's selector is joined by an `AI cluster` toggle — a seat-shaped button with a fan-out glyph, which shows the session's host-computed cluster preference and, clicked, executes `/cluster on` or `/cluster off` to set it; it takes the accent as a filled chip while on. A work mode declares its cluster per flow step, so no toggle renders there. A pick of a mode the composed skill-forge intake claims never switches anything: the intake opens the create-from-sessions picker, and this session keeps the mode it runs.

### Failures

A refused switch (an error result from the command) surfaces as a transient banner; the selector's label is the host-computed projection, so it snaps back to whatever the session actually runs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The three seats are conversation-declared single slots (`conversation.input.mode`, `conversation.session.header.mode`, `conversation.session.flow`); the node half is an empty apply (the roster row). Both selectors are the same component on the same injected face — a switch made in either seat is what the other shows next. Reads ride the generic projection pair through the standard-kit `useProjection` — the current mode and step trail are folded host values, never client optimism. The flow strip additionally reads `modelSelection` to resolve `model: default` steps against the session's model, places the owner share's `trailing` control in its right cluster, and the roster read (one `agentPresets.list` per surface mount, or `agentPresets.rosterFor({ cwd })` — whose rows are marked with the layer they came from — when the session's project is known) supplies the flow declarations and display names. The shared inject face carries `loadRoster`, `switchMode`, `setCluster`, and `openForge`; the two switches execute `/mode <id>` and `/cluster on`/`/cluster off` through `ctx.remote.commands.execute` and map error results to a banner line, while `openForge` consults the optional `skillForge` service (`ctx.get`) and, when that intake claims the picked id, returns before any switch runs. The composer seat and the title-bar seat are the same component, except that the composer seat opts into the free-mode AI-cluster toggle — the toggle is a seat-shaped icon button whose `aria-pressed` state is the projection's `cluster` field, over the same command channel as the slash command.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `/mode` command line the selector dispatches: `dsh-mode` owns the model-visible flow section, the `flow_step` schema, and the logged state that line drives.

#### KV Cache effect

Switching modes changes the persona section and therefore the request prefix; the selector and strip themselves add no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current mode surfaces. They are current package constraints, not a roadmap.

- **The strip is read-only** — it declares and visualizes steps; interrupting, redirecting, and per-step model changes are not implemented.
- **One roster read per mount** — a preset authored while the surfaces are open appears after the next mount or session switch, not live.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Mode state and boundary ownership are audited by dsh-mode, while both controls are slot effects whose declaration, registration, and teardown are exercised by this package.
