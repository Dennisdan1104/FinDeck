# AGENTS.md — Repository scripts

This tree holds what the build and the documentation generators need: the repository build (`build.ts`), the catalog and documentation generators (`gen-*.ts`), release tooling (`release/`), and the shared helpers they import. There are no gate scripts, no verifiers, and no specs here.

- Build and generator scripts invoke pnpm shell-free and normalize repository-relative glob paths to `/` at ingestion.
- Generators are the source of truth for the English generated pages (`tool-catalog`, `config-catalog`, `persistence-catalog`, `module-graph`, the Cordis catalogs) and the per-page `cordis-surface` regions. Regenerate them with the matching `pnpm run gen-<name>` script rather than hand-editing their output.
- A generator keeps its Chinese counterpart in step through the locale projection helpers it imports; English remains the generated source.
- Generators read source and write documentation; `pnpm run build` is the separate artifact plane that emits `lib/`. Nothing here type-checks or tests the workspace beyond the `tsc -b` pass inside `build:lib:host`.
