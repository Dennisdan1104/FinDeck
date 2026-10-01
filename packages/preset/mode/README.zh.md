---
description: "会话模式：面向需要在中途切换会话 preset、驱动工作模式流程、读取步骤轨迹的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mode

[English](README.md) | 中文

## 概述

`dsh-mode` 在 agent-preset 名册之上叠加会话模式：会话从其组合 preset 的模式起步，你可以就地切换——`/mode <preset>` 或输入框的模式控件——切换会用目标 preset 重新组合该 agent：它的工具、技能、提示词分段、persona，以及位于其自身 realm 之后的那些行，从下一步起取代上一个 preset 的。会话日志本身不动，因此历史、上下文与转录在切换后完整保留。切换记录 `agent-preset/selected`——与空白会话选定 preset 写下的是同一事实——因此 resume 会重建会话真正运行过的组合。工作模式额外携带一份声明于 preset `preset.yml` 的流程；`mode:flow` 提示词分段告知模型各步骤与当前步骤，稳定的 `flow_step` 工具把模型的步骤声明记入会话日志。`mode` 投影把这一切折叠给客户端：当前模式加上已声明的步骤轨迹。本插件自身的行——投影、`mode:flow` 分段、`flow_step` 工具与 `/mode` 命令——位于 host 组合，因此比任何一次切换都长寿；被切换替换的是 preset 的行。一期只做声明——流程是可见性加上模型自身的纪律，不是闸门。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

凡组合了 `dsh-agent-presets`、且会话需要可切换或流程可见的地方，挂载本包。它自身没有配置项；读到的一切都来自名册。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-mode'
```

本包注入 `tools`、`systemPrompt`、`sessionProjections` 与 `agentPresets`，没有名册的组合在加载时即失败，而不是等到首次使用。

### 切换模式

输入 `/mode` 列出名册与当前模式，或 `/mode <preset>` 切换：接受精确 id、精确显示名、或二者之一的唯一前缀。切换用目标 preset 重新组合该 agent——它的工具、技能、提示词分段、persona，以及位于其自身 realm 之后的行——因此会话从下一步起就运行在该 preset 上。随后记录 `agent-preset/selected`，并注入一条转录会渲染的单行提示。会话日志本身不动：历史、上下文与先前每一次工具调用都保留，resume 会重建会话真正运行过的组合，而不是创建 header 里那个。组合无法挂载的 preset 会整体拒绝这次切换，命令会说明原因，而 agent 继续运行原来的 preset。

切换不是会话重置，会话级状态因此原样穿过它：会话写过的 todo 清单一字不动，两个方向都如此，因为每一次 `todo/write` 都是已提交的会话事件，而不是按 preset 存放的状态。随附的每个 preset 都挂载 todo 工具，所以切换也不会把进度显示拿走——自由模式只是在其模型自己写出列表之前什么都不显示。变的是组合：下一步装配出的工具目录与提示词段落属于目标 preset。

### 工作模式流程

preset 在 `preset.yml` 中声明模式分类：

```yaml
mode_kind: work        # work = flow required | free = lightweight/discussion
flow:
  steps:
    - id: plan
      label: 规划      # the display name, localized by the preset author
      model: default   # default follows the session model, or provider/model
      prompt: |-       # optional: what this step does, in the model's instructions
        拆解问题，写出假设。
        确认数据口径。
```

`mode_kind: work` 没有合法 `flow` 即在发现时判为损坏——名册行携带原因，所有挂载路径拒绝之。`free`（或未声明）的 preset 无流程义务、豁免此要求。工作模式生效期间，`mode:flow` 提示词分段列出步骤与当前步骤，并指示模型在每步开始时调用 `flow_step`；自由模式下该分段改为邀请简短的自由标签。声明落地为 `mode/step` 事件；连续重复会折叠掉。

步骤的 `prompt` 会追加在该步骤条目之下、与条目对齐缩进，于是「这一步是为了什么」就写在模型读到流程的地方。它是对 agent 既有指令的补充而非替换，也从不进入 `flow_step` 的结果：一次声明只回答步骤的 id、标签与模型，因为用途是指令文本而不是步骤数据。

声明 `cluster` 的步骤由 AI 集群执行而非单个模型，流程分段也照此呈现：该步骤行带 ` · cluster: <strategy>` 后缀；只声明视角时带 ` · cluster: <N> perspectives`；两者都没有时只带 ` · cluster`。在该步骤声明的用途之后（未声明用途则直接在条目之后）缩进一行，指示模型用 `cluster_run` 工具执行这一步，并把该步骤的任务文本作为它的 task 参数。结尾的 `flow_step` 指引不变。

### 会话级集群偏好

`/cluster` 开关本会话的 AI 集群偏好：不带参数即取反，`on`、`off` 为显式设置。该偏好是软性的，且比模式切换长寿——没有任何闸门，也没有哪个 preset 必须挂载集群工具。开启期间，`mode:flow` 分段末尾多出一行，请模型在任务受益于多个独立视角时优先使用 `cluster_run`，单趟足够时跳过。自由模式无论偏好开关都固定带一行，说明只要组合让集群工具可用，用不用由模型自己决定；工作模式的步骤清单与它自身的 cluster 步骤指引保持不变。设置与当前生效值相同的取值不写任何事件，因此重复调用不会增长日志。

### 观察模式状态

界面读取 `mode` 投影：`{ mode, step, steps, cluster }`——生效的 preset id、当前步骤（最后一次声明，首次声明前为 null）、按序的已声明轨迹、以及本会话的 AI 集群偏好（未开启前为 false）。投影仅从日志折叠，因此 resume 与 fork 都能恢复。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

本节解释包背后的设计决策并指向实现代码；可观察行为完全由[使用本包](#use-this-package)覆盖。

### 设计哲学

模式是名册之上的已记录状态，与 plan mode 同一立场：组合切换先提交，随后一条 log-only 全量事件记录它（`agent-preset/selected`，随模式重置轨迹），绝无活镜像，resume 与 fork 靠按日志重新组合恢复。

### 切换即换组合

切换通过 `dsh-agent-presets` 的 `recompose` 用目标 preset 重新组合该 agent：名册把 agent 的 scope 重挂到该 preset 的 standing mount 上，于是整层继承——工具注册、技能根、提示词分段、preset 自己的 persona、realm 持有的服务——从之后每一次组装起都属于目标 preset。没有任何东西被拆掉：上一个 preset 的 standing mount 仍被继续运行它的会话共用，agent 自己的 scope 保留其历史、会话日志与注册。随之发出的 `tools/change` 让 Agent 持有的浮层与客户端缓存得以对齐。`agent/created` 时同一操作修复"日志写明的模式与所组合的 preset 不一致"的会话——即组合切换落地之前写下的切换。监听器会 await 该修复，使更正后的组合在首次组装前就位，并自吞其失败：修复失败绝不能让会话失去它的 agent，失败的修复会保留 agent 创建时所用的组合。

### flow_step 工具

`flow_step` 工具由本插件注册，而本插件位于 host 组合，因此它比任何一次切换都长寿；被切换替换的是 preset 自己的工具行。工作模式声明按流程 id 校验，越界即携带合法清单拒绝；自由模式声明接受任何非空标签。重复声明当前步骤幂等——轨迹每个真实步骤只留一条。

### 会话投影单元

`mode` 单元把 `agent-preset/selected`（组合事实：空白会话的选定与中途切换都写它）与 `mode/switched`（组合切换落地之前的构建写下的旧记录）折叠为模式并重置轨迹，把 `mode/step` 折叠进轨迹；两条改写模式的分支都原样保留集群偏好，而 `mode/cluster` 整体替换它。wire 视图把 `step` 取为轨迹末项。`stateVersion` 为 2：新增的 `cluster` 字段会让旧的持久化行无法通过严格状态 schema，因此提升版本会丢弃这些行并从 `init` 重新折叠——即集群出现之前该偏好恒为关闭的取值。键从 [`src/types.ts`](src/types.ts) 合并进 `SessionProjectionMap`。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`ctx.modes` 服务、`mode` 投影、`mode:flow` 分段、`/mode` 与 `/cluster` 命令、`flow_step` 工具 |
| [`src/types.ts`](src/types.ts) | `mode` 投影键声明与 `ModeProjection` wire 值 |
| [`src/client.ts`](src/client.ts) | 类型出口的 client 命名空间再导出 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 模式流程系统提示词

#### 模型看到什么

工作模式在第一方序 100 贡献 `mode:flow` 分段：有序步骤、当前步骤及其位置、以及开始一步时调用 `flow_step` 的指示。自由模式改为贡献自由标签邀请，并固定以一行收尾：只要本会话的组合让 `cluster_run` 工具可用，用不用由模型自己决定。AI 集群偏好已开启的会话，两种形态都会在末尾再加一行，请模型在任务受益于多个独立视角时优先使用 `cluster_run`，单趟足够时跳过。无模式生效（无名册部署）不贡献任何内容。

##### Example (research mode, before the first step)

```markdown
You are running inside a multi-step workflow. The flow, in order:
1. 规划 (plan)
2. 取数 (fetch-data)
3. 分析建模 (analyze-model)
4. 验证 (validate) · cluster: synthesize
   Run this step with the cluster_run tool: pass this step's task as its task argument.
5. 报告 (report)
No step has been declared yet. Begin with step 1, 规划 (plan).
Call the flow_step tool with a step id each time you BEGIN a step, including the first. The declaration only updates the user's progress view; it does not interrupt your work.
```

#### Token 效应

分段出现在该模式的每个请求中；在一个步骤内短小而稳定。集群偏好开启期间多一行，直到 `/cluster off`。

#### KV Cache 效应

分段在模式内稳定；模式切换从序 0（persona）起改变系统提示词，这是切换身份的固有代价。

### flow_step 工具

#### 模型看到什么

稳定的 `flow_step` schema，一个必填 `step` 字符串参数。工作模式下越界调用携带合法清单失败；重复当前步骤正常返回且不新增日志事件。

#### Token 效应

每次声明是会话历史中的一次工具调用。

#### KV Cache 效应

声明正常延长会话。组合切换从下一步起替换请求的工具块与提示词分段，因此切换之前的一切都是缓存未命中，之后的一切在新 preset 下重新缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制描述会话模式何时不按预期表现、或需要额外注意。它们是本包当前的约束，不是路线图。

- **仅声明式** —— 流程是可见性加上模型自身的纪律；没有任何步骤闸门、中途改向、逐步模型强制。打断与引导尚未实现。
- **切换会移动整个组合** —— 目标 preset 的工具、技能、提示词分段与 persona 从下一步起取代上一个 preset 的，请求缓存也会因新的工具块失效。切换落地时已经发出请求的那一步，仍持有它被调用时的工具。
- **流程分段从缓存的名册行渲染** —— 会话启动后的首次组装可能在名册读取落地前折叠，到下一次组装前不贡献分段。
- **自由模式标签是未校验的散文** —— 只有工作模式步骤 id 按流程校验；自由模式轨迹就是模型声明的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
