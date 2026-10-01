---
description: "面向模型的 FinDeck 两级记忆工具：把一条持久笔记写进全局或调用方项目的存储、按 slug 读回一条，并列出两级存储。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-memory

[English](README.md) | 中文

## 概述

agent 学到值得留存的东西时——用户偏好、项目约定、某条路线被放弃的原因——没有地方安放：会话日志是作为历史被读回的，不是作为知识被查阅的。本消费方包给模型三个工具，操作两级纯文件记忆存储：`memory_write` 覆盖式写入一条带标题的 markdown 条目，`memory_read` 按 slug 从恰好一级存储读回一条，`memory_list` 列出一级或两级并按最新在前排序。

全局存储是 `<harness 主目录>/memory`（配置的主目录、`$DSH_HOME`，否则 `~/.findeck`）；项目存储是 `resolveProjectDir` 为拥有调用会话工作目录的工作区推导出的项目目录之下的 `memory/` 目录。两级是彼此独立的命名空间而非一个层级——读操作必须点名存储，该级没有就是没有——写入时省略 scope 即项目级，而工作目录不属于任何工作区的会话会在此时明确报错。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本插件即可给 agent 持久记忆。它要求 `ctx.tools`；全局存储目录是包配置，项目存储则读自可选的 `ctx.workspaceRegistry`，因此没有工作区服务的组合仍然提供全局存储。

### 何时选择

在需要 agent 跨回合、跨会话携带事实的 FinDeck 组合中使用：用户偏好、项目约定、决策及其理由。希望持久知识以仓库内受版本控制的文件形式存在的组合，应继续使用文件系统工具——记忆不是文档库，也没有任何索引。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-tool-memory'
  config:
    globalDir: '~/.findeck/memory'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `globalDir` | `<harness 主目录>/memory` | 用户级存储的根，每条目一个 `<slug>.md`；首次写入时创建。 |

项目存储不接受配置：它跟随拥有调用会话工作目录的工作区。

### 模型得到什么

三个带严格参数校验的工具：

- `memory_write` —— 写入或覆盖一条条目，返回 `{ slug, path, scope }`。`title` 与 `content` 必填；`scope` 选择存储，`slug` 覆盖由标题生成的 kebab-case id。
- `memory_read` —— 从一级存储读取一条，返回 `{ slug, title, content, scope, path, mtime }`。`slug` 与 `scope` 都必填。
- `memory_list` —— 列出一级或两级存储，返回 `{ scope, entries, note? }`，每条含 `slug`、`title`、`scope`、`mtime`，最新在前。

### 可观察的成功与失败

写入报告它写下的路径。读取不存在的 slug 会报错并给出它检索的存储，读操作从不回退到另一级。拒绝都很响亮并点名规则：`title` 为空或跨多行、`slug` 不是 kebab-case（该规则同时是路径穿越防护）、标题里没有任何字母或数字可供生成 slug。

scope 缺省规则是唯一值得记住的失败：不带 `scope` 的 `memory_write` 指向项目级存储，而工作目录不属于任何工作区的会话会报错，消息里给出该工作目录并提示 `scope: "global"`。列表遵循同一规则但不报错——`memory_list` 返回它找到的条目，并附一条说明项目级存储不可用的 `note`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 设计概念

记忆是文件优先的：一条条目就是一个 `<slug>.md` 文件，首行是 `# <title>`，其余为自由 markdown。没有 frontmatter、没有索引、没有数据库，所以用户可以读、可以 diff、可以手工编辑工具写下的同一批文件，文件的修改时间即条目的更新时间。写入先落到同目录的临时文件再改名，崩溃不会留下写了一半的条目。

项目存储按调用推导而非缓存：插件机会式读取 `ctx.workspaceRegistry`，挑出包含调用会话头部 `cwd` 的最深工作区路径，再用 `projectMemoryDir(resolveProjectDir(workspace))` 得到目录。因此位于不同项目的两个会话绝不共享项目存储，而没有工作区注册表的组合退化为只有全局存储，而不是加载失败。

### 源码地图

- `src/index.ts` —— 工具注册、`globalDir` 配置、scope 解析、slug 生成与校验、条目解析、原子写入与存储列表。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)——三个工具的确切 schema。
- [`@deepseek-ai/dsh-workspace`](../../workspace/workspace/README.zh.md)——工作区实体与 `resolveProjectDir`，它们拥有本项目级存储所在的项目目录。
- [base 组合包](../../bundle/base/README.zh.md)——挂载本插件的 FinDeck 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`memory_list` / `memory_read` / `memory_write` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-memory)。三段描述说明了何时该用记忆、两级存储是彼此独立的命名空间，以及省略 `scope` 会明确报错而不会回退到全局存储。

#### Token 影响

工具可见的请求有固定 schema 成本。挂载时不会把文件送给模型：提示词里不增加任何内容，条目只经模型主动发起的 `memory_read` 或 `memory_list` 结果进入上下文。

#### KV Cache 影响

工具定义与可见性不变时前缀稳定。记忆内容只作为工具结果进入对话，因此追加在可复用前缀之后。

### 工具结果与错误

#### 模型看到什么

`memory_write` 渲染 `memory "<slug>" written to the <scope> store: <path>`。`memory_read` 渲染标题、更新时间与条目正文。`memory_list` 每条渲染一行 `- [<scope>] \`<slug>\`: <title> (updated <mtime>)`，最新在前；项目级存储未解析时追加存储说明。错误渲染拒绝该调用的规则，或没有该 slug 的存储。

#### Token 影响

列表每条一行；读取一条的代价是它的完整正文，即写入者存下的全部内容。条目大小没有任何上限，因此大条目就是大结果。

#### KV Cache 影响

只追加；新可见内容位于可复用请求前缀之后。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制说明何时不适合使用记忆。它们是当前包的约束，不是任务清单。

- **没有任何内容被注入提示词**——模型必须调用 `memory_list` 或 `memory_read` 才能看到东西；希望记忆被自动回忆的组合需要自己的 pre-step 发布器。
- **无搜索、无索引、无排序**——`memory_list` 返回所寻址存储的全部条目，slug 是唯一的查询键。
- **无大小上限**——条目整体写入、整体返回；大正文不会被截断或溢出到别处。
- **无并发控制**——两个写者竞争同一 slug 时最终只留下其中一个文件，且没有任何机制发现这次丢失。
- **项目归属即路径包含**——存储跟随路径包含会话工作目录的最深已注册工作区；注册表中被禁用的工作区在这里不可见，即使其目录仍然存在，而在所有已注册路径之外工作的会话会在写入时静默失去项目级存储。
- **`mtime` 是唯一的更新时间**——用完全相同的内容重写一条条目仍会改变它在列表中的位置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
