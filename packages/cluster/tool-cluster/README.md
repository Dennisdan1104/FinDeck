---
description: "The model-facing cluster_run tool over the subagent seam: parallel perspective members plus one aggregator, failure handling, and the provider/config contract, for users and maintainers choosing, configuring, or debugging the tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cluster

English | [中文](README.zh.md)

## Summary

`dsh-tool-cluster` gives the agent a way to answer one task from several independent views instead of one unopposed answer: `cluster_run` sends the task to a group of subagents in parallel, each with its own assigned perspective, and then to an aggregator subagent that combines their answers into a single result. The tool builds entirely on the subagent seam — it registers no provider, and every member and the aggregator run on the one `ctx.subagents` provider the deployment configures. A member that fails is reported to the aggregator as a labeled failure instead of failing the call, so one dead member cannot discard the others; only a run where every member fails ends the call with an error. Two combination strategies are available: `synthesize` merges the answers into one conclusion, and `vote` returns the majority conclusion with the vote distribution.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package when a task benefits from several angles at once — a design decision, a review, an open question, a risky change — and a single delegation would return one unopposed view. Mounting it with a subagent provider is the only setup; the agent then runs a cluster whenever its own judgment says multiple perspectives are worth the extra children.

### When to choose it

Choose it over the plain delegation tool when the value is in disagreement: independent members surface different evidence, and the aggregator has to reconcile them. Avoid it when the answer is a single discoverable fact, when latency matters more than coverage, or when the members would need to see each other's work — a cluster has no shared scratchpad and no debate round. Every call waits for all members plus the aggregation before it returns, so a cluster costs roughly the slowest member's time plus one more child's time, and the caller cannot use the members' partial results.

### Minimal configuration

`provider` is required with no default: a composition that omits it fails at load. It must name a provider registered on `ctx.subagents` (for example `spawn`). `defaultPerspectives` and `defaultStrategy` are optional and only change what a call gets when it omits that argument.

```yaml
- name: '@deepseek-ai/dsh-tool-cluster'
  config:
    provider: spawn
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | The `ctx.subagents` provider every member and the aggregator run on |
| `defaultPerspectives` | analyst / critic / pragmatist | 2-8 non-empty viewpoint lines used when a call omits `perspectives` |
| `defaultStrategy` | `synthesize` | `synthesize` or `vote`; used when a call omits `strategy` |

A misconfigured value fails at load rather than at the first call: `defaultPerspectives` with fewer than two or more than eight entries, or with a blank entry, is rejected, as is an unknown `defaultStrategy`. A provider name that is not registered yet is logged at load and rejected by the delegation service at the first call.

The generated configuration catalog is the exhaustive source for the accepted fields.

### What each call does

The call takes a required `task`, an optional `perspectives` list of 2-8 lines, and an optional `strategy`. Each perspective becomes one member: a subagent that receives the full task plus only its own viewpoint, started in parallel with the others on the calling tool execution's cancellation signal. Members are independent — none sees the task's other answers, and none can ask the caller anything. When every member has settled, one more subagent — the aggregator — receives the task, the resolved strategy, and every member answer in member order, with failures marked as failures; its answer becomes the call's `result`.

The result also carries every member's contribution: `{ strategy, result, members: [{ perspective, status, output }] }`, where `status` is `completed` or `failed`, and a failed member's `output` is why it produced nothing. The model reads the rendered form: the aggregate, then one entry per member. A member can fail by refusing, hitting its token limit, erroring, being cancelled, failing to start, or returning no text; each of those is labeled with the member's perspective and passed to the aggregator, whose prompt tells it to weigh only the answers present. The call fails only when every member fails, or when the aggregator itself cannot produce a result.

### Cancellation and ownership

Every child starts on the tool execution's `signal`, so cancelling the call cancels the members; once the members have settled an aborted call stops before spending another child on aggregation. Each run is disposed after its result settles, and a cleanup failure is reported as that child's failure instead of replacing an already-collected result. The tool declares itself concurrency-safe: members and aggregator never mutate the parent session, and sibling `cluster_run` calls may run at the same time.

### What it does not do

The tool exposes no model or route selection: every member and the aggregator inherit the configured provider's child defaults, so a deployment that wants different models per perspective configures that at the provider or chooses another delegation tool. It also has no background mode — the call always waits — and no shared workspace between members beyond what the provider's children normally share.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The tool is built on four commitments:

- **Consumers over providers.** It registers nothing on the subagent seam; `ctx.subagents.start` is the only way a child is created, so the deployment keeps provider choice, model routing, and depth policy where they already live.
- **Independence is the product.** Members are started together with no shared state and no view of each other, because a cluster whose members can read each other collapses into one answer with extra latency.
- **Partial failure is data.** A failed member becomes a labeled failure in the aggregator's input, not an error for the caller; only total failure is an error, which is the one case where there is nothing to aggregate.
- **Deployment policy in Config.** Perspectives and strategy defaults are validated `Config` fields with documented defaults, so a deployment can change what a cluster looks like without the model restating it on every call.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, prompts, member and aggregator runs, `cluster_run` registration |
| [`src/types.ts`](src/types.ts) | The one home of `ClusterStrategy` and `ClusterMemberOutcome` |
| [`src/client.ts`](src/client.ts) | Client-namespace re-export of the types outlet |

### Export shape

The plugin is a function plugin: it exports `name` / `inject` / `Config` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Call mechanics

Each member is started with `ctx.subagents.start(provider, { label, prompt, parent, signal })`; its terminal result is collected with `Promise.allSettled` and its run disposed afterwards, so a rejection from the run or from disposal is reported for that member alone. After `Promise.all` over the members, an aborted signal stops the call before the aggregator is started. The aggregator is the same start/collect/dispose sequence with a different prompt and no failure tolerance: its non-`completed` result, missing text, or disposal failure becomes the call's error. See [src/index.ts](src/index.ts) for the exact prompts, the perspective bounds, and the run settlement.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Subagent group map](../../subagent/README.md) — the seam this tool consumes and the sibling delegation tools it complements.
- [cluster group map](../README.md) — the sibling group page and its package table.
- [Generated tool catalog](../../../docs/tool-catalog.md) — the `cluster_run` schema the model receives.
- [Generated configuration catalog](../../../docs/config-catalog.md) — every accepted config field and its source declaration.
- [Parallel tool-call execution Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md) — the sibling-call contract this tool opts into.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees one generated `cluster_run` tool: an object with a required `task` string, an optional `perspectives` array of 2-8 strings, and an optional `strategy` of `synthesize` or `vote`. Its description states the fan-out and aggregation order, that members are independent, that a failed member does not fail the call, what each strategy returns, that the call waits for the whole cluster, and the deployment's default perspective set. The `perspectives` description carries the 2-8 bound and points at the default; the `strategy` description points at `synthesize` as the default.

#### Token effect

A fixed schema cost on every request where the tool is visible, stable for a given configuration. The rendered result carries the aggregated answer plus every member's full text, so result tokens scale with the number of members and the length of their answers.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Members and the aggregator are separate child sessions, so their requests do not extend the caller's prefix.

### Tool-call history and result

#### What the model sees

The assistant tool call retains the task, the perspectives, and the strategy. Success returns text shaped `Cluster result (<strategy>, <answered> of <members> members answered):` followed by the aggregated answer and then one `- [completed|failed] <perspective>` entry per member with that member's text or its failure reason. Stable failures are `Error: cluster_run requires a calling agent (exec.agent was undefined)`, `Error: cluster_run: \`perspectives\` must name 2-8 perspectives (got <n>)`, `Error: cluster_run: \`perspectives\`: perspective <n> is empty`, `Error: every cluster member failed: <perspective>: <reason>; ...`, and the aggregator failures `Error: the cluster aggregator produced no result — <detail>` / `... : <reason>`. The member and aggregator child sessions are separate logs, not repeated caller messages.

#### Token effect

Token growth is dominated by the aggregated answer and the per-member texts the call renders back; the arguments stay until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **One round, no debate.** Each member answers once and the aggregator answers once; members never see each other's work and cannot revise. An adversarial or iterative cluster would need a different tool.
- **No per-member model selection.** Members and the aggregator run on the configured provider with its child defaults; choosing a different model per perspective is a provider or deployment concern, not a tool argument.
- **The call always waits.** There is no background mode and no streaming of intermediate members, so a slow member delays the whole result.
- **Nested fan-out is bounded elsewhere.** A member keeps its own tools and may call `cluster_run` itself; this tool passes no `maxDepth`, so nesting is bounded only by the subagent depth policy of the deployment.
- **Member text is repeated to the caller.** The aggregated answer and every member's text both reach the parent context, which is intentional for reviewability but costs tokens that a summary-only result would not.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
