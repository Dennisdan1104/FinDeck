# Development guide

English | [中文](development.zh.md)

The setup tutorial takes a new contributor from prerequisites to a built checkout. The contributor reference that follows covers repository layout and daily workflow. Design rationale and implementation details belong to the linked Agent Notes and scripts.

## Setup tutorial

### Prerequisites

- Node.js supports 22.19+ and 24+; see the [Node engine floor Agent Note](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.md).
- Corepack-enabled pnpm. The repo pins `pnpm@11.7.0` in `package.json`; run `corepack enable` if `pnpm --version` does not resolve through Corepack.
- Git 2.26 or newer.
- Optional: a DeepSeek API key for the Web, headless, and ACP automation demos.

### First-time setup

Install dependencies from the repo root:

```sh
pnpm install
```

`pnpm install` installs dependencies only: it configures no Git hook and no merge driver.

Build once after a fresh clone:

```sh
pnpm run build
```

Setup is complete when the build exits successfully.

## Contributor reference

### TypeScript project layout

The repository uses isolated Host and Client aggregates. An ordinary package is registered in exactly one aggregate: Host packages in `tsconfig.host.json` and Client packages in `tsconfig.client.json`; three packages (`host/webserver`, `compaction/compaction`, `typert/registry`) are referenced by both aggregates as shared leaves so each side type-checks the same source.

| File | Role | Forms a program? |
|---|---|---|
| `tsconfig.json` | Solution root: `extends` base, `files: []`, and references to the two aggregates. It is the tsserver discovery entry and the entry for explicitly running the complete Project Reference graph; through the inherited `paths`, it is also the resolution config for tsx running `scripts/`. | No |
| `tsconfig.host.json` | Host aggregate: Host packages, `scripts/`, `website/`, and the exceptional Host project of `api/remotes`. | Yes |
| `tsconfig.client.json` | Client aggregate: `packages/client/*` packages, `apps/web`, and the exceptional Client project of `api/remotes`. | Yes |
| `tsconfig.base.json` | Shared compilerOptions and the source `paths` map: every extending project resolves workspace imports to `src` through it, and it carries no `include` so those `paths` apply to all of them. | No |
| `tsconfig.base.client.json` | Browser compiler settings (`jsx`, DOM libs, `types: []`) extended by the Client aggregate and every `packages/client/*` package. | No |

Host and Client stay two aggregate programs because both sides declaration-merge the cordis `Context` interface under the same keys with different services; one program seeing both merges reports a collision. The collision exists only inside a `ts.Program` — module resolution never triggers it — which is why the solution may reference both aggregates and one paths facade may span both sides. Three disciplines follow:

- `tsconfig.base.json` never gains `include` or `files`: they would leak into every extending package project and narrow the facade's match-all scope.
- A script that builds a repo-wide `ts.Program` seeds `tsconfig.host.json` or `tsconfig.client.json` explicitly — never the root solution, because flattening both aggregates into one program collides the `Context` merges.
- A new package is registered in exactly one aggregate; only the split packages above carry both leaf configs, and the shared leaves are registered in both aggregates because each side must type-check the same source. Having both a Node loader entry and a browser entry is not a reason to split a package; an ordinary Client plugin produces both runtime artifacts during the Client build phase.

Six packages split Host and Client tsconfigs: `api/remotes`, `api/gateway`, `api/session-controller`, `api/workspace-controller`, `client/connection`, and `session-query/session-log-export`. `api/remotes`' Host entry participates in the Host Typert graph while its Client entry imports generated `/remote` declarations; `session-log-export` keeps Node archive production out of its browser controller. Each split package-root `tsconfig.json` is therefore only a solution, and the two aggregates and direct consumers reference `tsconfig.host.json` or `tsconfig.client.json` respectively. A referencing project names its target's matching face: a single-config target is valid from either face, while a split target must be referenced through its matching leaf rather than through its solution root or the opposite leaf. Both leaf configs present is what marks a package as split. The [`api-remotes` README](../packages/api/remotes/README.md) and [`session-log-export` README](../packages/session-query/session-log-export/README.md) explain their splits.

The root build follows the generated dependency order:

```sh
tsc -b tsconfig.host.json
tsdown --env.DSH_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
```

Both tsdown passes use the same complete workspace match. They neither scan build artifacts to discover Client packages nor maintain a Host/Client package filter list. Package-local tsdown configs select entries for the current phase through `DSH_BUILD_FACE`: an ordinary Client plugin produces both its Node loader and browser bundle during the Client phase; `api-remotes` uses `hostPhase: true` to produce its Host entry early and only its browser bundle during the Client phase. Tsdown consumes only the JavaScript emitted to `lib/types` by the preceding tsc phase.

Typert runs only during Host tsdown, seeded by `tsconfig.host.json`. It analyzes Host types and generates both Host reflection artifacts and the Host-for-Client Remote projection; Client tsdown does not start Typert. Consequently, `pnpm run build` completes the whole Host lib phase — tsc plus Host tsdown, and therefore Typert — before Client tsc, then continues through Client tsdown and the Web build. The [API Remotes generated-contract build note](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.md) records this ordering decision.

`pnpm run build` embeds the root package version, the seven-character source commit, and a dirty marker when Git reports local changes; it also inherits other caller-supplied `DSH_CLIENT_*` values. `pnpm run build:official` is the cross-platform local equivalent of the release artifact build and omits the local dirty marker. Each successful complete build writes a gitignored record that binds the exact public values to the Vite output and dynamic client bundles; release packing rejects a missing record or artifacts changed by a later partial build. `pnpm run dev:web` still requires the artifact tree from a prior complete build, but it samples the current version and Git state once at startup and shares that environment across every watcher stage for the session; it does not validate the complete-build record because the watcher stages rewrite its recorded artifacts.

Workspace imports resolve to `src` through the base `paths` map in every program that type-checks this repository, including `tsc -b` itself; built `lib/` output is consumed only where a command explicitly depends on the build. Generated Host-for-Client Remote declarations are the one ordering constraint: they come out of the Host tsdown pass, so anything that needs them must run the Host lib phase first. See the [solution-root note](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.md) for the two-aggregate setup, the [ts-build-config note](../.agents/notes/implemented/process/2026-06-17-ts-build-config.md) for tsc-first emit ownership, and the [Typert Remote note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) for the generation order.

Business services declare callable methods on the Host with `@Remote` or `@RemoteScope`; the Host build generates Host-for-Client types and runtime contributions, and the Client's `api-remotes` composition loads those contributions under `ctx.remote` and scoped `agentCtx.remote` namespaces. See [API Gateway](api-gateway.md) for the generated artifacts on both sides, their assembly relationships, the SRC development fallback, and the Web build order.

`pnpm run build` produces the runnable artifact tree: tsc emits declarations and intermediate JavaScript under `lib/`, tsdown bundles the runtime, and `build:web` produces the browser bundle. A fresh worktree has none of it until the build runs. Nothing validates package entrypoints or built declarations, so a package's `exports` field is confirmed by building and then launching the artifact.

### Environment variables

The real DeepSeek adapter and key-backed agent demos read credentials from the environment or from a gitignored `.env` at the repo root:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` is optional and defaults to the public API. Never commit real credentials.

### Git integrations

This fork installs no Git hook and no merge driver: `pnpm install` writes nothing under `.git`, `core.hooksPath` stays unset, and committing, merging, and pushing run plain Git. Markdown link resolution and translation pairing are conventions a reviewer confirms, not checks a machine runs. The root [AGENTS.md](../AGENTS.md) carries the standing order against adding a hook, a hook installer, or a pre-push check.

The vendor manifest in [`vendor/README.md`](../vendor/README.md) is hand-maintained: when you change `vendor/*/src`, update the matching manifest entry in the same commit.

### Daily commands

The root [contributor instructions](../AGENTS.md#commands) summarize common commands, and [`package.json`](../package.json) owns the script inventory. `pnpm run build` is the only type check, so run it before calling a change done, then exercise the affected path against real input as [verification](testing.md) describes. A package-public behavior change also updates the owning README or JSDoc.

### Profile runs

Run the repository build separately before using these source-checkout demos:

```sh
pnpm run build
```

The one-shot Headless coding agent needs `DEEPSEEK_API_KEY` in the environment or repo-root `.env`:

```sh
pnpm dsh --profile headless "summarize this workspace"
```

The PTC mode demo runs the same headless profile with code presentation enabled:

```sh
pnpm run demo:ptc -- "summarize this workspace"
```

### TODO markers

Use one of three comment tags to flag known issues in the code, ordered by urgency:

- `FIXME` — an issue that should block a new release. A release should not ship with an open `FIXME` unless reviewers explicitly agree the change can be merged anyway.
- `TODO` — an issue that should be fixed soon, once we have the resources.
- `XXX` — an issue that we may fix someday; lowest priority, no commitment.

Pick the tag that matches the urgency so anyone scanning the code can tell a release blocker from a someday-maybe.

### Documenting types verbatim (`ts type-equiv`)

The [subsystems](subsystems/README.md) pages paste source-equivalent declarations together with their original JSDoc so a reader sees the exact type definition and source contract. Fence such a paste as ` ```ts type-equiv ` (instead of ` ```ts `) to mark it as a source-equivalent block rather than independently authored example code; for a class whose implementation bodies do not belong in the catalog, use ` ```ts public-api `, which keeps the public fields, constructor, accessors, and methods with their original JSDoc while omitting bodies and private or protected members. A paired `.zh.md` block keeps the same fence kind and a byte-identical body as its unsuffixed sibling.

Nothing extracts the symbol or compares the block against source, so keeping a paste in step is manual: when you change a documented declaration or its JSDoc, update every paste of it in the same change.
