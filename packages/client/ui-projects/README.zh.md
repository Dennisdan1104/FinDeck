---
description: "FinDeck 项目管理页：一个 settings section，消费 workspace Remote——每个项目的工作目录、项目目录、托管子目录，以及该项目工作目录解析出的带层标记 preset 名单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-projects

[English](README.md) | 中文

## 摘要

`dsh-client-ui-projects` 是项目管理页：一个 `settings.section` 行（`projects`），消费生成的 `workspace` 与 `agentPresets` Remote namespace。它列出 Host 的全部 Workspace——即 Project 实体——的工作目录、解析出的项目目录、该目录是否为用户改指、三个托管子目录（`memory/`、`presets/`、`automations/`）的状态，以及该工作目录解析出的项目层 preset 名单。在页面上，操作者可以重命名项目、改指项目目录、重置为派生默认、用现有目录创建项目，并查看该项目的 preset 层。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 web profile 中，于本页读取的 API Remotes 以及 ui-workspace 插件之后挂载本行；ui-workspace 的根贡献发布了本页读取的 `useWorkspaces` 选择器钩子。本包需要 `ctx.slots`、`ctx.locale`，以及已挂载的 `workspace`、`agentPresets`、`directoryPicker` Remote 面。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-client-ui-projects'
```

无配置项。section id 为 `projects`，在设置导航中排在 Schedule 之后。

### 页面内容

- **每个项目一张卡片**——标题、内建默认项目的 `默认项目` 徽标、`projectDirCustom` 为真时的 `自定义目录` 徽标、会话数、工作目录与项目目录（两者都截断显示，完整路径在 `title` 属性里）。
- **托管子目录**——`memory`、`presets`、`automations`，各自按该项目的 `ensureProject` 答案标记为已建或未建。读取失败显示 `读取失败`，不会给出错误结论。
- **操作**——重命名（`rename` Remote）、改指目录（`setProjectDir`）、重置默认（`resetProjectDir`）、项目 preset（在卡片下方展开名单）。
- **Preset 层**——按需对项目的工作目录调用 `rosterFor({ cwd })`：每个 preset 的显示名、id、信任层级、默认标记、损坏原因，以及项目层供应的行上的 `项目` 徽标。

### 目录选择

改指与新建对话框里的 **浏览…** 发起的是 ui-workspace 插件自身选择流程所调用的同一个 `directoryPicker.pick` Remote 调用。组合出的后端若没有 native 能力会以 `directory-picker/unavailable` 拒绝，对话框保留可输入的路径字段作为兜底，因此在不支持选择器的主机上本页仍可用。

### 可观察的成功与失败

新建或改指经 Host 采纳目录后，会重新读取全部项目目录；失败（如重命名的重名冲突、`workspace/invalid-project-dir`）显示在对话框内。重置失败显示在卡片上方的行内提示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`ProjectsPage` 在框架的 `useWorkspaces` 选择器钩子之上持有三项查看状态——每项目的目录读取、每项目的 preset 名单、当前打开的对话框。它不持有业务状态：Host 的 Workspace 快照就是项目列表，每次变更都经注入的适配器执行，适配器要么解析 Remote 答案，要么抛出 Host 自身的失败。

`src/client/index.ts` 注册 `ui.projects` 字典与 `projects` section 行，并把五个 `workspace` 动词、`directoryPicker.pick`、`agentPresets.rosterFor` 适配为本页收到的普通回调。

### 源码地图

- `src/client/index.ts`——字典注册、`projects` section 行与 Remote 适配器。
- `src/client/ProjectsPage.tsx`——页面：卡片列表、子目录状态、preset 展开器，以及重命名/改指/新建对话框。
- `src/client/locales.ts`——`ui.projects` 字典键。

-----

<a id="model-experience"></a>
## 模型体验

无。本页读取 Host 项目状态并调用 Host 变更；它做的任何事都不进入模型请求，也不新增会话事件。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **没有删除操作**——本页创建、重命名、改指项目；移除项目仍归侧栏自己的项目操作。
- **本页的项目成员关系只读**——会话经 `cwd` 与 `create`/`rename` 动词绑定项目；本页不在项目间移动会话。
- **Preset 层是只读**——名单列出项目层供应的内容；创建或编辑项目 preset 仍归 agent-preset 设置页。
- **定时任务是目录而非调度器**——卡片只报告 `automations/` 是否存在；其背后的跨会话 runner 属后续工作。
- **每个展开只读取一次 preset 名单**——收起再展开会重新读取，但卡片保持展开期间名单发生变化要等下次展开才刷新。
