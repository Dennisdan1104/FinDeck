# Agent Note：模式切换会用目标 preset 重新组合会话

Status: implemented

[English](2026-09-11-mode-switch-recomposes-the-preset.md) | 中文

> 取代 [R9 流程系统一期](2026-09-05-r9-flow-system-phase-one.md) 的切换机制：那份笔记选择的"只换 persona"被真正的组合切换替代。

## Problem

`dsh-mode` 把会话内切换实现为 persona 替换：写一条 `mode/switched`，把目标 preset 的 persona 重新注册进 agent 的 scope，组合本身不动。于是活着的会话可能一边拿着描述某个 preset 能力的提示词，一边跑着另一个 preset 的插件。一个在 `standard`（研究模式）创建、随后切到 `cordis`（创造模式）的会话，会拿到 Cordis 的 persona——"Load the `editing-cordis-compositions` skill before writing or changing a composition"、"Use the `mode_list` and `mode_write` tools for it"——可它的技能目录里只有 finance 技能，工具目录里两个创作工具一个都没有。`skill` 回答 `Error: skill "editing-cordis-compositions" is unknown or no longer available`，这正是未知名字应得的护栏；而 `mode_write` 根本没有工具能应答。

## Decision

**模式切换用目标 preset 重新组合该 agent。** `ModeController.switch` 调用 `agentPresets.recompose(agent.ctx, preset.id)`，由名册把 agent 的 scope 重挂到目标 preset 的 standing mount 上，之后才记录事实并注入提示。工具、技能根、提示词分段、persona 与 realm 持有的服务，从下一步起都属于目标 preset。`dsh-agent-presets` 早已为空白会话持有这一操作（`select`）；模式切换是同一操作换了一道闸门——空白会话锁仍是 preset 选择器的契约，而用户的模式手势在对话开始之后依然合法。

**切换记录的是 `agent-preset/selected`，不是模式层事件。** 那正是 resume 用来重建组合的事实（`dsh-agent-presets` 的 `agentPreset` 投影），于是一个切换过的会话会恢复在它真正运行过的 preset 上，而不是创建 header 那个。`mode` 投影本来就折叠它，因此步骤轨迹以同样方式重置。`mode/switched` 保持声明并被折叠，因为已发布的日志里带着它。

**persona 覆盖那条路彻底移除。** `filePersonaConfig`、按会话保存覆盖的注册表、以及 `agent/created` 时的 persona 重注册全部删除：会话显示的 persona 只来自其组合自己的 persona 行。`applyLoggedMode` 保留为修复路径，且改为重新组合而非遮蔽——当 resume 的会话其投影写明的模式与创建时的组合不符（即 persona 时代写下的日志），它执行那条日志所描述的组合切换。

**组合先提交，记录后落。** 目标组合无法挂载时，`recompose` 会在任何持久写入之前抛出；`agent-preset/selected` 追加失败时会把上一个 preset 组合回来，因此日志与正在运行的组合不会互相矛盾。`/mode` 把挂载失败报告为命令错误，而不是让命令死于异常。

## Alternatives considered

**会话已开始就拒绝切换** —— 否决。那是 `select` 的空白会话契约，对 preset 选择器正确，对模式手势错误：模式手势的存在意义就是移动一个活着的会话。

**把重新组合推迟到下一个 turn 边界** —— 否决。工具块与提示词分段是逐步组装的，所以步与步之间的切换本就落在安全点上；再推迟只会让用户选定的模式与正在运行的能力整整一个 turn 都对不上。

**对无法挂载的组合保留 persona 覆盖作为兜底** —— 否决。那恰好把要消除的错配请回来：一份宣称会话并不具备的能力的提示词。

## Consequences

- 对话中途切换的会话保留其日志、历史与先前的每一次工具调用；之后每一步都运行目标 preset。切换落地时已经发出请求的那一步，仍持有它被调用时的工具。
- 会话级状态不属于组合：会话写过的 todo 清单原样穿过切换，因为每一次 `todo/write` 都是已提交的会话事件，而随附的每个 preset 都挂载 todo 工具。轮次边界也不会让这份清单退役，因此切换后立着的那块进度面板，就是会话继续持有的那一块。
- 请求的 KV 缓存会在切换处失效，因为工具块变了。
- AlphaDeck 模式名册的四个条目现在是四个真正不同的 agent：创造模式交付 Cordis 工具集与其组合技能，极简模式交付它的 shell + 编辑器组合（外加每个模式都挂的 todo 清单），深研模式交付它自己的。
- `ui-skill` 的目录失效与 `ui-commands` 的目录重置本就绑定在转发的 `agent-preset/selected` 事件上，现在模式切换也会触发它们，因此切换后的会话读到的是新组合的技能目录。
- 挂载完整 persona（`complete: true`，minimal）的 preset，只在自己的组合真正挂载时应用那份完整提示词——这正是该标志当初写下时的前提。

## Verification

切换后的组合无需任何模型请求即可端到端观察：一个研究模式会话在输入框的 `/` 菜单里列出十个 finance 技能；用标题栏的模式控件切到创造模式后，会话日志追加 `agent-preset/selected: cordis`，同一个菜单随即列出那十个再加上 `cordis-plugin-development` 与 `editing-cordis-compositions`。

## Related

- [R9 流程系统一期](2026-09-05-r9-flow-system-phase-one.md) —— 持有本笔记保留的流程系统，以及本笔记取代的"只换 persona"切换。
