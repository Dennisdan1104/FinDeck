---
description: "The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload, used in place or installed under the Harness home."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-workspace-dependencies

English | [中文](README.zh.md)

## Summary

Deployments that ship their own script runtimes (a packaged runtime payload, or a container image layer) mount this tool so the agent can ask where the bundled Python, Node.js, and pnpm live instead of discovering a system interpreter. The tool returns absolute paths and recorded distribution versions; it changes neither `PATH` nor package-manager settings. The payload is either copied under the Harness home on first use (the upstream Desktop behavior) or used where it lies (read-only carriers).

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

Mount the plugin beside the tool registry with the payload directory. Configuration validation requires a nonempty `source` and rejects empty `root` values before activation; both paths must be absolute. The bundled Office skills (`@deepseek-ai/dsh-skill-office`) reference this tool by name for their default interpreter.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-tool-workspace-dependencies'
  config:
    source: /path/to/primary-runtime
```

| Field | Default | Meaning |
|---|---|---|
| `source` | required | Absolute payload directory carrying `runtime.json` and `dependencies/`. |
| `root` | unset | Absolute installation directory under the Harness home. Set: the payload is copied there on the first call and reused while `runtime.json` is unchanged. Unset: the payload is validated and used in place; nothing is copied. |

### Payload layout

`runtime.json` records `desktopVersion`, `platform` (`win32`, `darwin`, or `linux`), `arch`, optional `payloadDigest`, top-level `python`, optional `node`/`pnpm` versions, and the complete `pythonPackages` distribution-version map. A pnpm entry requires Node.js. Python libraries, including numpy and pandas, appear only in `pythonPackages`. Entries live under `dependencies/`: `python/bin/python3` (`python/python.exe` on Windows) with `site-packages` beneath it, and, when declared, `node/bin/node` with `node/node_modules` and `pnpm/bin/pnpm.mjs`. A manifest whose platform or architecture differs from the running process is rejected.

### Build a payload

This fork ships no payload builder: there is no `prepare:primary-runtime` script, no `DSH_PRIMARY_RUNTIME` override, and no Desktop installation step, so `source` must point at a directory the deployment assembles itself. Two payloads satisfy the layout above.

- A complete CPython installation unpacked to `dependencies/python`, so `python.exe` (Windows) or `bin/python3` (POSIX) sits at the payload root with `Lib/site-packages` beneath it. Install `openpyxl`, `python-pptx`, `python-docx`, `pandas`, `Pillow`, `lxml`, and `XlsxWriter` into that installation, then write `runtime.json`.
- A relocated virtual environment on Windows. Create the environment at `dependencies/python` with `python -m venv`, copy `Scripts/python.exe` and `Scripts/pythonw.exe` to `dependencies/python/`, move `pyvenv.cfg` up to `dependencies/`, and junction `dependencies/Lib` and `dependencies/python/Lib` to the environment's `Lib`. The interpreter then reports `sys.prefix` as `dependencies/` and imports from `dependencies/Lib/site-packages`, while the tool reports `dependencies/python/Lib/site-packages`, the same directory through the second junction. The `home` entry in `pyvenv.cfg` keeps pointing at the base interpreter, which must stay in place.

A hand-written `runtime.json` records `desktopVersion` (any nonempty string), `platform`, `arch`, the Python version, and the `pythonPackages` map of installed distribution names to versions; omit `node` and `pnpm` when the payload carries neither. Mount the plugin beside the skill packages, and set `root` only when the payload should be copied under the Harness home instead of being read where it lies — the copy is refused when `root` or `root.previous` is a filesystem link.

```yaml
- name: '@deepseek-ai/dsh-tool-workspace-dependencies'
  config:
    source: C:\dsh-primary-runtime
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`readPrimaryRuntime` and build smoke checks share `parsePrimaryRuntime`. It validates the flat manifest and rejects duplicate normalized distribution names. Legacy `components` metadata is normalized in memory, retaining its consistency checks; a missing legacy distribution map becomes empty. Mixed flat and legacy version fields are rejected. Reads do not rewrite metadata, and equivalent normalized manifests can reuse an installed payload. `workspaceDependencyPaths` derives the platform-specific entries. `installPrimaryRuntime` copies into a staging directory, requires declared interpreters and scripts to be files and package roots to be directories, and swaps it into place while retaining the previous tree on failure; `resolvePrimaryRuntime` verifies the same entries without copying. The tool memoizes the first successful preparation for the plugin's lifetime.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Manifest validation, path derivation, in-place and installed preparation, tool registration. |
| — | No runtime invariant companion is published: the payload manifest is validated on every preparation, and the tool registry owns registration lifecycle. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Office skills](../skill-office/README.md) — the workflows that call this tool for their interpreter.
- [Tool registry](../../core/tools/README.md) — registration and schemas.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated `load_workspace_dependencies` schema once `pnpm run gen-tool-catalog` records it in [`docs/tool-catalog.md`](../../../docs/tool-catalog.md).

#### Token effect

Fixed schema cost per request where the tool is visible; the description names the bundled Office libraries so the model can choose the interpreter without loading a skill first.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged.

### Tool result

#### What the model sees

One JSON object with absolute `python` and `pythonPackages` paths, `pythonDistributions` from `runtime.json`, and `node`, `nodePackages`, and `pnpm` when the payload declares them. Repeated calls return the same object.

#### Token effect

A few hundred characters per call; paths dominate.

#### KV Cache effect

Append-only tool result in the turn history; no prompt section is added.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This fork ships neither a payload nor a builder, and no profile mounts this plugin by default. Mounted without a payload, the first call fails and the Office skills fall back to an already configured environment, as their text directs.
- The tool derives interpreter paths from the payload manifest alone: it cannot point at an existing environment in its own layout, such as `<venv>/Scripts/python.exe`, so reusing a virtual environment requires the relocation above.
- Linux targets require glibc; musl payloads are not locked.
- Windows payloads used in place must already be executable from their carrier; the in-place mode performs no permission repair.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The fork carries this package unmodified from upstream 0.1.7-rc.2 apart from packaging metadata and this README. Upstream's placement and carrier choices are recorded in its shared-runtime Agent Note, which this fork does not carry.

</details>
