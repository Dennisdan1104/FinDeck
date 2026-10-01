---
description: "Host 与 Client 工作区控制：修改工作区导航并跟随其完整投影。"
kind: "package-reference"
---
# Workspace Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-workspace-controller` 拥有 Host 的 `ctx.workspaceController` 服务和生成的 Client `ctx.remote.workspace` namespace。它的 Remote 方法负责按名称创建项目，或把已有目录采纳为 Workspace，并负责重命名、移除和重排 Workspace，在 Workspace 内重排 Session，从 Workspace 导航中归档与恢复 Session，把 Workspace 指向其项目目录，以及跟随完整的 Workspace 投影。当 Client 必须修改或跟随 Workspace 导航时，请通过 API Gateway 使用它。本包同时拥有 `ctx.directoryPickerController` 与生成的 `ctx.remote.directoryPicker` namespace，因为它承载的选目录 seam 是抽象的，自身从不作为 Loader entry。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 控制器会串行执行正确性取决于当前 registry 状态的变更，并为预期失败抛出带稳定 `workspace/*` 或 `directory-picker/*` 码的 `RemoteError`。它的 `follow()` 流会同步订阅持久 Workspace 变更，先发出一份完整 baseline，再按顺序发出 `upsert`、`remove`、`order` 和 `archived` 增量。重连会以替换 baseline 开始新一代，因此消费方不依赖收到断线期间的每个增量。

Client 入口提供 `ClientWorkspaceModel` 和 `createWorkspaceStateStream()`。该模型拥有 Workspace 行、registry 顺序、已归档 Session id、一元变更回声，以及流与一元调用的竞态处理。较新的 Host 行按 `updatedAt` 获胜；已提交的流顺序优先于较旧的一元响应；已经移除的 Workspace id 不会被延迟数据复活。该包公开与框架无关的快照和订阅，把导航策略与 React hook 留给 UI owner。

### 按名称创建项目

`createProject({ name })` 登记一个新项目，其工作目录由 Host 推导并创建在 `<home>/projects/<uuid>/`；`createProject({ name, path })` 采纳给定的完整限定目录，目录不存在时先创建它。两者都以去除首尾空白后的名字作为项目标题——标题允许重复——并在应答前物化项目目录树，因此返回的 `WorkspaceView` 可直接使用。名字为空会以 `workspace/invalid-project-name` 失败；工作目录非完整限定或无法创建，会以 `workspace/invalid-path` 失败并携带被拒绝的路径。

### 项目目录 verbs

每个 `WorkspaceView` 都携带解析后的项目目录以及它是否为用户覆盖：`projectDir` 在设置了自定义路径时就是该路径，否则是推导出的默认 `<home>/projects/<workspaceId>`；`projectDirCustom` 仅在是覆盖时为 true。默认路径永不存储，因此跨重连始终一致。

`setProjectDir({ workspaceId, path })` 采用一个绝对自定义目录，连同其 `memory/`、`presets/`、`automations/` 子目录一起创建，并返回更新后的 `WorkspaceView`。`resetProjectDir({ workspaceId })` 清除覆盖、回到推导出的默认目录并创建该目录树。`ensureProject({ workspaceId })` 物化当前生效的目录并返回 `{ projectDir, subdirectories }`，其中 `subdirectories` 报告每个受管子目录是否存在；它不写任何东西，所以只需要目录的消费方可以随时调用。

非完整限定的路径，或目录树无法创建的目录，会以 `workspace/invalid-project-dir` 码失败，并携带 Workspace id 与被拒绝的路径。记录保持不变，因此一次失败的改指绝不会改变 Workspace 当前指向的位置。

Client 服务（`ctx.workspaces`）把这两个动词镜像为 `setProjectDir(workspaceId, path)` 与 `resetProjectDir(workspaceId)`，并把应答并入自己的快照，界面无需重读即可看到新目录。被拒时抛出 `WorkspaceProjectDirError`：它的 `message` 就是 Host 的消息，`rpcError.code` 供界面按「目录无效」分支处理。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 Workspace 组织属于浏览器与 Host 控制状态，并且不注册提示词、工具或会话事件。

#### KV Cache 影响

无直接影响；Workspace 变更不会改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `follow()` 在重连后替换完整投影，不提供持久 cursor 或增量追赶协议。
- 进程本地删除标记只会在 Client 模型生命周期内阻止延迟数据复活已移除的 Workspace。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Workspace Registry 负责持久化，每次流生成都是完整投影。
