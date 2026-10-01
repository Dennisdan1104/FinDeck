---
description: "The FinDeck project management page: one settings section over the workspace Remote — every project with its working directory, project directory, managed subdirectories, and the layer-marked preset roster its working directory resolves."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-projects

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-projects` is the project management page: one `settings.section` row (`projects`) over the generated `workspace` and `agentPresets` Remote namespaces. It lists every Host Workspace — the Project entity — with its working directory, its resolved project directory, whether that directory is a user override, the state of the three managed subdirectories (`memory/`, `presets/`, `automations/`), and the project-layer preset roster its working directory resolves. From the page the operator renames a project, repoints its project directory, resets it to the derived default, creates a project from an existing directory, and inspects that project's preset layer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the row in a web profile after the API Remotes it reads and the ui-workspace plugin, whose root contribution publishes the `useWorkspaces` selector hook this page reads. It requires `ctx.slots`, `ctx.locale`, and the mounted `workspace`, `agentPresets`, and `directoryPicker` Remote faces.

### Mount and configure

```yaml
- name: '@deepseek-ai/dsh-client-ui-projects'
```

No configuration. The section id is `projects`, ordered after Schedule in the settings navigation.

### What the page shows

- **One card per project** — the title, a `Default project` badge for the built-in default, a `Custom directory` badge when `projectDirCustom` is true, the session count, the working directory, and the project directory (both truncated with the full path in a `title` attribute).
- **Managed subdirectories** — `memory`, `presets`, and `automations`, each marked present or missing from the `ensureProject` answer for that project. A failed read shows `read failed` rather than a wrong verdict.
- **Actions** — Rename (the `rename` Remote), Change directory (`setProjectDir`), Reset to default (`resetProjectDir`), and Project presets, which expands the roster below the card.
- **Preset layer** — on demand, `rosterFor({ cwd })` for that project's working directory: each preset's display name, id, trust, default marker, broken reason, and a `project` badge on rows the project layer supplied.

### Directory picking

**Browse…** in the repoint and create dialogs issues the same `directoryPicker.pick` Remote call the ui-workspace plugin's own picking flow makes. A composed backend without the native capability rejects with `directory-picker/unavailable`, and the dialog keeps its typed path field as the fallback, so the page remains usable on hosts where the picker is unavailable.

### Observable success and failures

A create or repoint adopts the directory through the Host and re-reads every project directory afterwards; a failure (for example a name conflict on rename, or `workspace/invalid-project-dir`) renders in the dialog. A reset failure renders inline above the cards.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`ProjectsPage` holds three pieces of viewing state — the per-project directory read, the per-project preset roster, and the open dialog — over the framework's `useWorkspaces` selector hook. It owns no business state: the Host Workspace snapshot is the project list, and every mutation goes through an injected adapter that resolves the Remote answer or throws the Host's own failure.

`src/client/index.ts` registers the `ui.projects` dictionary and the `projects` section row, and adapts the five `workspace` verbs, `directoryPicker.pick`, and `agentPresets.rosterFor` into the plain callbacks the page receives.

### Source map

- `src/client/index.ts` — dictionary registration, the `projects` section row, and the Remote adapters.
- `src/client/ProjectsPage.tsx` — the page: card list, subdirectory state, preset expander, and the rename/repoint/create dialogs.
- `src/client/locales.ts` — the `ui.projects` dictionary keys.

-----

<a id="model-experience"></a>
## Model Experience

None. The page reads Host project state and calls Host mutations; nothing it does reaches a model request, and it adds no session event.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No delete action** — the page creates, renames, and repoints projects; removing one stays with the sidebar's own project actions.
- **Project membership is read-only here** — sessions are bound to a project through their `cwd` and the `create`/`rename` verbs; this page does not move a session between projects.
- **The preset layer is a read** — the roster lists what the project layer supplies; creating or editing a project preset stays with the agent-preset settings page.
- **Automations are a directory, not a schedule** — the card reports whether `automations/` exists; the cross-session runner behind it is deferred.
- **The preset roster is loaded once per expansion** — collapsing and re-expanding re-reads it, but a roster changed while the card stays open is not refreshed until the next expansion.
