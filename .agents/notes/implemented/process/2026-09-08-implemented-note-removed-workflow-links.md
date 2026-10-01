# Agent Note: Implemented-note links to removed upstream workflows

Status: implemented

English | [中文](2026-09-08-implemented-note-removed-workflow-links.zh.md)

## Problem

`verify-md-links` checks every repo-authored Markdown file's relative links and excludes only archived notes' outbound links, because that history is frozen. Implemented Agent Notes stay in scope: they must track where their decision lives. The fork deleted the inherited upstream `.github/workflows` tree, so ten implemented note pairs still link to `ci.yml`, `ci-master.yml`, `e2e.yml`, `sandbox.yml`, `issue-policy.yml`, `issue-lifecycle.yml`, and `build-exe-for-python-sdk.yml` — 44 links that name files the fork deliberately removed. The gate has no ignore list, so doc-sync failed on every run.

## Decision

`verify-md-links` exempts exactly one historical case: a link whose target matches `.github/workflows/<file>.yml|yaml` and does not exist, in a source under `.agents/notes/implemented/`. `isRemovedUpstreamWorkflowReference` implements that rule and `findViolations` applies it only inside the missing-target branch, so an existing target still gets its fragment check and every other missing target still fails. The gate's module doc names the exemption.

## Alternatives considered

**Rewrite the notes' links.** Rejected: the notes record decisions whose evidence was the workflow file, and their prose still describes the deleted CI layout; rewriting the link changes the historical record without making the prose true.

**Delete the links.** Rejected: it removes the evidence the decision cites and leaves the surrounding sentences dangling.

**Restore the workflows.** Rejected: the fork removed them deliberately; restoring CI files to satisfy a link checker inverts the dependency.

**Exempt every link in implemented notes.** Rejected: it would stop checking the notes entirely and hide a genuinely broken link to a current file.

**Extend the archived-note exclusion to implemented notes.** Rejected for the same reason: implemented notes must track current paths as the code moves.

## Consequences

- The 44 links resolve as history, and `verify-md-links` passes with 2302 files checked.
- A note linking to a missing non-workflow file, or a non-note document linking to a missing workflow, still fails; `scripts/verify-md-links.spec.ts` pins both rejections plus the exemption.
- The exemption is directory-and-extension scoped: an existing workflow file is still checked, and a note link to a missing `.github/workflows/*.md` still fails.
