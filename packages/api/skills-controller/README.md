---
description: "Host Remote owner for the skill inventory, its durable disable list, manual rescan, user-skill document CRUD, external-agent import, the curated gallery, and the create-skill-from-sessions forge."
kind: "package-reference"
---
# Skills Controller

## Summary

`@deepseek-ai/dsh-api-skills-controller` exposes the generated `ctx.remote.skillsAdmin` namespace and owns the durable `skills` settings namespace. It answers the complete skill inventory of a deployment — the global registry layer merged with every Agent preset's standing layer, suppressed names included — writes the disable list that hides a skill from every consumer, and forces a provider rescan on demand. The disable list is applied to `ctx.skills` directly, so one settings change removes a skill from the model-facing catalog, the human command catalog, and body loading at once.

Beyond the inventory it manages the user skills root (`$DSH_HOME/skills`, with `~/.agents/skills` honored as a second writable root): `read`/`create`/`update`/`remove` edit SKILL.md documents on disk, `external`/`importExternal` migrate skills out of other agents' roots (Claude Code, Codex), `gallery`/`installGallery` install curated open-source skills from their upstream raw URLs, and `forge` extracts stored sessions' transcripts and answers the seed prompt a fresh session distills into a new skill.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package as a Loader entry in a profile whose browser surfaces skills. The namespace is registered in the constructor, independently of the settings and skill services, so an invocation over an incomplete composition reports a named error instead of a missing method.

`list()` answers the inventory: every discovered skill across the global layer and every preset's standing layer, name-sorted, first scope winning a duplicate name. Each entry carries the name, description, discovery source bucket, owning provider, the directory its relative resources resolve against, both invocation-policy booleans, and whether the disable list currently suppresses it. Presets whose standing composition cannot be resolved are logged and skipped rather than failing the read, and `includeDisabled: true` keeps a suppressed name in the merged catalog so the page can render it as a row to turn back on.

`setDisabled(name, disabled)` folds one name into the `skills` namespace's `disabled` array and persists it through the settings provider — so the list lands in the user-settings document next to every other preference, and a restart resolves it again. The namespace is registered with `base: { disabled: [] }`, and every committed change is applied to the registry: `snapshot`/`list` drop suppressed names from every layer and `get` refuses them. An invalid name is `bad-request`; an absent settings or skill service is `internal` with the missing composition named.

`reload()` drops the registry's cached catalogs so the next read re-invokes each provider's discovery. Providers with filesystem watchers invalidate on their own; this is the manual rescan for roots a deployment changes without a watcher. Every mutation below also ends with a reload, so its answer already reflects the change.

`read(name)` loads one skill's document: a file-backed skill is read from its SKILL.md (or flat `<name>.md`) so an edit preserves frontmatter fields this surface does not render; a provider without a file answers its loaded body as read-only. `writable` marks a skill under a user skills root.

`create(request)` writes `$DSH_HOME/skills/<name>/SKILL.md` from the submitted frontmatter fields and Markdown body. A malformed name is `skills/invalid-name`; an already-discovered name or occupied directory is `skills/conflict`.

`update(request)` rewrites one writable skill's document, preserving frontmatter fields it does not edit (invocation flags, metadata). A skill outside the user roots is `skills/read-only` — bundled and custom-root skills are edited at their source.

`deleteSkill(name)` permanently deletes one writable skill's directory (a bundle) or flat file. The same `skills/read-only` boundary applies. It is not named `remove`: the browser's Remote namespace service owns `remove(kind, method, token)` for its own method ledger, and a Remote method of that name fails every namespace mount in the client at once.

`external()` scans the known skills roots of other agents (`~/.claude/skills` for Claude Code, `~/.codex/skills` for Codex) and lists importable skills per existing root; roots that do not exist are omitted. `importExternal(path)` copies one directory bundle (or one Markdown file, which becomes a one-file bundle) into the user skills root, refusing a name collision with `skills/conflict`.

`gallery()` answers the curated open-source catalog (currently obra/superpowers and anthropics/skills entries) with per-entry install state read from the live inventory. `installGallery(id)` downloads the entry's upstream raw SKILL.md, refuses to write anything whose parsed frontmatter name does not match the entry, and installs it into the user skills root — no restart needed, the registry rescan picks it up at once.

`forge({ sessionIds })` reads each stored session through the persistence service (read-only handles, never resuming an agent), renders user/assistant text into per-session transcript files under `$DSH_HOME/skill-forge/forge-<timestamp>/`, and answers the seed prompt plus the `skill-forge` preset the distillation session must be composed from. The Client then opens a fresh session on that preset with the seed as its first prompt: the new agent reads the transcripts, interviews the user (in the user's language, via ask_user), and writes the resulting SKILL.md into the user skills root itself. Transcripts are capped per message (4K characters) and per session (120K characters), with explicit truncation markers.

-----

<a id="model-experience"></a>
## Model Experience

Indirect and immediate: the disable list is the one model-visible effect. A suppressed skill leaves the model-facing catalog at the next registry read, so the next assembled prompt no longer advertises it, and `get` refuses its body. Skills written through this surface enter the same catalog on the rescan every mutation triggers, so a created, imported, or gallery-installed skill is invocable in the next turn. The forge seed is itself a prompt, but it is delivered as the first user message of the session the Client opens — this package never injects text into a running session. Nothing else here is prompt content — the inventory itself is browser state.

#### KV Cache effect

No direct effect; the token sequence changes only through the catalog the prompt section is rebuilt from, exactly as it does when a provider's discovery changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The inventory mounts every preset.** A standing layer is reachable only by resolving the preset's standing key, so a full inventory composes each preset once. A preset that fails to resolve is skipped with a warning, so the page stays usable but under-reports that layer.
- **The disable list is process-wide and layer-independent**, matching the registry's filter: a name suppressed here stays hidden in every scope that would otherwise win it, including a scope whose provider contributed a different skill of the same name.
- **A disabled name that discovery no longer returns disappears from the page.** The disable list keeps the entry, but nothing can render a row for a skill no provider offers any more; re-enabling it is only possible once some layer discovers the name again.
- **Only the user skills roots are writable through the wire.** Skills from bundled, project, or custom roots render read-only; their owning files are edited at the source. A flat `<name>.md` skill is edited in place, while an imported flat file is reshaped into a one-file bundle — the asymmetry preserves each skill's discovered layout.
- **The external-root scan knows Claude Code and Codex only.** Other agents' roots import through the page's custom-path field.
- **Gallery installs need network access** to the upstream raw URL at click time; a fetch failure is reported as `skills/io` and writes nothing.
- **The forge does not select sessions' content by relevance.** It extracts the complete user/assistant text (capped) of every picked session; distillation quality is the forge session's own job, guided by its interview of the user.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings namespace owns storage and change notification, and the skill registry owns its own disabled set; this package only wires the two established seams together and projects them onto the wire.
