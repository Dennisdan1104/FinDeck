# Agent Note：R9 流程系统一期——preset 名册之上的会话模式

Status: implemented

[English](2026-09-05-r9-flow-system-phase-one.md) | 中文

> AlphaDeck 工单 P1-4（需求 R9 一期）。记录会话模式为何走 preset 名册的 persona 机制而非新提示词路径，以及一期为何只做声明。

> **本笔记选择的切换机制已被取代**，见[模式切换会用目标 preset 重新组合会话](../bug-fix/2026-09-11-mode-switch-recomposes-the-preset.zh.md)：切换现在用目标 preset 组合该 agent。下文关于流程、`preset.yml` 模式声明与两个 UI 槽位的部分仍然成立；"只换 persona"的切换、`mode/switched` 与 `filePersonaConfig` 不再成立。

## 问题

AlphaDeck 会话由 agent preset 组合（`研究模式` 等），产品需要名册尚未提供的两项能力：会话中途切换到另一 preset 的模式且不丢历史（R9 会话内切换），以及展示流程驱动的会话当前走到哪（R9 只读流程可视化）。既有的组装切换（`agentPresets.select`）刻意只允许空白会话——对话中途调换工具会留下新组装无法执行的已记录工具调用——因此无法服务第一项；而第二项没有任何东西记录步骤进度。

## 决策

**模式是名册之上的已记录状态，不是组装变更。** 切换写入一条 `mode/switched` 事件，然后通过 `agent.ctx.systemPrompt.section` 把目标 preset 的 persona 分段重新注册进该 agent 的 scope——与挂载的 persona 行、`dsh-subagent` 的子 agent persona 是同一套 scoped 遮蔽机制。组装本身（工具、技能、沙箱）从不改变，这正是切换在会话开始之后依然合法的原因。resume 以同样方式恢复已记录的切换：`agent/created` 时，投影的模式不同于组合 preset，就从目标 preset 的组合文件（`filePersonaConfig`，`dsh-agent-presets` 新增）重新注册 persona。

**模式声明位于 `preset.yml` 中展示元数据旁边，但语义级而非展示级降级。** `dsh-agent-presets` 的 `mode.ts` 校验 `mode_kind: work|free`（缺省即 free）与 `flow.steps` 形状（kebab-case 唯一 id、非空 label、每步 `default` 或 `provider/model`）。`work` 无合法流程即在发现时判为损坏——名册行携带原因，所有挂载路径拒绝——因为没有流程的工作模式无法运行模式系统。`free` 携带流程判为矛盾而拒绝：该格式是为驱动工作模式机制而存在的，接受一个无人兑现的声明会教作者无视这个标记。

**步骤由模型声明、持久记录、为客户端折叠。** `mode:flow` 提示词分段（第一方序 100，`dsh-system-prompt` 新增 `MODE_FLOW` 槽位）列出工作流程与当前步骤，或在自由模式邀请简短自由标签。稳定的 `flow_step` 工具（所有模式保持注册，工具目录在切换间从不变化）按流程 id 校验工作模式声明并追加 `mode/step`；连续重复在 `mode` 投影中折叠，其 wire 视图 `{ mode, step, steps }` 由 Web 步骤条渲染。`agent-preset/selected`（空白会话重组）随模式重置轨迹。

**一期只做声明。** 没有步骤闸门、中途改向、逐步模型强制——按需求，流程是声明 + 可视化；打断、改向、逐步模型绑定随二期到来。每步的 `model` 字段已声明并展示（步骤条把 `default` 解析到会话的 `modelSelection` 投影）但尚未强制。

**UI 界面是两个 conversation slot。** `conversation.input.mode`（输入框模式选择器，在 plan 控件旁）与 `conversation.session.flow`（会话标题栏下的步骤条）由 `ui-conversation` 声明、新插件 `dsh-client-ui-mode` 占据。选择器通过共享命令通道执行 `/mode <id>`，下拉与斜杠命令是同一动作、同一条日志记录；两个界面都读宿主机计算的 `mode` 投影，绝非客户端乐观。

## 考虑过的备选

**复用 `agentPresets.select` 做会话内切换** —— 拒绝。其仅限空白会话的约定是承重的（已记录的工具调用必须保持可执行）；为 persona 级切换削弱它会把两种不同的保证耦合在一起。新的 `mode/switched` 事件保持组装切换不动，另加一个更弱的、明确提示词层的转换。

**为切换的 persona 新建提示词分段机制** —— 拒绝。`systemPrompt.section` 的 scoped 遮蔽已经精确做这件事；第二条路径会复制注册表的核心语义。

**从 turn/tool 事件推导步骤进度** —— 拒绝。从工具名推断"这是流程哪一步"是猜测，而模型可以直接陈述；显式声明更便宜、日志可审计、且因为活在投影折叠中而幸免于压缩。

## 后果

会话可在任意时点切换模式且历史完整；步骤条实时反映已声明的进度；resume 与 fork 都能恢复两者。模式切换从序 0 起改变系统提示词（切换身份的固有代价）。`dsh-mode` 包在 Web 组合中位于宿主机平面（紧邻它读取的名册），因此每个 preset 的会话都获得命令、工具与折叠——不限于工作模式。R11（定时任务绑定流程）现在可以引用流程格式；R9 二期在同一事件词汇表上扩展打断与引导。

## 验证

`packages/preset/mode/tests/mode.spec.ts` 在临时 preset 目录之上驱动真实插件栈：投影折叠、`/mode` 列表/切换/拒绝（未知、歧义、损坏）、persona 覆盖的安装/替换/恢复（resume 形态）、`mode:flow` 分段的工作/自由/缺失三臂、`flow_step` 校验与幂等、HMR 卸载。`packages/client/ui-mode/tests/components.client.spec.tsx` 在投影桩上渲染两个界面：名册过滤、切换派发与拒绝弹回、步骤条的完成/当前/未开始三态与逐步模型、自由模式轨迹。`packages/preset/agent-presets/tests` 覆盖发现时模式声明的接受/拒绝形状与随附的五步研究流程。
