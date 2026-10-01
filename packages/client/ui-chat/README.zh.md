---
description: "渲染 Session 对话节点、详情、历史图片、操作、本地化和滚动状态的浏览器 Chat target。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-chat

[English](README.md) | 中文

## 概述

Conversation 组装的浏览器 Chat target。本包注册 Chat event definition 与 snapshot 构造、提供 `useChat`、渲染 transcript node 和详情，并拥有 Chat 专属 store、action、本地化与滚动位置恢复；历史图片 URL 通过 Conversation 持有的按会话缓存（`ctx.uiConversation.imageUrl`）解析。其中 Assistant 与 Turn Tail definition 会直接 fold packed Assistant 历史 run，不展开其成员。`developer-message` definition 与 `input-message` 共用上下文展示，因此增量工具集变化渲染为上下文行而不是未知行。steering 分类通过持久 splice state 只保留 next-step Inbox ID；next-turn splice 不创建 Chat Context。本地提交回显（`SessionSnapshot.pendingSubmissions`）保留提交开始时选定的区域：transcript 回显位于消息流末尾，steering 回显带 pending-steering 标记，queued 回显不进入 Chat。一旦 user/steering 节点或 queue occurrence 携带回显的 prompt `rpcId`，该回显即在同一渲染中隐藏，因此交接是原子的。

## 目录

- [系统提示词行](#system-prompt-row)
- [轮次 token 用量](#turn-token-usage)
- [轮次过程折叠](#turn-process-folding)
- [滚动归属](#scroll-ownership)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="system-prompt-row"></a>
## 系统提示词行

Chat 会为每个非空的初始或恢复请求、显式消息序列起点或真实 system 字段变化显示一行默认折叠的`系统提示词`。同一序列内仅配置或仅工具变化、工具步骤与重试不会重复该行。该行位于请求的用户消息之前，与提供方 envelope 顺序一致；展开后显示保留原始换行的精确模型可见文本。序列内部追加的 `system/message` 在该位置拥有自己的卡片，标题为`系统提示词更新`。历史窗口不完整时，非初始 header 会保守显示，直到前一页到达；没有系统提示词的 header 不创建该行。

-----

<a id="turn-token-usage"></a>
## 轮次 token 用量

只有当已加载窗口包含 `turn/start`，且每次已启动的模型尝试都报告安全、精确的用量时，已完成 Turn 才显示可展开的用量行。该行会省略不可用的可选用量桶。记账不完整或相互矛盾时，整个详情都不显示，避免把部分总量冒充完整结果。

-----

<a id="turn-process-folding"></a>
## 轮次过程折叠

「设置 → 通用设置」提供持久化到 `ui-chat` 命名空间的四档对话显示偏好，默认使用 `Standard`。[presentation-policy.ts](src/client/presentation-policy.ts) 把该持久值翻译为单一呈现策略——整轮折叠、步骤分组、实时过程详情与已结算推理预览——每个 seat 与 renderer 只选择策略中的单个字段，不再比较模式枚举：

| 模式 | 整轮折叠 | 步骤分组 | 实时过程详情 |
|---|---|---|---|
| `Compact` | 是 | 收起式 | 否 |
| `Standard` | 是 | 收起式 | 是 |
| `Detailed` | 是 | 仅收起已结束轮次，历史轮次分组 | 是 |
| `Verbose` | 否 | 不分组 | 否 |

旧三档偏好的持久值仍然通过校验，并按当前档位读入：`compact` 保留原名与原义，`grouped` 读作 `standard`、`normal` 读作 `verbose`、`expanded` 读作 `detailed`，由 [chat-settings.ts](src/chat-settings.ts) 中的 `LEGACY_FORK_MODE_MAP` 在内存中应用——只有读者下一次主动选择时，持久键才会改成当前档位。Verbose 保持所有过程行可见且不渲染轮次过程控件；每个 reasoning 块渲染为一条安静的「思考」行：默认收起，并保留读者自己的展开选择，外层 Turn 折叠时复位。Compact 模式下，系统提示词在整个轮次中始终独立显示于开场 User 上方。轮次打开期间，上下文注入、推理、Assistant 内容、工具行与重试行始终展开。到 `turn/end` 时，最后一个步骤只有在包含非空文本、图片或未知可见块且不含工具调用块时才成为最终正文边界；边界之前的上下文注入、推理、较早 Assistant 内容、工具行与重试行随后默认收起。控件展示覆盖整个轮次的非 subagent 工具调用数、最终正文之前带回复内容的 Assistant 消息数和 subagent 委派数；值为 0 的分段省略，工具调用与 subagent 两项互斥，系统提示词与上下文注入都不增加计数。三项全为 0 时过程仍会收起，控件标题显示「已思考」（英文为 `Thought for a while`）。过程行不再有边框、背景或分隔线：该轮过程读起来就是消息流的一部分，每一行统一使用第三级灰色文字与三级字号（比二级字号再低一档）。用户与 steering 消息、系统提示词、错误、最大 token 与 turn-tail 行留在过程组外；关闭时没有最终正文的轮次保留全部过程证据。新的过程控件插入时不会改变既有行的相对顺序：开场人工输入从首次投影起便位于控件和过程行之前，系统提示词则始终位于该输入上方。只要仍可通过「加载更早」获取历史，过程控件就不出现，也不会隐藏任何成员；历史加载完整后，每个合格的已关闭轮次立即使用默认收起状态。稳定 Chat Node Seat 会让每个 renderer 保持挂载，隐藏成员不产生消息流间距；只有中间没有独立输入时，收起控件才与正文相隔 8px。完成后的收起不依赖是否跟随尾部，因此正在上方阅读的用户可能看到 transcript 高度变化。若自动收起会隐藏当前键盘焦点，则过程组保持展开且焦点留在原处；手动收起会先把焦点移到过程控件，再隐藏成员。Grouped 模式不再给每一轮套一个大容器，而是把过程按时间顺序作为安静的小字行交错进该轮自己的叙述里：轮次过程区最前面是合并上下文注入的收起行，Assistant 消息里每段 reasoning 各一行「思考过程」，每一段连续的工具调用聚合成一行动作行。计数按工具名聚合为浏览、网页搜索、网页打开、命令执行、文件修改、子任务委派与其他七类，并将各分段拼接为一行。`write` 与 `edit` 调用在其动作行的成员列表里渲染为携带参数推导新增/删除行数的路径芯片，`bash` 与 `pwsh` 调用渲染为成员行、展开后是终端块——代码块底色上第一行 `$` 命令、下面是输出——两类都不会重复出现；参数尚未完整的调用保留自己的行。每个成员行都是三级灰单行文本、超出即省略号截断，工具行以该次调用的状态字符开头——`✓` 已完成、`⟳` 进行中、`✗` 失败——不再使用彩色徽章。其他成员继续使用各自的渲染器。每条安静行都是 12px 三级灰的单行文本，行尾一个开合三角，无边框、无背景、无图标；相邻行相距 4px，与叙述正文相距 8px，整块唯一的主色是尚未结束的行上的「进行中」。过程区里的每个折叠都是同一个原语——段行、思考行、动作行与上下文行只在变体与文案上有差别——所以任何折叠的三角收起时都朝右、展开时都朝下，折叠后的正文一律缩进在自己的标题之下、共用一条左侧细线，并以 `hidden="until-found"` 隐藏。唯一默认展开的是仍在执行的那个动作行，它在该段动作结束后自动收成纯摘要行；展开后的成员列表缩进 12px 并带 1px 左侧细线。在这些行之上，该轮已声明的步骤会再折一层：每次 `flow_step` 声明开出一个段，标题就是步骤条上显示的步骤名——声明里只有步骤 id，所以段行经 presets remote 读模式名册取回 label；没有声明步骤的轮次改用 todo 清单，进入「进行中」的那一项作为段标题，直到它离开进行中。段是一个容器：落在它边界内的一切都按原顺序渲染在它的段体里——思考行、动作行、Assistant 的叙述正文都在其中，该轮的上下文注入永远合并为那唯一的上下文行（一条还是十条都一样），并领在第一个段的最前面——整体缩进在段行之下并带一条左侧细线。收起段就把这一整段过程带走；两个例外留在折叠之外：第一条声明之前的开场内容，以及已结束轮次收尾的回答正文（任何折叠都不得把它藏起来）。段行是唯一更重的一行——墨色标题、进行中与已完成的状态字符用主色蓝、后面跟上该段各动作行的聚合计数。两者都没有的轮次保持平铺的安静行。过程计划是 Grouped transcript 唯一的渲染来源：只加载了一部分窗口的轮次与加载完整的轮次走同一批行，因此任何上下文注入都不会单独成行，历史到达时读者眼前的层级也不会改变。会话作用域 store 按行记录用户的显式展开选择且不再移除，因此运行期间被用户收起的行保持收起；Compact 控件直接读取对应选择（[折叠决策](../../../.agents/notes/implemented/feature/2026-08-14-web-turn-process-folding.zh.md)，[排序决策](../../../.agents/notes/implemented/bug-fix/2026-08-26-stable-turn-process-order.zh.md)）。

-----

<a id="scroll-ownership"></a>
## 滚动归属

Chat 会在历史前插与 renderer 重新挂载时恢复语义锚点。读者跟随底部时，`ResizeObserver` 追随新的底部，并且无需读取行几何就选中最后一个已加载 Turn；读者离开底部后，高度变化会保持顶部位置，再由阅读线几何选择活跃 Turn。轮次导航预览位于 Markdown 代码块粘性头栏上方，而导航外框始终处于 composer 上方的 transcript 区域内（[已加载 Turn 导航](../../../.agents/notes/implemented/feature/2026-08-25-loaded-turn-chat-navigation.zh.md)）。

在分组显示模式下，过程组正文本身就是一个滚动容器，封顶为 `min(400px, 50vh)` 并带 `scrollbar-gutter: stable`；[ChatGroupSeat.tsx](src/client/chat/ChatGroupSeat.tsx) 标出两个滚动边缘，[ChatGroupSeat.module.css](src/client/chat/ChatGroupSeat.module.css) 据此只在仍有内容可滚到的方向做上下遮罩渐隐。非分组显示模式改为在组根上标记 `data-group-expanded-mode`，该标记会一并去掉封顶、渐隐，以及组控制器拥有的全部观察与动画。

[use-scroll-follow.ts](src/client/chat/use-scroll-follow.ts) 提供各自独立的控制器，共用触底阈值判断、跟随意图与原生滚动实现；[use-process-scroll.ts](src/client/chat/use-process-scroll.ts) 负责组内观察、初始定位与边缘渐隐。打开时，轮次仍未结束的组定位到底部，已闭合的组定位到顶部，且该定位始终保持即时。组内滚轮、touchstart 与任意 pointerdown 都会中断进行中的平滑动画，包括按在工具卡片上的操作；ArrowUp/ArrowDown、PageUp/PageDown、Home/End 与空格键同样会中断动画，除非子元素已阻止该按键的默认行为；可编辑控件不排除在外。中断不需要任何滚动位移，之后的采样位置决定是否继续跟随。组内增长使用原生平滑滚动，减少动态效果偏好开启时改为即时滚动：增长会保留进行中的目标直到 `scrollend`；到达该目标或内容缩短后被钳制的位置后，再追随最新底部；停在其他位置则释放跟随。外层保持即时跟随；没有进行中动画时，容差范围内的贴底请求使用即时定位，避免小数位置上的无位移操作留下未结束的平滑目标。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包在浏览器中渲染已记录的对话状态，不注册任何面向模型的内容。

#### KV Cache 影响

无；Chat 呈现不会组装或修改提供方请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **transcript 只反映已加载的 Session 窗口**——只有 Session Controller 加载前一页 event 后，更早的 transcript node 才会出现。轮次导航比窗口更宽：轨道把已加载的 Turn 与宿主 `turnOutline` 投影合并，每个已开始的 Turn 都有固定间距刻度（相隔 10px；阶梯高于外框时在框内滚动并以渐变淡出标示可滚方向），激活未加载刻度会先把历史分页拉到该 Turn 的 `turn/start` seq 再落到它的行上。没有该投影时（未挂载 `dsh-session-turn-outline` 的装配），轨道回退到仅显示已加载 Turn。
- **导航预览按卡片尺寸截断**——提示词一行（50 字符）、回复至多三行（120 字符），已加载与未加载 Turn 一致；未加载 Turn 的回复要等该轮落定后才随大纲到达，进行中的轮次在此之前只预览提示词（或仅轮次号）。
- **文件芯片尚未接回过程组正文**——[TurnProcessRows.tsx](src/client/chat/TurnProcessRows.tsx) 中的 TurnProcessFileChip 与 countsLine 是从旧分组 transcript 保留下来的，但当前过程组通过普通工具行渲染成员，组内不再放芯片行；重新接线属于后续的工作细节批次。
- **fork 本地折叠组件暂无消费者**——[FoldRow.tsx](src/client/chat/FoldRow.tsx)、TurnProcessFileChip 与 countsLine 是刻意保留的 fork 本地组件而非删除对象，当前没有任何 renderer 挂载它们；过程区的各个 seat 渲染自己的标题行。将来需要新增折叠时复用 FoldRow，而不是再写第四个变体。
- **`settledReasoningPreview` 尚无选择器**——该字段已在 [presentation-policy.ts](src/client/presentation-policy.ts) 中占位，但没有 seat 读取它，因此目前没有任何档位会改变已结算推理行的预览；把它接进「思考」行属于后续的推理行批次。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Conversation 与 Slot 注册已经强制 Chat target 一致。
