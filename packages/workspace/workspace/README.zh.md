---
description: "面向选择、挂载或排查持久 workspace 记录与会话头校验成员资格的宿主的 Workspace 实体注册表（ctx.workspaceRegistry）说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace

[English](README.md) | 中文

## 概述

`dsh-workspace` 为宿主提供一组持久 workspace：命名用户目录，每个目录带有在其中运行的会话，并在重启之间保持稳定顺序。借助它，UI 可以显示项目侧边栏、把会话附加到正确的项目、把会话从分组中隐藏而不丢失它，以及移除项目——移除绝不会删除文件夹或会话历史，它们变成 Ungrouped。在需要持久项目分组的 GUI 或宿主组合中使用它；headless 与最小运行可以完全省略它。此包只面向宿主侧：模型、工具与 agent loop 永远不会看到它，因此不会增加任何 token、提示词或请求上下文。它需要会话存储与持久化后端一并挂载；设置只需几行组合配置。

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

使用此包为产品提供项目列表：用户工作的命名目录、每个目录中运行的会话、稳定顺序，以及在不丢失会话的前提下将其隐藏的能力。每项操作背后的 API 约定放在实现章节中。

### 何时使用

当产品展示持久 workspace 界面——侧边栏、会话分组或需要命名并排序目录的自动化——时使用它。它对模型不可见，因此不增加任何 token 或请求成本。没有分组界面时跳过它；harness 中没有其他包需要它。

### 设置

此包本身不声明任何配置；它需要会话存储、会话持久化后端，以及保存其记录的存储行。最小组合如下：

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-workspace'
```

挂载这些行之后，创建项目会立即出现在列表中并在重启后保留；首次启动还会按会话运行的目录对既有会话分组。如果缺少某个必需依赖，workspace 功能会一直不可用，直到它被挂载。

### 创建与排序项目

从任何存在且完整限定的目录创建项目：`C:\` 等文件系统根目录和普通目录都有效。相对路径、`C:work` 等 Windows 盘符相对路径、不存在的路径和文件都会被拒绝，且不会创建项目；为已有项目的目录再次创建会原样返回现有项目。你可以随时重命名项目，并把它移动到列表中的任意位置：

```text
// Host consumer code, after the composition above is loaded:
const project = await ctx.workspaceRegistry.create('/path/to/dir', 'My Project')
await project.setTitle('Renamed')
ctx.workspaceRegistry.list() // shows the project, newest first
```

`createProject({ name })` 是界面添加项目时使用的一次调用路径：它推导出一个全新的 `<home>/projects/<uuid>/` 工作目录并创建它，以去除首尾空白后的名字作为标题登记记录，并在返回前物化项目目录树。已经有工作目录的调用方改传 `path`，该目录不存在时会先被创建再被采纳：

```text
// Host consumer code:
const created = await ctx.workspaceRegistry.createProject({ name: 'HS300 research' })
created.path // '<home>/projects/<uuid>'
const notes = await ctx.workspaceRegistry.createProject({ name: 'Notes', path: 'D:/work/notes' })
notes.path // 'D:/work/notes', canonicalized
```

名字为空会以 `WorkspaceProjectNameInvalidError` 拒绝；工作目录非完整限定、无法创建，或目录树物化失败，会以 `WorkspaceProjectDirInvalidError` 拒绝。标题不要求唯一：两个项目可以同名，采纳另一个项目已拥有的目录会原样返回那个项目。

### 项目目录

每个 workspace 还拥有一个项目目录：产品在其下保存项目级资源的根目录——memory、presets、automations。默认值是推导出来的而非存储的：`<home>/projects/<workspace-id>`，其中 `<home>` 是 harness home（`$FINDECK_HOME`，否则 `$DSH_HOME`，否则 `~/.findeck`）。用自定义绝对路径把 workspace 指向别处，清除该覆盖即可回到默认值；默认路径永不写入记录。未显式传 `path` 创建的项目在 `<home>/projects/<uuid>/` 中工作，因此它的工作目录与项目目录是同一个 projects 根下的兄弟目录，而项目目录仍使用记录 id 的拼写。

在有人调用之前不会创建任何东西。`ensureProjectDir(id)` 解析目录，连同其 `memory/`、`presets/`、`automations/` 三个子目录一起创建，并报告解析后的路径以及每个子目录是否存在。已存在的目录保持不变，因此该调用可以安全重复。

```text
// Host consumer code:
const state = await ctx.workspaceRegistry.ensureProjectDir(project.id)
state.projectDir     // absolute resolved path: the custom directory or '<home>/projects/<id>'
state.subdirectories // { memory: true, presets: true, automations: true }
await ctx.workspaceRegistry.setProjectDir(project.id, 'D:/projects/my-project')
await ctx.workspaceRegistry.setProjectDir(project.id) // clears the override
```

自定义路径必须完整限定，且其目录树必须可创建：非完整限定的路径，或无法创建的目录，会以 `WorkspaceProjectDirInvalidError` 拒绝，且记录保持不变。三个子目录名以 `projectMemoryDir`、`projectPresetsDir`、`projectAutomationsDir` 导出，供把自身资源存放在那里的包使用。

只知道自己的工作目录的调用方，用 `projectPresetsDirForPath(cwd)` 解析同一层：它返回「已注册路径包含该目录的那个 workspace」的 `presets/` 目录——workspace 相互嵌套时取最深匹配，没有任何 workspace 包含该路径时返回 `undefined`，且不创建、不写入任何东西。项目级资源就是这样在不指名 workspace id 的情况下找到自己的项目，也正是它让一个项目的 preset 对其他项目不可达。

项目模型就是这个 workspace 实体的演进，而不是它旁边的第二个实体（P9 修订记录 R16）。

### 将会话归入项目

会话加入它运行目录所在的项目：在项目目录中创建会话，它就会出现在该项目下，新到旧排列。一个会话只能属于一个项目。目录无法校验的会话——没有记录目录，或目录被移动、删除——无法加入，保持 Ungrouped。

### 隐藏会话与移除项目

当会话不应再出现在分组中时隐藏它：它会从可见列表中消失，但其会话、历史与在项目中的位置都保持不变。项目不再需要时移除它：它离开列表，而其文件夹、文件与会话历史绝不受影响——这些会话变成 Ungrouped。之后再次添加同一目录会从空项目开始，不会带回旧会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释此功能背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **每个规范路径一条记录。** `fs.realpath` 是唯一的一套唯一性规范：路径以规范化形式存储，因此指向已被拥有目录的符号链接会与之冲突，唯一性即规范路径的字符串相等。
- **成员资格是所有权加实时 cwd 事实。** 记录的 `sessionIds` 顺序是所有权真源；启动时的头部索引校验它，`sessionIds` 在读取时过滤，下一次变更持久剪除。
- **仅读取头部。** 引导与 attach 校验只读取 `SessionHeader` 字段；事件正文绝不加载。
- **两次写入的变更带显式标记。** 创建与删除在记录/顺序对可能分叉之前先持久化 `pendingMutation` 标记，因此启动只补全被中断的操作，未标记的分叉作为损坏明确报错。
- **串行化写入。** 注册表操作跑在同一条操作链上；实体变更通过领域写链上的 `table.update` 执行，盖上 `updatedAt` 并在其链槽决定成员资格。

### API 行为

该 API 是一个由两个所有者构成的小家族：`WorkspaceRegistry` 负责创建、排序与删除项目并管理其会话记账；`Workspace` 实体暴露显示标题、目录状态与会话投影。各方法的精确约定在代码中，而非本 README——参见 [src/index.ts](src/index.ts) 与 [src/entity.ts](src/entity.ts)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`WorkspaceRegistry` 服务、头部索引、引导、操作串行化 |
| [`src/entity.ts`](src/entity.ts) | 包私有 `Workspace` 实现及其唯一的 `mutate` 写入路径 |
| [`src/spec.ts`](src/spec.ts) | 领域声明：记录 schema、注册表状态、`defineDomain` 规范 |
| [`src/types.ts`](src/types.ts) | 公开 `Workspace` 接口与 `WorkspaceId` 品牌 |
| [`src/project-dir.ts`](src/project-dir.ts) | 项目目录的解析与物化，及其三个受管子目录 |
| [`src/paths.ts`](src/paths.ts) | `realpath` 唯一性规范与规范路径包含判定 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：实体缓存镜像持久表 |

### 持久形态

注册表打开 `workspace` 领域（版本 2）：一张以 `WorkspaceId` 为键的 `workspaces` 表，加上一个持有 `workspaceIds`（权威显示顺序）、`archivedSessionIds`、`archivedAt` 与可选 `pendingMutation` 标记的全局状态。`archivedAt` 是归档集合的保留时钟——会话 id 到其归档时刻——启动清扫会丢弃时钟超过 `archiveRetentionDays`（默认 30 天）的归档会话：其已存日志、归属槽位与归档条目一并删除；本进程仍打开的会话、更新版本构建拥有的日志、以及删除失败的条目都会保留，留待下次启动重试。时钟未记载的归档 id（在该时钟出现之前归档的会话）从读到它的那次启动开始计时，升级不会导致历史被丢弃。在 `archivedSessionIds` 或 `archivedAt` 存在之前写入的记录会通过 schema 默认值解析为空集合；在 `projectDir` 存在之前写入的记录会解析为推导出的默认目录，只有用户覆盖时该字段才写入记录。版本戳之后新增的每个字段都是可选的，因此版本保持 2：默认的 `single` 介质布局会拒绝任何其他已存版本，而领域层没有迁移路径，所以可选字段绝不能升版本号。

### 生命周期

启动时，注册表打开领域、若存在标记则补全被标记的变更、校验已存状态——重复路径、重复会话账本与顺序漂移都会明确报错——并在尚未初始化时先凭持久化头部引导历史、最后写入已初始化标记，因此被中断的引导可以安全恢复。全新空注册表一旦初始化即为真，绝不会再次引导。

### 失败与恢复

创建或删除的第二次写入失败时，缓存与先前顺序会回滚；当操作与回滚都失败时，持久标记仍指明被中断的操作，下一次启动会补全或回滚它。已提交的删除即使标记清理失败仍报告成功，下一次启动会幂等地清除该标记。

### 不变式

`workspace-invariant` 伴生插件注册归属关系：`workspaces` 表的每个持久 `domain/changed` 都必须指向实体缓存已持有的记录——只有在注册表从缓存移除实体之后删除才有效，因此绕过注册表的写入路径会触发不变式失败。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当本包的视角不够用时阅读以下页面：子系统参考是权威的功能约定，Agent Note 记录了项目为何从会话历史起步、以及移除为何是非破坏性的。

- [Workspace 子系统](../../../docs/subsystems/workspace.zh.md)——项目及其会话的功能约定，以及 workspace 服务的生成 API。
- [Workspace 包映射](../README.zh.md)——本组唯一的包及其仓库位置。
- [领域 KV 存储 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)——为什么项目记录使用领域数据形式。
- [Workspace UI 产品流 Agent Note](../../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.zh.md)——首次启动如何从会话历史构建项目，以及 GUI 如何排序。
- [删除 Workspace 注册记录决策](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)——为什么移除项目绝不会删除其文件夹或会话。

-----

<a id="model-experience"></a>
## 模型体验

### Workspace 记录与会话账本

#### 模型看到什么

没有。`ctx.workspaceRegistry` 只向宿主侧消费方提供 workspace 记录：此包不注册工具、不注入提示词、不写入会话事件，因此没有请求字段会携带此包数据。

#### Token 影响

每个请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明项目列表何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **移除绝不删除数据**——移除项目会保留其文件夹、文件与会话历史；这些会话变成 Ungrouped，而会话删除与文件夹移除是彼此独立且尚未提供的功能（参见[决策记录](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.zh.md)）。
- **只有带记录目录的会话才能加入**——只有记录中带有可解析为项目路径的目录的会话才属于项目；没有目录的会话保持 Ungrouped，来自其他目录的会话无法移入。
- **外部变更延迟可见**——如果另一进程删除或损坏目录，项目只能在下次刷新或重启后反映出来。
- **归档会到期**——归档是持久的显示过滤器，保留会话的历史与位置，而它唯一的结束方式是删除：保留期一到，某次启动会丢弃该日志；或者在到期之前由操作者从归档分组里恢复它。
- **重新添加目录从空开始**——移除后再次添加同一目录会创建空会话列表的新项目；旧会话不会自动回来。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

无。

</details>
