---
description: "The cluster group map: the model-facing cluster_run fan-out over the subagent seam, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/cluster

English | [中文](README.zh.md)

## Summary

The cluster group gives an agent several independent viewpoints on one task instead of one unopposed answer: `cluster_run` sends the task to a group of subagents in parallel, each with its own assigned perspective, and then to an aggregator subagent that combines their answers into a single result. It is one product package that provides the `cluster_run` tool and builds entirely on the subagent seam — it registers no provider of its own and runs every child on the configured `ctx.subagents` provider. A member that fails is reported to the aggregator as failed; only a run where every member fails ends the call with an error.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-cluster`](tool-cluster/README.md) | Answers one task through several perspective-assigned subagents and aggregates their answers | registers on `ctx.tools`; delegates through `ctx.subagents` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Subagent group map](../subagent/README.md) — the delegation seam, its providers, and the sibling delegation tools this group consumes.
- [Generated tool catalog](../../docs/tool-catalog.md) — the `cluster_run` schema the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md) — every accepted config field and its source declaration.
- [Parallel tool-call execution Agent Note](../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md) — the sibling-call contract `cluster_run` opts into.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
