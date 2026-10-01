# AGENTS.md

FinDeck is a fork of DeepSeek Harness: an all-plugin Cordis agent harness with a finance layer (`finance/`) on top of it. Read [docs/architecture.md](docs/architecture.md) before changing `packages/`; follow [docs/AGENTS.md](docs/AGENTS.md) for documentation.

## This fork has no gates

Upstream's gate infrastructure was removed from this fork: no CI workflows, no git hooks, no coverage or lint gate, no doc-sync, no recorded-session snapshot suites, no spec suite, no pre-push checks. Nothing blocks a commit and nothing turns red on its own.

Do not reintroduce one — no gate script, no hook, no snapshot expectation, no "verify"/"check"/"lint"/"test" npm script, no hook installer — unless the user explicitly asks for it in that turn. A change is correct because it was exercised (built, launched, run against real input) and the user accepted it, not because a checker passed.

Deleted machinery is recoverable from this repository's own history, not by copying upstream (this fork has diverged from upstream substantially; restored files would not match the local edits):

```sh
git log --diff-filter=D --name-only -- scripts/ | head -50
git checkout <commit>^ -- scripts/run-gates.ts
```

## Pre-stable APIs and released Session data

Public APIs are pre-stable; update every consumer. Released Session JSONL follows [adjacent migration](.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md): body reads may add a version-named successor but never move, overwrite, or delete committed generations; predecessors imply neither fallback nor downgrade support. SQLite domains use monotonic `SCHEMA_VERSION`.

**Application launch.** Only `dsh` profiles launch supported Node apps; package bins, demos, and public SDK argv escapes are forbidden ([rule](docs/architecture.md#application-launch)).

## Repository layout

```
vendor/      Vendored Cordis source — pinned copies; manifest + sync procedure in vendor/README.md
packages/    @deepseek-ai/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and Typert RPC gateway
  typert/      type graph generator, loader, and runtime registry
  llm/         LLM capability: Service Definition/Consumer + DeepSeek providers
  shell/       bash capability: Service Definition + local/pwsh providers + shell Consumers
  subprocess/  subprocess capability + local process-tree provider + shared Win32 library
  terminal/         persistent sessions
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compaction/     compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable dsh --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  webhook/     webhook ingress
  todo/        todo_write tool
  plan/        plan mode as logged state
  preset/      per-session agent composition from preset cordis.yml files
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  identity/    anonymous identity
  settings/    user-settings capability + file provider
  credentials/ credential/authorization capabilities + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared profile/application boot glue
  sdk/         JSON-RPC protocol + TypeScript client/server
  experimental/ private prototypes excluded from official releases
  support/     dev infrastructure
  util/        zero-dependency utilities
python/      Python SDK and bundled runtime (see python/README.md)
native/      @deepseek-ai/node-addon-system source of record (see native/README.md)
.agents/     Agent Notes (`notes/`) — historical design records
docs/        architecture, generated catalogs, postmortems, cookbook
scripts/     build, catalog generators, release tooling
website/     VitePress projection of selected bilingual docs/ sources
```

Package groups: [packages/README.md](packages/README.md).

## Commands

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run build          # tsc emits lib/types, tsdown bundles runtime, vite builds the web shell
pnpm run dev            # launch the web app from built output
pnpm run dev:src        # launch the web app from source (tsx)
pnpm run clean          # remove build outputs and safe residue from deleted packages
pnpm dsh --profile headless "task"  # run one task from source (needs DEEPSEEK_API_KEY)
pnpm run gen-tool-catalog           # regenerate docs/tool-catalog.md (same for the other gen-* scripts)
```

`pnpm run build` is also the only type check: `build:lib:host` runs `tsc -b tsconfig.host.json`, so a type error fails the build. There is no separate lint, test, or doc command.

## Secrets / .env

Real-API runs read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials.

## Conventions

- Every npm package is `@deepseek-ai/dsh-<name>`; vendored packages are rescoped ([mapping](docs/rescope.md)). Every workspace package — `packages/`, `apps/`, and `vendor/` — carries `private: true` and is unpublished. `@deepseek-ai/cordis` is a peerDependency (+ dev) of every harness package.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM ([source-launch contract](.agents/notes/implemented/architecture/2026-07-29-dsh-source-launch-tsx-esm.md)).
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Typed events use declaration merging** and merge-extensible maps. `SessionEventMap` members are required-on-read by default — builds that do not know a type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION` ([mechanism](.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)).
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Workspace imports resolve through tsconfig `paths` to `src`.
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- **Keep comments local.** Do not restate code, explain distant behavior unless locally required, or expand unrelated comments.
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- Client UI copy is locale-owned: route product text through typed dictionaries and `t` or localized primitive props; do not hardcode display copy ([decision](.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale.

Docs accompany every code change: update affected README and JSDoc contracts together. Current-state prose, one physical line per paragraph, one home per fact.

## Agent Notes

`.agents/notes/` keeps design records from earlier work; read them when they explain a decision you are about to touch. Write one only for durable decision rationale: the concrete mistake a future maintainer could plausibly make, and the non-obvious constraint or real trade-off that code and existing documentation do not explain. Behavior changes, user visibility, file count, and added tests alone do not qualify — put ordinary change rationale in the commit message. Nothing enforces their format or requires new ones, and mechanical or local edits (including local UI presentation) are exempt.

## Editing these instructions

`CLAUDE.md` symlinks `AGENTS.md` at root and `packages/`; edit the real file. Keep each rule self-contained while linking high-level docs.

## Vendoring policy

`vendor/` packages are pinned source copies (manifest with upstream SHAs in [vendor/README.md](vendor/README.md)). Update via the sync procedure there; re-apply or retire the logged local modifications; then `pnpm run build` and exercise the affected path.
