---
description: "cluster 组地图：基于 subagent 接缝的模型侧 cluster_run 扇出工具，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/cluster

[English](README.md) | 中文

## 概述

cluster 组让 agent 对同一个任务同时获得多个独立视角，而不是一个无人反驳的答案：`cluster_run` 把任务并行发给一组 subagent，每个成员承担各自被指定的视角，随后再交给一个聚合 subagent，把它们的答案合并成单一结果。本组只有一个产品包，提供 `cluster_run` 工具，并完全建立在 subagent 接缝之上——它不注册任何 provider，所有子代理都跑在配置的 `ctx.subagents` provider 上。单个成员失败只会作为失败信息交给聚合器；只有全部成员都失败时，这次调用才以错误结束。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-cluster`](tool-cluster/README.zh.md) | 让多个承担不同视角的 subagent 回答同一任务，并聚合它们的答案 | 注册到 `ctx.tools`；通过 `ctx.subagents` 委派 |

-----

<a id="related-documentation"></a>
## 相关文档

- [subagent 组地图](../subagent/README.zh.md)——本组所消费的委派接缝、其 provider 与同类委派工具。
- [生成的工具目录](../../docs/tool-catalog.zh.md)——模型接收的 `cluster_run` schema。
- [生成的配置目录](../../docs/config-catalog.zh.md)——每个受支持配置字段及其声明来源。
- [并行工具调用 Agent Note](../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.zh.md)——`cluster_run` 所加入的同类调用并发契约。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
