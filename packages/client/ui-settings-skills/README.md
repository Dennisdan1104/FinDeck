---
description: "Skills settings page for the dsh web client: the skill inventory with enable switches, the inline skill editor, the curated gallery, external-root imports, and creating skills from sessions."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-settings-skills

## Summary

`dsh-client-ui-settings-skills` is the Skills settings page of the dsh web client, organized into four tabs over the Host's `skillsAdmin` Remote namespace. **Installed** lists every skill the deployment can serve with its enable switch, an inline editor that creates, edits, views, and deletes user skills, and the manual rescan. **Gallery** installs curated open-source skills with one click. **Import** copies skills discovered in other agents' skill roots (Claude Code, Codex) — or at a typed absolute path — into the user skills root. **Create from sessions** groups stored sessions by project for selection and distills the chosen ones into a new skill by handing the Host's seed prompt to a fresh AI session composed from the Host's skill-authoring work mode. Every write goes through the Host and lands before the page answers — nothing here edits files directly or asks for a restart.

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

Open **Skills** from the Settings navigation and pick a tab.

**Installed** (the default) shows one row per skill with its description and metadata: the source bucket (`custom`, `user-dsh`, `user-agents`, `bundled`, `project-dsh`, …), the provider that owns the body, the directory its relative resources resolve against, and the invocation policy as `Model` / `User` tags. The switch hides a skill from every consumer at once — the model-facing catalog, the `/` menu, and body loading by name — and the disable list is stored in the user-settings document, so it survives a restart. **Rescan** re-runs provider discovery. **View / edit** opens the skill's document in the inline editor above the rows; skills outside the user roots open read-only with a note. **Delete** appears only on user skills and asks for an inline confirmation. **New skill** opens the same editor empty; the name is a kebab-case identity that cannot change after creation.

**Gallery** lists curated open-source skills with their origin, license, and repository link. **Install** downloads the SKILL.md host-side into the user skills root, and the skill goes live immediately — no restart needed. An installed entry is marked and its button disabled.

**Import** groups skills found in other agents' skill roots by root, and imports one per click into the user skills root; a skill whose name already exists in the inventory cannot be imported. The custom-path row imports any absolute path — a directory holding SKILL.md or a single Markdown file.

**Create from sessions** lists recent sessions (newest first, at most 50) folded into collapsible project groups — one group per recorded working directory, its last path segment as the label, sessions the Host recorded no directory for collected into a final group — with the selection count and **Create skill** above the picker. Selecting one or more and pressing **Create skill** asks the Host to extract their transcripts, then opens a fresh session composed from the Host's skill-authoring work mode whose first prompt is the extraction seed: the new session's AI reads the transcripts, asks you clarifying questions, and writes the SKILL.md. The same picker is also the flow's other entry point: picking **技能创作模式** in a conversation's mode control opens it as a frame-wide dialog, and confirming creates that new session instead of switching the one you were reading.

When the settings document is read-only, or the browser is remote enough that its settings stay process-local, every switch and write button is disabled and the page says so.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page holds no facts of its own. Every mutation Remote (`setDisabled`, `create`, `update`, `remove`, `importExternal`, `installGallery`) answers the whole inventory after its own change, so one accepted response replaces the store's entries and the rows can never show a half-applied write. A superseded response is dropped by a generation counter. The lazily loaded slices — gallery entries, external roots, forge sessions, and the editor's loaded document — each carry their own state fields and their own generation counter, so one tab's slow answer never overwrites another's.

Writability is the one fact the inventory cannot carry, so the plugin binds the same `skills` settings namespace through `ctx.settingsScope` and mirrors its snapshot's `writable` flag into the page store. Per-skill writability arrives with the editor's `read` answer; the rows offer delete only for the `user-dsh` / `user-agents` source buckets that back the writable roots.

The forge flow copies the asset hub's AI hand-off: `skillsAdmin.forge()` answers a seed prompt plus the skill-forge preset it names, the store creates a fresh session through `ctx.sessions` composed from that preset, opens it (which navigates the shell to the conversation), and submits the seed as the session's first prompt. The picker groups the Host's rows by their recorded `cwd` locally; the page adds no session fact of its own. One picker component serves both frames — the page's tab and the `shell.overlay` dialog — and the plugin provides the `skillForge` service (`openFor`) that the composer's mode pick consults: the claimed pick opens the dialog and switches nothing, so the mode-id routing lives here while the preset the session is composed from stays the Host's answer.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the domain base whose scope service and `settings.section` slot this page builds on.
- [api-skills-controller](../../api/skills-controller/README.md) — the Host owner of the inventory, the editor writes, the gallery, external imports, and the forge extraction.
- [skill](../../skill/README.md) — the registry whose disabled set makes a switch visible to every consumer.
- [ui-assets](../ui-assets/README.md) — the page whose fresh-session AI hand-off pattern the forge flow reuses.

-----

<a id="model-experience"></a>
## Model Experience

Indirect: the page's model-visible effects are the disable list it writes and the skills it creates, installs, or imports. A suppressed skill leaves the model-facing catalog and is refused by name, so the next assembled prompt no longer advertises it; a new or changed skill appears at the next catalog read after the Host's rescan. The forge flow's seed prompt is itself a model input, submitted as the first prompt of the session it creates.

#### KV Cache effect

No direct effect; the prompt changes only through the catalog it is rebuilt from, exactly as it does when a provider's discovery changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A skill no provider discovers any more has no row.** The disable list keeps its name, but the page can only render skills the current inventory returns; re-enabling it needs a discovery that finds the name again.
- **The disable list is name-keyed and layer-independent.** Two layers contributing the same name are one switch, matching the registry's filter.
- **Row-level delete visibility is source-bucket-derived.** The inventory row does not carry a writable flag, so delete is offered for the `user-dsh` / `user-agents` buckets that back the Host's writable roots; the editor's loaded document is the authoritative verdict for edits.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The plugin declares `sessions`, `remote.skillsAdmin`, and `remote.sessionsAdmin` in its cordis `inject`, and lists `@deepseek-ai/dsh-api-session-controller` among its informational `dsh.client.inject` edges (mirroring ui-assets).

</details>

**Runtime invariant:** No companion is published. A nav-entry-only section plugin that reads Remote namespaces and one settings scope and owns no cross-plugin mutable relation.
