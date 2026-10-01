---
description: "FinDeck 红蓝对抗审查：rbcheck settings 命名空间下的可编辑红蓝提示词、人类运行的 /rb-check 命令、以及 agent 自己调用的 rb_check 工具——先红后蓝，结论回写。"
kind: "package-reference"
---

# @deepseek-ai/dsh-redblue

[English](README.md) | 中文

## 概述

`dsh-redblue` 是红蓝对抗审查：它注册 `rbcheck` settings 命名空间——存放用户可编辑的红队（攻击方）与蓝队（辩护方）提示词——人类运行的 `/rb-check <报告路径|命题id>` 命令，以及 agent 自己调用的 `rb_check` 工具。两个入口注入同一条结构化指令，按序携带两份提示词——先红、后蓝，再是回写步骤——由所属会话的模型在一次运行中顺序完成各阶段；工具的注入在调用 agent 的下一个 step 边界生效，因此审查延续请求它的同一个回合。两份提示词都由 store 支撑并带出厂默认值，因此「恢复默认」就是写入空串。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在具备 `ctx.settings`、`ctx.commands` 与 `ctx.tools` 的组合中挂载本插件。当目标为命题 id 时，回写步骤复用 `thesis_mark`，因此该路径需同时挂载 `tool-thesis`。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-redblue'
```

无插件配置。提示词是 `rbcheck` 下的用户设置：

| 字段 | 默认 | 含义 |
|---|---|---|
| `redPrompt` | 出厂红队契约 | 作为第一阶段注入；空值表示「使用默认」。 |
| `bluePrompt` | 出厂蓝队契约 | 作为第二阶段注入；空值表示「使用默认」。 |

### 命令做什么

`/rb-check <报告路径|命题id>` 接收一个参数，指明受审的交付物。处理函数解析已存提示词（空即默认），注入一条 `system-reminder` 消息，包含目标、红队阶段、蓝队阶段与回写步骤；模型随后按序执行各阶段，把结论追加到报告的「红蓝队检查」小节；目标为命题 id 时改用 `thesis_mark` 记录。参数为空则返回用法错误，不注入任何内容。

### 可观察的成功与失败

命令返回一条点名目标的成功行，或对空参数返回用法错误。`rb_check` 工具接收一个 `target` 参数并返回 `{ target, queued }`——指令在调用 agent 的下一步到达，模型先完成两个阶段再做其他工作；空目标或非 agent 调用方会被拒绝。非法的 `rbcheck` 值在注册时由 settings schema 拒绝；模型阶段失败经普通会话流呈现，用户可随时打断该次运行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包就是一个插件主体：它以出厂提示词为 settings 基底注册 `rbcheck` scope，并注册 `/rb-check` 命令，其处理函数用 `buildRbCheckInstruction` 组合指令（该函数导出为纯函数，供测试与复用共享同一份文本）。编排刻意留给会话：命令只注入一条消息便返回，因此各阶段在会话日志里就是可引导、可打断的普通模型工作。

### 源码地图

- `src/index.ts`——`rbcheck` schema 与默认值、`buildRbCheckInstruction`，以及命令注册。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-thesis)——目标为命题时回写步骤所用的 `thesis_mark` schema。
- [配置目录](../../../docs/config-catalog.zh.md)——`rbcheck` 命名空间在设置界面中的呈现方式。

-----

<a id="model-experience"></a>
## 模型体验

### `/rb-check` 指令

#### 模型看到什么

一条注入的用户消息（`system-reminder`），携带整份审查契约：目标、红队提示词、蓝队提示词，以及编号的回写步骤。

#### Token 影响

成本随两份提示词长度增长；出厂默认各约十行，存储的覆盖值会逐字替换它们。

#### KV Cache 影响

该消息作为普通用户输入追加在可复用的请求前缀之后，因此一次检查不会扰动可缓存前缀。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- **只走一轮**——每个入口只注入一次红队再蓝队；辩护之后不会自动再攻，第二次审查要再发一次 `/rb-check` 或 `rb_check`。
- **提示词是全局的**——`rbcheck` 命名空间只有一份提示词对，改动作用于每次检查，而非按预设或按会话。
- **各阶段由模型执行**——本包注入的是指令而不是被强制的流水线；模型若跳过蓝队阶段或回写，只会得到一份简短转录，而不是拒绝执行。
- **回写目标是文本**——报告小节由模型追加；除模型写入的内容外，没有针对单个攻击点的结构化记录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

命令只注入一条消息便返回，因此各阶段是用户可引导、可打断的普通已记录模型工作。`buildRbCheckInstruction` 导出为纯函数，测试据此固定注入的精确文本。

</details>
