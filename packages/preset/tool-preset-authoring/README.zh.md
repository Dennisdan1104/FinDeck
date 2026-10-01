---
description: "面向模型的会话模式创作：列出模式清单，然后新建或改写某个模式的显示文案与流程步骤，全程不碰它的插件挂载清单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-preset-authoring

[English](README.md) | 中文

## 概述

会话模式是预设「可创作的那一半」：显示名、描述，以及工作模式的流程步骤。本包给模型两个工具。`mode_list` 返回模式清单与每个模式的步骤；`mode_write` 通过复制一个既有预设、只替换它的 `preset.yml` 来新建模式，或改写用户自有的模式。另一半——会话挂载哪些插件——从不越过这条缝，所以用这些工具写出的模式不可能给会话带来源预设本来没有的能力。之所以需要工具，是因为手写的模式没有校验、也没有反馈：不是 kebab-case 的步骤 id、既不是 `default` 也不是 `provider/model` 的模型、声明了 work 却没有步骤，都会产出 discovery 判定为 broken 的预设。这里每一次写入都走 discovery 用的同一套规则。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把这一行挂到「需要创作模式」的预设组合里——随包发布的 `cordis` 预设就是这样一个。它读取 `ctx.tools` 与宿主的 `ctx.agentPresets` 清单；自身不提供任何服务，也没有配置项。

```yaml
- id: tool-preset-authoring
  name: '@deepseek-ai/dsh-tool-preset-authoring'
```

### 何时选它

当用户想逐步塑造 agent 的工作方式、否则只能手改 `preset.yml` 时用它。只是跑一个既有模式的会话没有东西可写；只有请求本身是「新建或修改模式」时这两个工具才会被用到。

### 模型得到什么

- `mode_list` —— 每个可组合预设的 id、显示名、trust、描述，以及按顺序排列的步骤（`id`、`label`、`model`、该步骤声明的用途，以及它携带的 `cluster` 声明）。`trust: user` 标出可被写入的模式。
- `mode_write` —— 新建（给 `from`，即被复制挂载清单的源预设）或改写（给模式自己的 `id`）。调用里省略的字段保留已存值，`steps` 例外：它整体替换。步骤的 `model` 默认 `default`；给了 `prompt` 就并入模型的常驻指令，该会话此后每次请求都会读到，而不只是那一步开始时。步骤还可以声明 `cluster`，由 AI 集群执行该步骤：`perspectives` 给出 2–8 个成员视角（省略则用执行器的默认组合），`strategy` 为 `synthesize` 或 `vote`（省略即 `synthesize`）。

### 可观察的成功与失败

写入成功的应答是清单此刻真正解析出的内容——id、名称、步骤——并说明这次是新建还是更新。每一种拒绝都点名它的规则：非 kebab-case 的 id、已被占用的 id、声明 work 却没有步骤、模型既不是 `default` 也不是 `provider/model`、模型带控制字符、空白的 prompt、`kind` 不在 `work` 与 `free` 之内、不存在的复制源（`agent-preset/not-found`）、以及随部署发布或位于部署可写根目录之外的预设（`agent-preset/read-only`）。被拒绝的写入不会留下任何目录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 设计要点

这两个工具是清单服务上的薄消费者：每次写入都走 `AgentPresets.save`，它用 discovery 的同一套规则校验流程；新建时整目录复制既有预设，两条路径都只写 `preset.yml`。写完之后重新读一遍清单（而不是回显请求），才能保证应答就是新会话真正会跑的那个模式。

### 源码地图

- `src/index.ts` —— 两个工具的注册、工具参数到写入请求的翻译，以及清单渲染。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [agent-presets 包](../agent-presets/README.zh.md) —— 清单、模式声明，以及它拥有的创作写入。
- [mode 包](../mode/README.zh.md) —— 声明出的流程在运行期驱动什么：流程提示段、`flow_step`、步骤轨迹。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-preset-authoring) —— 两个工具的生成式 schema 参考。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`mode_list` / `mode_write` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-preset-authoring)，其中 `mode_write` 明确写着：模式是会话「步骤是什么」，不是「挂载哪些插件」。

#### Token 影响

在挂载了这一行的预设里，可见时每次请求都有固定的 schema 开销。

#### KV Cache 影响

工具定义与可见性不变时前缀稳定。

### 工具结果与错误

#### 模型看到什么

`mode_list` 每个模式渲染一行，工作模式的步骤缩进列在其下。`mode_write` 渲染刚刚存下的内容、按序的步骤，以及「挂载清单未被改动」的说明。被拒绝的调用渲染拒绝它的那条校验规则。

#### Token 影响

开销随模式数量与每个步骤用途文本的长度增长；一次写入只增加它自己的结果。

#### KV Cache 影响

追加式；新可见的结果跟在可复用的请求前缀之后。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了这两个工具何时不合适。它们是本包当前的约束，不是待办清单。

- **改写会替换整份步骤表** —— 没有「改一步」的操作，所以改一个步骤要重述所有步骤；`mode_list` 就是让这件事可负担的手段。
- **新建整体复制一个预设的挂载清单** —— 在服务层与本层都没有「standard 加一行插件」这种表达。
- **随部署发布的模式一律拒绝** —— 只有用户预设可写，所以从 `standard` 派生的模式会保留源预设的挂载清单，且永远改不了它。
- **写入不会重新组合正在运行的会话** —— 已经组合好的会话保持启动时的插件挂载清单，只有之后新建的会话才会解析到新清单；声明的步骤则不同，因为 `flow_step` 会重新读取清单，所以被改写的流程会在该会话下一次声明步骤时到达它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
