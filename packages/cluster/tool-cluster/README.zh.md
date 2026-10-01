---
description: "基于 subagent 接缝的模型侧 cluster_run 工具：并行视角成员加一个聚合器、失败处理，以及提供方与配置约定，供选择、配置或排查该工具的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cluster

[English](README.md) | 中文

## 概述

`dsh-tool-cluster` 让 agent 从多个独立视角回答同一个任务，而不是只给一个无人反驳的答案：`cluster_run` 把任务并行发给一组 subagent，每个成员承担各自被指定的视角，随后再交给一个聚合 subagent，把它们的答案合并为单一结果。该工具完全建立在 subagent 接缝之上——它不注册任何 provider，所有成员与聚合器都运行在部署所配置的那一个 `ctx.subagents` provider 上。失败的成员会作为带标签的失败交给聚合器，而不会让整次调用失败，因此一个挂掉的成员不会丢掉其余成员的结果；只有全部成员都失败时，调用才以错误结束。组合策略有两种：`synthesize` 把答案合并为一个结论，`vote` 返回多数结论与票数分布。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当任务同时受益于多个角度——一个设计决策、一次评审、一个开放问题、一处有风险的改动——而单次委派只会返回一个无人反驳的视角时，使用本包。挂载它并指定一个 subagent provider 是唯一的配置步骤；此后 agent 认为多视角值得多开几个子代理时，就自行发起一次集群运行。

### 何时选择

当价值来自分歧时选择它：相互独立的成员会带出不同证据，聚合器必须调和它们。当答案只是某个可查证的事实时、当延迟比覆盖面更重要时、或当成员之间需要看到彼此的工作时，请避开——集群没有共享草稿区，也没有辩论轮次。每次调用都会等到全部成员与聚合都结束才返回，因此一次集群的开销约等于最慢成员的耗时再加一个子代理的耗时，调用方也无法使用成员的部分结果。

### 最小配置

`provider` 是必填项、没有默认值：省略它的组合会在加载时失败。它必须指向 `ctx.subagents` 上已注册的 provider（例如 `spawn`）。`defaultPerspectives` 与 `defaultStrategy` 是可选项，只影响调用省略对应参数时的取值。

```yaml
- name: '@deepseek-ai/dsh-tool-cluster'
  config:
    provider: spawn
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | 必填 | 所有成员与聚合器运行所用的 `ctx.subagents` provider |
| `defaultPerspectives` | analyst / critic / pragmatist | 调用省略 `perspectives` 时使用的 2-8 条非空视角描述 |
| `defaultStrategy` | `synthesize` | `synthesize` 或 `vote`；调用省略 `strategy` 时使用 |

配置错误会在加载期而不是首次调用时报错：`defaultPerspectives` 少于两条或多于八条、含空条目，以及未知的 `defaultStrategy`，都会被拒绝。尚未注册的 provider 名会在加载时记入日志，并在首次调用时被委派服务拒绝。

生成的配置目录是受支持字段的穷尽式真源。

### 每次调用做什么

调用接受必填的 `task`、可选的 2-8 条 `perspectives` 列表，以及可选的 `strategy`。每个视角对应一个成员：一个 subagent，收到完整任务与仅属于它自己的视角，与其他成员并行启动，并共用调用方工具执行的取消信号。成员彼此独立——没有一个看得到其他成员的答案，也没有一个能向调用方追问。全部成员落定后，再启动一个 subagent——聚合器——它收到任务、解析后的策略，以及按成员顺序排列的全部成员答案（失败以失败标注）；它的答案成为本次调用的 `result`。

结果同时携带每个成员的贡献：`{ strategy, result, members: [{ perspective, status, output }] }`，其中 `status` 为 `completed` 或 `failed`，失败成员的 `output` 说明它为何没有产出。模型读到的是渲染后的文本：先聚合结论，再逐成员一条。成员可以因拒绝、触达 token 上限、报错、被取消、启动失败或没有返回文本而失败；这些都会带上该成员的视角标签并传给聚合器，聚合器的提示词要求它只权衡实际存在的答案。只有全部成员都失败、或聚合器自身无法产出结果时，调用才失败。

### 取消与所有权

每个子代理都以工具执行的 `signal` 启动，因此取消调用会取消成员；成员落定后，被取消的调用会在聚合另开一个子代理之前停下。每个 run 在其结果落定后都会被 dispose，清理失败按该子代理的失败上报，而不会覆盖已经收集到的结果。该工具声明自身并发安全：成员与聚合器都不修改父会话，同级的 `cluster_run` 调用可以同时运行。

### 它不做什么

工具不提供模型或路由选择：每个成员与聚合器都继承所配置 provider 的子代理默认值，因此希望按视角使用不同模型的部署应在 provider 侧配置，或改用其他委派工具。它也没有后台模式——调用总会等待——成员之间除 provider 子代理通常共享的内容外，没有任何共享工作区。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释工具背后的设计取舍，并指出实现它们的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

该工具建立在四项承诺之上：

- **消费者而非提供方。** 它不在 subagent 接缝上注册任何东西；`ctx.subagents.start` 是创建子代理的唯一途径，因此 provider 选择、模型路由与深度策略仍留在它们原本所属的位置。
- **独立性就是产品本身。** 成员同时启动，彼此没有共享状态、也看不到对方，因为能互相读取的成员会退化成"一个答案加额外延迟"。
- **部分失败也是数据。** 失败的成员会成为聚合器输入中带标签的失败，而不是调用方的错误；只有全盘失败才是错误，因为那时已无内容可聚合。
- **部署策略放在 Config。** 视角与策略默认值是经过校验的 `Config` 字段，并带有明确默认值，因此部署无需模型每次调用都重述，就能改变集群的形态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、提示词、成员与聚合器运行、`cluster_run` 注册 |
| [`src/types.ts`](src/types.ts) | `ClusterStrategy` 与 `ClusterMemberOutcome` 的唯一归属地 |
| [`src/client.ts`](src/client.ts) | types 出口的客户端命名空间再导出 |

### 导出形态

本插件是函数插件：导出 `name` / `inject` / `Config` / `apply`，没有默认导出。多余的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢掉 `inject`（见[事后分析 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 调用机制

每个成员都以 `ctx.subagents.start(provider, { label, prompt, parent, signal })` 启动；其终态结果用 `Promise.allSettled` 收集，随后 dispose 该 run，因此来自 run 或来自清理的拒绝只会归到该成员名下。成员上的 `Promise.all` 结束后，若信号已中止，则在启动聚合器之前停止调用。聚合器是同样的启动/收集/dispose 序列，只是提示词不同、且不容忍失败：它的非 `completed` 结果、缺失文本或清理失败都会成为调用的错误。确切的提示词、视角边界与 run 落定逻辑见 [src/index.ts](src/index.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时，阅读以下页面。

- [subagent 组地图](../../subagent/README.zh.md)——本工具所消费的接缝，以及它所补充的同类委派工具。
- [cluster 组地图](../README.zh.md)——同级组页面及其包表。
- [生成的工具目录](../../../docs/tool-catalog.zh.md)——模型接收的 `cluster_run` schema。
- [生成的配置目录](../../../docs/config-catalog.zh.md)——每个受支持配置字段及其声明来源。
- [并行工具调用 Agent Note](../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.zh.md)——本工具所加入的同类调用并发契约。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 `cluster_run` 工具：一个对象，包含必填的 `task` 字符串、可选的 2-8 条字符串数组 `perspectives`，以及可选的 `synthesize` 或 `vote` 策略 `strategy`。其描述说明了扇出与聚合的顺序、成员彼此独立、成员失败不会让调用失败、每种策略返回什么、调用会等待整个集群结束，以及部署的默认视角集合。`perspectives` 的描述带有 2-8 的边界并指向默认值；`strategy` 的描述指向 `synthesize` 默认值。

#### Token 影响

只要工具可见，每次请求都有固定的 schema 开销，并在给定配置下保持稳定。渲染后的结果携带聚合答案以及每个成员的完整文本，因此结果 token 随成员数量与答案长度增长。

#### KV Cache 影响

定义与可见性不变时前缀稳定。成员与聚合器是各自独立的子会话，它们的请求不会延长调用方的前缀。

### 工具调用历史与结果

#### 模型看到什么

助手工具调用保留任务、视角列表与策略。成功时返回形如 `Cluster result (<strategy>, <answered> of <members> members answered):` 的文本，其后是聚合答案，再逐成员给出 `- [completed|failed] <perspective>` 以及该成员的文本或失败原因。固定失败文案包括 `Error: cluster_run requires a calling agent (exec.agent was undefined)`、``Error: cluster_run: `perspectives` must name 2-8 perspectives (got <n>)``、``Error: cluster_run: `perspectives`: perspective <n> is empty``、`Error: every cluster member failed: <perspective>: <reason>; ...`，以及聚合器失败 `Error: the cluster aggregator produced no result — <detail>` / `... : <reason>`。成员与聚合器的子会话是各自独立的日志，不会作为调用方消息重复出现。

#### Token 影响

token 增长主要来自调用回传的聚合答案与逐成员文本；其参数会保留到压缩之前。

#### KV Cache 影响

仅追加；新出现的可见内容跟在可复用的请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了工具不适合的场景。它们是本包当前的约束，不是待办清单。

- **只有一轮，没有辩论。** 每个成员回答一次，聚合器回答一次；成员之间看不到彼此的工作，也无法修订。对抗式或迭代式集群需要另做工具。
- **不支持逐成员选择模型。** 成员与聚合器都在所配置 provider 上用其子代理默认值运行；按视角选择不同模型属于 provider 或部署层面的事，而不是工具参数。
- **调用总会等待。** 没有后台模式，也不会流式返回中间成员，因此一个慢成员会拖慢整个结果。
- **嵌套扇出由别处设限。** 成员保留自己的工具，可能自己调用 `cluster_run`；本工具不传 `maxDepth`，嵌套只受部署的 subagent 深度策略约束。
- **成员文本会重复回传给调用方。** 聚合答案与每个成员的文本都会进入父上下文；这对可审查性是有意为之，但比只回摘要多花 token。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
