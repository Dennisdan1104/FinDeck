# Agent Note: assetOverview rejects a non-mapping thesis manifest

Status: implemented

English | [中文](2026-09-08-thesis-mapping-validation.zh.md)

## Problem

The `assetOverview` Remote's thesis reader parses each manifest and accepted any non-null `typeof data === 'object'` value as a thesis mapping. A YAML sequence satisfies that test, so a malformed manifest whose top level is a list was read as a mapping with every field empty and rendered as an empty thesis card. The page is built to name data loss in its `problems` line rather than hide it, so a corrupt manifest disappeared instead of surfacing.

## Decision

`readOverviewTheses` rejects arrays as well (`Array.isArray(data)`), records `thesis "<id>" is not a mapping` in `problems`, and skips the entry; the page renders those problems above the tabs. `tests/overview.spec.ts` pins the sequence case beside the missing-index and broken-JSON cases, so the guard is exercised through the Remote's answer, not only in isolation.

## Alternatives considered

**Skip a malformed manifest silently.** Rejected: the page's contract is to name the data it could not read.

**Validate each manifest against a full schema.** Rejected as out of scope: the reader maps a handful of optional string fields and already tolerates missing ones; the array case is the one that produces a plausible-looking empty card. A schema would also reject manifests written by an older or newer tool than the one reading them.

**Report the problem but still render the entry.** Rejected: there is nothing to render — every field of a sequence is empty, so the card would be blank.

## Consequences

- A sequence manifest surfaces as a named problem and no card; the rest of the overview still renders.
- The guard stays a shape check, not a schema: unknown fields are still ignored, and a mapping with wrong-typed fields still reads as empty strings.
