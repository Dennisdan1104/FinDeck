---
description: "Host and Client workspace control: mutate workspace navigation and follow its complete projection."
kind: "package-reference"
---
# Workspace Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-workspace-controller` owns the Host `ctx.workspaceController` service and the generated Client `ctx.remote.workspace` namespace. Its Remote methods create a named project or adopt an existing directory as a Workspace, rename, remove, and reorder Workspaces, reorder Sessions within a Workspace, archive and restore Sessions from Workspace navigation, point a Workspace at its project directory, and follow the complete Workspace projection. Use it through API Gateway when a Client must change or follow Workspace navigation. The package also owns `ctx.directoryPickerController` and the generated `ctx.remote.directoryPicker` namespace, because the directory-picking seam it carries is abstract and never a Loader entry of its own.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Host controller serializes mutations whose correctness depends on current registry state and throws `RemoteError` with a stable `workspace/*` or `directory-picker/*` code for expected failures. Its `follow()` stream synchronously attaches to durable Workspace changes, emits one complete baseline first, then emits ordered `upsert`, `remove`, `order`, and `archived` increments. A reconnect starts another generation with a replacement baseline, so consumers do not depend on receiving every increment while disconnected.

The Client entry provides `ClientWorkspaceModel` and `createWorkspaceStateStream()`. The model owns Workspace rows, registry order, archived Session ids, unary mutation echoes, and stream/unary race resolution. A newer Host row wins by `updatedAt`; a committed stream order outranks an older unary response; a removed Workspace id cannot be resurrected by delayed data. The package exposes framework-neutral snapshots and subscriptions, leaving navigation policy and React hooks to the UI owner.

### Creating a project by name

`createProject({ name })` registers a new project whose working directory the Host derives and creates at `<home>/projects/<uuid>/`; `createProject({ name, path })` adopts the supplied fully qualified directory, creating it when absent. Both take the trimmed name as the project title — duplicate titles are allowed — and materialize the project directory tree before answering, so the returned `WorkspaceView` is ready to use. A blank name fails with `workspace/invalid-project-name`; a working directory that is not fully qualified or cannot be created fails with `workspace/invalid-path` carrying the rejected path.

### Project-directory verbs

Every `WorkspaceView` carries the resolved project directory and whether it is a user override: `projectDir` is the custom path when one is set, otherwise the derived default `<home>/projects/<workspaceId>`, and `projectDirCustom` is true only for the override. The default is never stored, so it is identical across reconnects.

`setProjectDir({ workspaceId, path })` adopts an absolute custom directory, creating it together with its `memory/`, `presets/`, and `automations/` subdirectories, and returns the updated `WorkspaceView`. `resetProjectDir({ workspaceId })` clears the override back to the derived default and creates that tree. `ensureProject({ workspaceId })` materializes whichever directory is in effect and returns `{ projectDir, subdirectories }`, where `subdirectories` reports whether each managed subdirectory exists; it writes nothing, so a consumer that only needs the directory can call it at any time.

A path that is not fully qualified, or a directory whose tree cannot be created, fails with the `workspace/invalid-project-dir` code carrying the Workspace id and the rejected path. The record is left untouched, so a failed repoint never changes where the Workspace already points.

The Client service (`ctx.workspaces`) mirrors both verbs as `setProjectDir(workspaceId, path)` and `resetProjectDir(workspaceId)`, merging the answer into its own snapshot so a surface sees the new directory without re-reading. A rejection arrives as `WorkspaceProjectDirError`, whose `message` is the Host's own and whose `rpcError.code` lets a surface branch on the invalid-directory case.

-----

<a id="model-experience"></a>
## Model Experience

None, as Workspace organization is browser and Host control state and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; Workspace mutations do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `follow()` replaces the whole projection after reconnect and has no durable cursor or incremental catch-up protocol.
- Process-local deletion markers prevent delayed data from reviving a removed Workspace only for the lifetime of the Client model.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Workspace Registry owns persistence; every stream generation is a full projection.
