# Agent Note: New packages resolve through tsconfig path aliases

Status: implemented

English | [中文](2026-09-08-new-package-tsconfig-aliases.zh.md)

## Problem

The six packages AlphaDeck added — `dsh-tool-thesis`, `dsh-redblue`, `dsh-roundtable`, `dsh-client-ui-assets`, `dsh-client-ui-redblue`, and `dsh-client-ui-roundtable` — had no `paths` aliases in the generated `tsconfig.base.json` (nor did `dsh-client-ui-shell`'s client face). Workspace imports therefore resolved through `node_modules` to each package's built `lib/`, so tests and type checks read build output instead of source. That is the opposite of the source-plane rule, and it produced a trap: editing a package's source changed nothing until the package was rebuilt. The tool catalog also still lacked tool-thesis's three tools.

## Decision

`gen-tsconfig-paths` gains the aliases for the six packages, both faces where a package declares one, and `tsconfig.base.json` is regenerated; `gen-tool-catalog` registers `thesis_list`/`thesis_write`/`thesis_mark` and `docs/tool-catalog.md` is regenerated. `verify-tsconfig-paths` and `verify-tool-catalog` pass.

## Alternatives considered

**Rely on per-package tsconfigs only.** Rejected: the repository gates and Vitest resolve through `tsconfig.base.json`; without a base alias they fall back to built output.

**Hand-edit `tsconfig.base.json`.** Rejected: the file is generated and `verify-tsconfig-paths` flags the drift; the generator is the single owner.

**Point the aliases at `lib/` deliberately.** Rejected: it would make the gates test build output, which is the defect this fixes.

## Consequences

- Tests and type checks for the six packages read `src`; a source edit takes effect without a rebuild.
- The tool catalog lists tool-thesis's schemas, and the same generator owns both the alias table and the catalog.
- A future package is invisible to the source plane until its alias is added; `verify-tsconfig-paths` is the enforcement point.
