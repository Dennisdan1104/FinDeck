---
description: "面向持久圆桌转录归档的 roundtable_list 与 roundtable_read 模型工具，供组合或排查金融研究圆桌的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-roundtable

[English](README.md) | 中文

## 概述

`dsh-tool-roundtable` 让 agent 能读取过去的圆桌。`dsh-roundtable` 引擎在桌子关闭（改开另一桌，或清桌）时归档该桌的完整转录；这两个工具把归档提供给模型：`roundtable_list` 返回近期桌表的头信息——各自何时开过、坐了哪套名单与哪个模型、深浅、发言次数、开场话题；`roundtable_read` 返回单桌完整转录——每条用户消息、每次发言（发言内容、思考过程与引用）及系统注记。agent 用它们回忆某个圆桌得出了什么结论，并在报告中引用。引擎与本包只共享目录契约（`dsh-roundtable/archive`，默认 `<harness 主目录>/roundtables`）。

## 目录

- [何时选用本包](#何时选用本包)
- [实现要点](#实现要点)
- [延伸阅读](#延伸阅读)
- [模型体验](#模型体验)
- [已知限制与未做事项](#已知限制与未做事项)

-----

<a id="何时选用本包"></a>
## 何时选用本包

在运行圆桌引擎、且希望 agent 能回忆过往桌面的组合中挂载。它只要求 `ctx.tools`；归档目录由引擎创建，目录不存在时列表只返回空。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-tool-roundtable'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `archiveDir` | `<harness 主目录>/roundtables` | 归档根目录；与圆桌引擎写入的默认目录相同 |

已生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-roundtable)是可接受字段的穷尽来源。

### 每次调用做什么

`roundtable_list { limit? }` 按新到旧返回至多 `limit`（1–50，默认 10）条摘要。`roundtable_read { id }` 返回桌面配置加完整转录；畸形 id 或损坏的归档文件会带归档 id 与原因响亮失败。

-----

<a id="实现要点"></a>
## 实现要点

<details>
<summary>实现内部——点击展开</summary>

这两个工具只是 `dsh-roundtable/archive` 之上的薄模型侧适配层：`listRoundtableArchives` 与 `readRoundtableArchive` 拥有防御性解析、id 模式（兼作路径穿越守卫）以及引擎使用的原子写入。本包自身不新增存储。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema 与两个工具注册 |
| [`../roundtable/src/archive.ts`](../roundtable/src/archive.ts) | 归档目录契约：记录形状、写入、列出、读取 |

</details>

-----

<a id="延伸阅读"></a>
## 延伸阅读

- [圆桌引擎](../roundtable/README.zh.md)——桌面何时、如何归档。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-roundtable)——模型收到的 schema。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-roundtable)——全部可接受配置字段。

-----

<a id="模型体验"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`roundtable_list` / `roundtable_read` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-roundtable)。

#### Token 影响

工具可见的请求有固定 schema 开销；读取结果随所读桌面的转录长度增长。

#### KV 缓存影响

定义不变时前缀保持稳定。

### 工具调用历史与结果

`roundtable_list` 每个归档桌渲染一行；`roundtable_read` 以 `[kind] name: text` 行渲染转录，带引用与截断标记。失败渲染归档 id 与解析失败原因。

## 已知限制与未做事项

<a id="已知限制与未做事项"></a>

这些限制界定本工具何时不适用。它们是当前包约束，不是任务积压。

- **只读**——工具不能开桌、引导或关桌；桌面生命周期仍属圆桌页面与其 Remote。
- **只在关桌时归档**——只有发言过后关闭的桌面会归档；进程退出时仍在进行的桌面不归档（那里 agent 驱动的日志路径是唯一记录）。
