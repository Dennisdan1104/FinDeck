---
description: "Web GUI 的会话模式界面：输入框的模式选择器与流程进度条；面向会话模式的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mode

[English](README.md) | 中文

## 概述

本包渲染 Web GUI 的两个会话模式界面：输入框的模式选择器——一个名册之上的紧凑菜单，通过 `/mode` 命令通道切换会话，自由模式下其旁另有一个 AI 集群开关，经 `/cluster` 设置会话级偏好——以及会话标题栏下方的流程条，展示工作模式已声明的步骤（完成/当前/未开始三态）与当前步骤的模型，或自由模式的已声明标签轨迹。模式行为本身——`/mode` 命令、`mode` 投影、`flow_step` 工具、流程提示词分段——属于 `dsh-mode`；本包只渲染投影、发送用户同样可以手敲的内容。若某次选择被已组合的 skill-forge 入口认领，那它根本不是切换：该入口会打开自己的会话选择器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本插件与 `ui-conversation`、`dsh-mode` 一起组合；选择器随即占据输入框中 plan 控件旁的模式座位与标题栏的模式座位，流程条占据会话标题栏下方的 slot。切换执行 `/mode <id>`——与斜杠命令完全相同的动作——因此下拉与命令是同一动作、同一条日志记录。

### 两个界面显示什么

选择器显示当前模式的显示名，并列出其余健康的名册行，每行标注其模式类型；由会话项目层供应的模式带 `项目` 徽标。无名册部署或名册未加载时流程条不渲染任何内容。工作模式按序渲染流程步骤——已完成步骤实心圆点、当前步骤用强调色、未开始步骤弱化——当前步骤的标签与模型显示在流程条右簇、owner 线程传入的轨迹控件之后；首次声明前第一步读作当前。声明了 AI 集群的步骤在标签旁显示"集群"徽标。自由模式渲染"自由模式"徽标加已声明标签的轨迹。自由模式下，输入框的选择器旁多出一个"AI 集群"开关——一个座位形态、带分叉图标的按钮，显示宿主机计算的会话集群偏好，点击即执行 `/cluster on` 或 `/cluster off` 进行设置，开启时以强调色实心小片呈现。工作模式由各流程步骤分别声明集群，因此不渲染该开关。若所选模式被已组合的 skill-forge 入口认领，则什么都不切换：该入口打开「从对话创建」选择器，本会话保持原有模式。

### 失败

被拒绝的切换（命令的 error 结果）以短暂横幅提示；选择器标签来自宿主机计算的投影，因此总是弹回会话实际运行的模式。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

三个座位是 conversation 声明的 single slot（`conversation.input.mode`、`conversation.session.header.mode`、`conversation.session.flow`）；node 半边是空 apply（名册行）。两个选择器是同一组件、同一 inject 面——任一座座做出的切换就是另一座座随后显示的内容。读取走标准套件 `useProjection` 的通用投影对——当前模式与步骤轨迹都是折叠后的宿主机值，绝非客户端乐观。流程条额外读取 `modelSelection` 以把 `model: default` 步骤解析到会话当前模型，并把 owner 份额的 `trailing` 控件放进右簇；名册读取（每个界面挂载一次 `agentPresets.list`；当会话所属项目已知时改用 `agentPresets.rosterFor({ cwd })`，其行带来源层标记）提供流程声明与显示名。共享 inject 面携带 `loadRoster`、`switchMode`、`setCluster` 与 `openForge`；前两者通过 `ctx.remote.commands.execute` 执行 `/mode <id>` 与 `/cluster on`/`/cluster off`，并把 error 结果映射为横幅文案，而 `openForge` 通过 `ctx.get` 询问可选的 `skillForge` 服务：该入口认领所选 id 时直接返回，任何切换都不执行。输入框座位与标题栏座位是同一组件，区别仅在于输入框座位额外启用自由模式的 AI 集群开关——该开关是座位形态的图标按钮，其 `aria-pressed` 状态来自投影的 `cluster` 字段，走与斜杠命令同一条命令通道。

</details>

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过选择器派发的 `/mode` 命令行：`dsh-mode` 拥有模型可见的流程分段、`flow_step` schema、以及该命令行驱动的已记录状态。

#### KV Cache 效应

切换模式改变 persona 分段并因此改变请求前缀；选择器与流程条自身不增加任何提示词内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义当前的模式界面。它们是本包当前的约束，不是路线图。

- **流程条只读** —— 它只声明并可视化步骤；打断、改方向、逐步换模型尚未实现。
- **每次挂载读取一次名册** —— 界面打开期间新创作的 preset 要到下次挂载或会话切换才出现，非实时。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。模式状态与边界所有权由 dsh-mode 审计，两个控件都是 slot effect，其声明、注册与卸载由本包检验。
