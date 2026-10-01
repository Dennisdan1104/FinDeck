---
description: "Shared resolution of the DeepSeek Harness home and user-data paths for packages that need one consistent root, tilde expansion, and stable watch paths."
kind: "package-library"
---

# @deepseek-ai/dsh-home-paths

English | [中文](README.zh.md)

## Summary

`dsh-home-paths` resolves the single DeepSeek Harness home that all user data lives under, and joins child paths onto it, so every product package agrees on where its files go. Precedence is explicit: a configured path wins, then `$FINDECK_HOME` (or its pre-rename alias `$ALPHADECK_HOME`), then `$DSH_HOME`, then `~/.findeck`; an empty or whitespace-only value counts as unset. Resolving the default also performs the one-time `~/.alphadeck` to `~/.findeck` rename. The package also expands `~`, `~/...`, and `~\...` prefixes against the operating-system home, and canonicalizes a watch target so a native filesystem watcher gets one stable path spelling even when the final components do not exist yet. It is a zero-dependency library that product packages import directly; a `cordis.yml` cannot load it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use these helpers wherever a package must agree with the rest of the harness about where user data lives: resolve the home once, then derive every child path from it.

### Resolving the home

```ts
import { resolveDshHome, dshHomePath } from '@deepseek-ai/dsh-home-paths'

const home = resolveDshHome()                // configured path, else $FINDECK_HOME, else $DSH_HOME, else ~/.findeck
const settings = dshHomePath('settings')     // join one child onto the resolved home
```

An explicit configured path has the highest precedence, then `$FINDECK_HOME`, then its pre-rename alias `$ALPHADECK_HOME`, then `$DSH_HOME`, then the default `~/.findeck`. An empty or whitespace-only value is treated as unset, so a blank override never resolves the home to the current working directory. A `$DSH_HOME` naming the stock harness home (`~/.dsh`) is refused with one diagnostic per process, because a stock DeepSeek Harness exports that value into every shell it starts; set `FINDECK_HOME` to choose that directory deliberately.

### Migrating a pre-rename home

The default root was renamed with the product. The first `resolveDshHome` that falls through to the default renames `~/.alphadeck` to `~/.findeck` with `fs.rename` when the new directory does not exist yet, so an install upgraded in place keeps its sessions, settings, credentials, and roundtable archives instead of starting against an empty root. Only the default moves: `FINDECK_HOME`, `ALPHADECK_HOME`, and `DSH_HOME` each name a directory the deployment owns. An older build started after the migration resolves `~/.alphadeck` again and creates a fresh empty root there, so a downgrade starts empty rather than reading a half-migrated tree.

### Displaying a home

For user-facing paths, render the root symbolically rather than as a machine path: the default home displays as `~/.findeck`, a home selected by `$FINDECK_HOME` or `$ALPHADECK_HOME` displays as that variable, and any other configured home displays as `$DSH_HOME`. The display form never leaks an absolute machine path.

### Expanding user paths

`expandHomePath` expands a leading `~`, `~/`, or `~\` against the operating-system home and leaves everything else untouched — non-tilde paths and named-user forms such as `~alice/...` pass through unchanged.

### Canonicalizing watch paths

`canonicalizeWatchPath` gives a native filesystem watcher one canonical spelling of its target: the deepest existing ancestor is resolved through `realpath` and any missing suffix is restored, so a file or directory can be watched before it is created. This prevents Windows from treating a regular-file ancestor as ordinary absence, and prevents 8.3 short-name aliases from mixing with the long paths the native watcher backend emits.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is built on one principle: all harness user data lives under one root, and every other helper derives from that decision.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Home resolution, path joining, display, tilde expansion, and watch-path canonicalization |
| — | No runtime invariant companion is published; this pure utility owns no event stream or mutable runtime data; its value algebra is enforced by unit tests. |

### Resolution rules

`resolveDshHome` reads the explicit override, then `$FINDECK_HOME`, then its alias `$ALPHADECK_HOME`, then `$DSH_HOME`, then falls back to the operating-system home joined with `.findeck` — migrating a pre-rename `.alphadeck` directory into that default first. The chosen value is tilde-expanded and normalized to an absolute path; `dshHomePath` joins child segments with Node's platform path rules. `dshHomeDisplay` compares the resolved path against the default root and returns the symbolic label, so a configured home never leaks its absolute path.

### Canonicalization mechanics

`canonicalizeWatchPath` walks up from the target until it finds an existing ancestor, resolves it with `realpath`, proves it is an enumerable directory, and restores the missing suffix. Errors other than absence propagate, and a missing-suffix ancestor that is not a directory is rejected.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you need the launcher or the consumers that depend on a single home root.

- [Boot package](../../boot/app-boot/README.md) — the launcher that resolves the home before any plugin mounts.
- [Shell environment](../../shell/shell-env/README.md) — how `DSH_HOME` reaches model shell calls.
- [Anonymous user id](../../identity/anonymous-user-id/README.md) — a stored identity file under the resolved home.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the helpers are not the right tool. They are current package constraints, not a task backlog.

- **Expansion is deliberately narrow** — only bare `~`, `~/...`, and `~\...` use the current operating-system home; named-user forms such as `~alice/...`, environment variables, and shell expressions remain unchanged.
- **Canonicalization reads but never mutates** — `canonicalizeWatchPath` performs `realpath` probes and propagates errors other than absence; callers still own directory creation, permissions, and trust policy for the resulting path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
