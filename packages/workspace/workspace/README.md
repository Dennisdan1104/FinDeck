---
description: "Workspace entity registry (ctx.workspaceRegistry) for hosts choosing, mounting, or debugging durable workspace records and header-validated session membership."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace

English | [中文](README.zh.md)

## Summary

`dsh-workspace` gives a host a persistent set of workspaces: named user directories, each with the sessions that ran in it, kept in a stable order across restarts. With it, a UI can show a sidebar of projects, attach sessions to the right project, hide a session from the grouping without losing it, and remove a project — removal never deletes the folder or the session histories, which become ungrouped. Use it in GUI or host compositions that need durable project grouping; headless and minimal runs can omit it entirely. The package is host-side only: the model, tools, and agent loop never see it, so it adds no tokens, prompts, or request context. It needs a session store and a persistence backend mounted alongside it; setup is a few composition rows.

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

Use this package to give the product a project list: named directories the user works in, the sessions that ran in each, a stable order, and a way to hide sessions without losing them. The API contracts behind each action live in the implementation section.

### When to use it

Use it when the product shows a persistent workspace surface — a sidebar, session grouping, or automation that names directories and orders them. It is invisible to the model, so it adds no token or request cost. Skip it when there is no grouping surface; nothing else in the harness needs it.

### Setting up

The package takes no configuration of its own; it needs a session store, a session persistence backend, and the storage rows that keep its records. A minimal composition:

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-workspace'
```

With these rows mounted, creating a project shows up in the list immediately and survives a restart; the first start also groups existing sessions by the directory they ran in. If a required peer is missing, the workspace feature stays unavailable until it is mounted.

### Creating and ordering projects

Create a project from any fully qualified directory that exists: filesystem roots such as `C:\` and ordinary directories are valid. Relative paths, Windows drive-relative paths such as `C:work`, missing paths, and files are rejected without creating a project; creating a project for a directory that already has one returns the existing project unchanged. Rename a project at any time, and move it to any position in the list:

```text
// Host consumer code, after the composition above is loaded:
const project = await ctx.workspaceRegistry.create('/path/to/dir', 'My Project')
await project.setTitle('Renamed')
ctx.workspaceRegistry.list() // shows the project, newest first
```

`createProject({ name })` is the one-call route a surface uses to add a project: it derives a fresh `<home>/projects/<uuid>/` working directory, creates it, registers the record under the trimmed name as its title, and materializes the project directory tree before it resolves. A caller that already has a working directory passes `path`, and that directory is created when absent before being adopted:

```text
// Host consumer code:
const created = await ctx.workspaceRegistry.createProject({ name: 'HS300 research' })
created.path // '<home>/projects/<uuid>'
const notes = await ctx.workspaceRegistry.createProject({ name: 'Notes', path: 'D:/work/notes' })
notes.path // 'D:/work/notes', canonicalized
```

A blank name rejects with `WorkspaceProjectNameInvalidError`; a working directory that is not fully qualified, that cannot be created, or whose tree fails to materialize rejects with `WorkspaceProjectDirInvalidError`. Titles are not unique: two projects may carry the same name, and adopting a directory another project already owns returns that project unchanged.

### Project directories

Each workspace also owns a project directory: the root for the project-scoped resources the product keeps beside it — memory, presets, and automations. The default is derived rather than stored: `<home>/projects/<workspace-id>`, where `<home>` is the harness home (`$FINDECK_HOME`, else `$DSH_HOME`, else `~/.findeck`). Point a workspace elsewhere with a custom absolute path, and clear that override to return to the default; the default is never written into the record. A project created without an explicit `path` works in `<home>/projects/<uuid>/`, so its working directory and its project directory are siblings under the same projects root while the project directory keeps the record-id spelling.

Nothing is created until a caller asks. `ensureProjectDir(id)` resolves the directory, creates it together with its `memory/`, `presets/`, and `automations/` subdirectories, and reports the resolved path plus whether each subdirectory exists. Existing directories are left untouched, so the call is safe to repeat.

```text
// Host consumer code:
const state = await ctx.workspaceRegistry.ensureProjectDir(project.id)
state.projectDir     // absolute resolved path: the custom directory or '<home>/projects/<id>'
state.subdirectories // { memory: true, presets: true, automations: true }
await ctx.workspaceRegistry.setProjectDir(project.id, 'D:/projects/my-project')
await ctx.workspaceRegistry.setProjectDir(project.id) // clears the override
```

A custom path must be fully qualified, and its tree must be creatable: an unqualified path, or a directory that cannot be created, rejects with `WorkspaceProjectDirInvalidError` and leaves the record untouched. The three subdirectory spellings are exported as `projectMemoryDir`, `projectPresetsDir`, and `projectAutomationsDir` for the packages that keep their own resources there.

A caller that knows only its working directory resolves the same layer with `projectPresetsDirForPath(cwd)`: it answers the `presets/` directory of the workspace whose registered path contains that directory — the deepest match wins when workspaces nest, a path no workspace contains answers `undefined`, and nothing is created or written. That is how a project-scoped resource finds its project without naming a workspace id, and it is what keeps one project's presets out of another's reach.

The project model is this workspace entity evolving rather than a second entity beside it (P9 revision record R16).

### Grouping sessions under a project

A session joins the project of the directory it runs in: create a session in a project's directory and it appears under that project, newest first. A session can only belong to one project. A session whose directory cannot be validated — no recorded directory, or a moved or deleted folder — cannot join and stays ungrouped.

### Hiding sessions and removing projects

Hide a session from the grouping when it should stop appearing there: it disappears from the visible list, while its session, history, and place in the project stay intact. Remove a project when it is no longer needed: it leaves the list, and its folder, files, and session histories are never touched — those sessions become ungrouped. Adding the same directory again afterwards starts a fresh project without the old sessions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the feature and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One record per canonical path.** `fs.realpath` is the single uniqueness canon: paths are stored canonicalized, so a symlink to an owned directory collides, and uniqueness is string equality of canonical paths.
- **Membership is ownership plus a live cwd fact.** The record's ordered `sessionIds` is the ownership truth; the startup header index validates it, and `sessionIds` filters on read while the next mutation prunes durably.
- **Header-only reads.** Bootstrap and attach validation read `SessionHeader` fields only; event bodies are never loaded.
- **Two-write mutations with an explicit marker.** Create and delete persist a `pendingMutation` marker before the record/order pair can diverge, so startup completes exactly the interrupted operation and unmarked divergence fails loud as corruption.
- **Serialized writes.** Registry operations run on one operation chain; entity mutations go through `table.update` on the domain write chain, stamping `updatedAt` and deciding membership at their chain slot.

### API behavior

The API is one small family with two owners: `WorkspaceRegistry` creates, orders, and deletes projects and manages their session accounting; the `Workspace` entity exposes the display title, directory status, and the session projection. Per-method contracts live in the code, not this README — see [src/index.ts](src/index.ts) and [src/entity.ts](src/entity.ts).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `WorkspaceRegistry` service, header index, bootstrap, operation serialization |
| [`src/entity.ts`](src/entity.ts) | Package-private `Workspace` implementation and its single `mutate` write path |
| [`src/spec.ts`](src/spec.ts) | Domain declaration: record schema, registry state, `defineDomain` spec |
| [`src/types.ts`](src/types.ts) | Public `Workspace` interface and `WorkspaceId` brand |
| [`src/project-dir.ts`](src/project-dir.ts) | Project-directory resolution, materialization, and its three managed subdirectories |
| [`src/paths.ts`](src/paths.ts) | The `realpath` uniqueness canon and the canonical-path containment predicate |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: the entity cache mirrors the durable table |

### Durable shape

The registry opens the `workspace` domain (version 2): a `workspaces` table keyed by `WorkspaceId` plus one global state holding `workspaceIds` (the authoritative display order), `archivedSessionIds`, `archivedAt`, and the optional `pendingMutation` marker. `archivedAt` is the archive set's retention clock — session id to the instant that id was archived — and the startup sweep discards an archived session whose clock ran past `archiveRetentionDays` (30 by default), deleting its stored log, its membership slot, and its archive entry together; a session this process holds open, a log a newer build owns, and a failed removal all keep their entry for the next boot. An archived id the clock does not name — one archived before the clock existed — starts its window at the first boot that reads it rather than expiring on upgrade. Records written before `archivedSessionIds` or `archivedAt` existed parse with the empty default through the schema, and records written before `projectDir` existed parse with the derived default, which is stored in the record only when a user overrides it. Every field added since the version stamp is optional, so the version stays 2: the default `single` medium layout rejects any other stored version and the domain layer has no migration path, so an optional field must never bump it.

### Lifecycle

On start, the registry opens the domain, completes a marked mutation if one is pending, validates stored state — duplicate paths, duplicate session accounts, and order drift all fail loud — and, when not yet initialized, bootstraps history from persisted headers before writing the initialized marker last, so an interrupted bootstrap resumes safely. A fresh empty registry is real once initialized; it never re-bootstraps.

### Failure and recovery

A create or delete whose second write fails rolls the cache and the prior order back; when both the operation and its rollback fail, the durable marker still names the interrupted operation and the next startup completes or rolls it back. A committed delete whose marker cleanup fails still reports success, and the next startup clears the marker idempotently.

### Invariant

The `workspace-invariant` companion registers the owned relationship: every durable `domain/changed` for the `workspaces` table must name a record the entity cache already holds — a delete is valid only after the registry removed the entity from its cache, so a bypassing write path fails the invariant.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this package's view is not enough: the subsystem reference is the authoritative feature contract, and the Agent Notes record why projects start from session history and why removal is non-destructive.

- [Workspace subsystem](../../../docs/subsystems/workspace.md) — the feature contract for projects and their sessions, and the generated API for the workspace service.
- [Workspace package map](../README.md) — the group's single package and its repository position.
- [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) — why project records use the domain data form.
- [Workspace UI product-flow Agent Note](../../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md) — how the first start builds projects from session history and how the GUI orders them.
- [Workspace registration deletion decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md) — why removing a project never deletes its folder or sessions.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace records and session accounts

#### What the model sees

Nothing. `ctx.workspaceRegistry` serves workspace records to host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the project list is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Removal never deletes data** — removing a project leaves its folder, files, and session histories in place; those sessions become ungrouped, and session deletion or folder removal are separate, absent capabilities ([decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)).
- **A session joins only with a recorded directory** — a session belongs to a project only when its record carries a directory that resolves to the project's path; sessions without one stay ungrouped, and a session from another directory cannot be moved in.
- **External changes are seen late** — if another process deletes or damages a directory, the project reflects it only at the next refresh or restart.
- **Archiving expires** — an archive is a durable display filter that keeps the session's history and its place, and the one way it ends is deletion: after the retention window a boot discards the log, or the operator restores the session from the archive group first.
- **Re-adding a directory starts fresh** — after removal, adding the same directory again creates a new project with an empty session list; the old sessions do not come back automatically.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

None.

</details>
