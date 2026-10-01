# Verification

English | [中文](testing.zh.md)

This fork ships no test suite: no spec or snapshot corpus, no coverage or lint gate, and no `test`, `check`, or `verify` npm script. The root [AGENTS.md](../AGENTS.md) carries the standing order against reintroducing one. A change is correct because it was exercised against real input and accepted, not because a checker went green.

## How a change is verified

Build it, then run the affected path by hand.

```sh
pnpm run build
```

`pnpm run build` is also the only type check: `build:lib:host` runs `tsc -b tsconfig.host.json`, so a type error fails the build. Everything past that is a real run — `pnpm run dev`, `pnpm dsh --profile headless "…"`, or the command that owns the changed behavior — followed by reading the durable result: the session log, the written file, the workspace, the rendered UI. The agent's own summary of what it did is not evidence.

## What counts as evidence

- **Line coverage is not a correctness proof.** It shows lines ran, never that the feature behaves as shipped. Delete unexercised code rather than adding a caller that only touches it.
- **Verify the world, not the self-report.** Re-read the file or re-run the command from outside; a keyword probe on the agent's own output lets a cheating agent pass.
- **Exercise the real entry path.** Boot through `dsh` and the shipping composition rather than a hand-mounted `ctx.plugin(...)`, and exercise the published artifact — `lib/*.js` under plain `node` — because that is where tsx-masked failures (settle races, module resolution, swallowed load failures) surface.
- **Mock only the expensive or nondeterministic boundary** — LLM adapter, network, clock — and keep everything downstream real. A hand-rolled stand-in proves a bridge moves bytes, not that the shipping tool behaves as asserted.
- **Inference is cheap here.** A keyless harness proves plumbing; only a run against the real model proves the agent works. Do not ration real-API runs, and do not record their output as a fixture.
- **Own every acquired resource through its teardown.** Ports, temp directories, spawned children, and their process trees are not isolated from anything; release each one on the failure path as well as the success path.

## One-off checks

There is no harness to host a test, so a check is a real run: a `dsh` profile, the Web app, or a throwaway script you delete before committing. Workspace imports inside such a script resolve to `src` through the `tsconfig.base.json` paths map ([layout](development.md#typescript-project-layout)), never through a package `exports` field to built `lib/`, where a stale second copy of a module singleton would load.
