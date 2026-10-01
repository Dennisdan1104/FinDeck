# Contributing

English | [中文](CONTRIBUTING.zh.md)

Thank you for your interest in contributing to FinDeck.

FinDeck is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — an everything-is-a-plugin agent runtime — with a finance research layer on top. Issues and pull requests are welcome. This fork has a single maintainer, so a substantial change should start as an issue: agree on the direction before the code exists.

## What goes where

- **Bugs and feature requests** — open a [GitHub issue](https://github.com/Dennisdan1104/FinDeck/issues). Name the command you ran, what happened, and what you expected instead; a failure another person can reproduce from a fresh clone is the one that gets fixed first.
- **Security vulnerabilities** — never a public issue. Follow [SECURITY.md](SECURITY.md) and report through GitHub's private vulnerability reporting.
- **Pull requests** — open one against `master`, one subject per PR, and state the path you exercised together with the result you read back. Code you contribute is accepted under the [MIT license](LICENSE) this project ships under.
- **Plugins and skills** — a package outside this repository is a first-class way to extend FinDeck: any package named in a `cordis.yml` is mounted at load, so a plugin does not have to be merged here to be usable.

## Development environment

FinDeck builds on Node.js ≥ 22.19 (or ≥ 24) with pnpm 11.7. The finance layer additionally needs Python ≥ 3.10, in an environment created by [`finance/python/setup-env.sh`](finance/python/setup-env.sh) (Windows: `finance/python/setup-env.ps1`); nothing outside the finance skills needs it. Windows is the primary development platform, and the same commands work on macOS and Linux.

```sh
git clone https://github.com/Dennisdan1104/FinDeck.git findeck
cd findeck
pnpm install
pnpm run build
```

## How a change is verified

This fork ships no test runner and no CI gate: about thirty historical spec and end-to-end files remain in the tree, but nothing executes them, and there is no coverage or lint gate, no `test`, `check`, or `verify` script, and nothing that turns red on its own. A change is accepted because it was built and exercised against real input, not because a checker passed ([verification](docs/testing.md)).

```sh
pnpm run build
```

The build is also the only type check — `build:lib:host` runs `tsc -b tsconfig.host.json`, so a type error fails it. Past that, acceptance is a real run of the path you changed — `pnpm run dev`, `pnpm dsh --profile headless "…"`, the Web UI, or the Python SDK — followed by reading the durable result: the written file, the session log, the workspace, or the rendered page. Your own summary of what the code should do is not evidence; re-read the output from outside.

Do not add a gate to this fork. A PR that introduces a test runner, a lint or coverage step, a pre-push hook, or a CI workflow is out of scope here, per the standing order in [AGENTS.md](AGENTS.md).

## Documentation

Documentation is bilingual: every in-scope document is a three-file set — the English `foo.md`, the Chinese `foo.zh.md`, and a consistency record `foo.i18n.yaml`. Both languages carry equal authority, so a change that edits either side brings the counterpart along in the same change, never in a follow-up.

The record holds the git blob hash of each side as of the last confirmed-consistent state:

```sh
git hash-object foo.md foo.zh.md
```

Write both hashes into `foo.i18n.yaml`; that diff is the act of confirming the pair. Nothing verifies the record, and the full contract is in [docs/i18n/README.md](docs/i18n/README.md).

## Agent Notes

A change that alters behavior, architecture, a contract shared across packages, process or tooling, or an on-disk, wire, or configuration format is worth an Agent Note in the same change: the record of why, and of what was given up. A purely mechanical or local edit does not need one.

Notes live at `.agents/notes/{proposed|implemented|rejected}/{class}/yyyy-mm-dd-topic-title.md`, carry the mandatory `## Problem` and `## Alternatives considered` sections, and are paired English/Chinese/sidecar files like any other document. The format, the class list, and the archiving rules are in [.agents/notes/README.md](.agents/notes/README.md).
