# Agent Note：U2——AlphaDeck shell 中的会话页

Status: implemented

[English](2026-09-06-u2-conversation-page-in-alphadeck-shell.md) | 中文

> AlphaDeck UI 重构工单 U2，兼 U1 评审的 5.1 返工项（`UI_REBUILD_PLAN.md`）。记录会话模式与模型选择器的落位、流程条为何改由会话头部渲染，以及 dsh 配色如何在不分叉组件 CSS 的前提下让位给 AlphaDeck 配色。

## 问题

U1 换掉了 shell 外壳，但会话面仍是 dsh 呈现：轨迹只能通过标题下方的 View tab 条到达；模式与模型选择器只存在于输入框工具行（计划要求它们在标题栏触手可及）；流程条保留 dsh 视觉而非原型的圆点-连线进度条；所有 dsh 风格的表面仍在用 DeepSeek 蓝而非 AlphaDeck 强调色。U1 评审还留下硬性返工项：每个整页要有固定返回 affordance、流程条行内要有轨迹按钮、窄宽度下要有无重叠断言。

## 决策

**头部拥有流程条行。** `conversation.session.flow` 的渲染从 `ConversationRoot` 移入会话 header occupant——那里本来就有逐会话 view store 与 `selectView`。header 通过 flow seat 新增的 owner 份额（`trailing`）把轨迹控件传进流程条，因此 `ui-mode` 的 FlowBar 保持与 View 无关，只负责把控件放在步骤与当前步骤行之间（与原型完全一致的次序）。不渲染流程条的 occupant 自然丢弃控件；seat 声明随渲染一并迁移，slot 契约的 owner 份额已写明。

**一个选择器组件，两个座位。** `conversation.session.header.mode` 与 `conversation.session.header.model` 是新增 single seat，owner 份额复用输入框座位的 `InputControlOwnerProps`；`ui-mode` 与 `ui-model-selection` 用与输入框座位相同的组件和 inject 面占据它们。不存在会漂移的第二套选择器实现：标题栏与输入框读同一个宿主投影、都经由 `/mode` 与 `session.selectModel` 行动。header 只在 `session.removed` 时锁住它们——composer 的 `inert`/`blocked` 理由是 owner 局部状态，标题栏从不存在。

**轨迹切换取代 View tab 条。** dsh 的 tab 列表从头部的删除。chip（图标+标签，原型样式）选择已注册的 `trajectory` View——dsh 原版轨迹组件，仍经 `conversation.view` 挂载——并在该 View 激活期间翻转为带强调色处理的「返回对话」形态。View 仍是开放扩展点：未来插件注册的超出 `chat`/`trajectory` 的 View 以同一方式到达，且只有确实注册了轨迹 View 时流程条才渲染 chip。

**dsw 别名层承载配色替换。** `alphadeck.css` 现在把少数承载品牌色的 dsw 别名——`state-business-primary`、`link`、`button-info` 对、品牌主色、用户气泡对——按加载次序在 design-platform 表之后重映射到 `--ad-*` 强调色刻度。所有 dsh 风格的表面（聊天记录、输入框、菜单、对话框）无需触碰组件 CSS 即采用 AlphaDeck 强调色与气泡配色；灰阶别名无需重映射，因为 dsh 的中性色阶本就与原型的灰色吻合。暗色主题在暗色工单前保留 dsh 值。

**整页是路由状态，返回 affordance 因此是固定 chrome。** `ShellFrame` 的页面区在滚动内容上方渲染一条携带 `i-back` 字形的细条；侧栏任何导航或会话选中都会直接离开页面（经 shell store 本就如此，现已在测试中断言）。

## 验证

`ui-shell`、`ui-conversation`、`ui-mode`、`ui-model-selection` 的聚焦 Vitest 套件覆盖页面返回 chrome、轨迹切换的往返与其返回形态、流程条 trailing 的落位，以及两个座位上的选择器。`verify-client-ui-i18n` 保持绿（所有新增文案都走 `shell`/`conversation`/`mode`/`model` 字典）。Playwright 烟雾（`output/u2-smoke.cjs`）驱动真实 web 应用：断言页面返回条、标题栏两个菜单、流程条当前步骤行、轨迹往返、`en-US` locale 下的英文文案，以及——5.1.3 断言——900px 视口下侧栏/主区无重叠、无横向溢出，并在 1366 与 1920 截图完成对齐自查。

## 记录在案的债务

web 浏览器 e2e 车道（`apps/web/tests`）按 UI 重构期的创意优先检查政策暂停（黄金基准对着天天变的 chrome 比对只是噪音；UI 定型后恢复）。该车道自 U1 起即过时——那个提交未更新 `apps/web` 下任何文件，dialog 时代的设置断言不可能在没有设置模态的 shell 上通过。本次变更把车道唯一承重的 scaffold 定位器从已废弃布局迁移过来（`[class*="centerCol"]` → `[data-conversation-scroll]`，35 个 spec 文件），使车道恢复时能对新 shell 启动；完整黄金重录与逐 spec 的 chrome 改写留作恢复时的后续工作。上述聚焦套件与烟雾脚本是 U2 的存证。

## 后果

模式/模型选择器无需展开输入框工具行即可到达，且两个表面始终是同一实现。流程条现在是头部 chrome：blank 会话把流程条与控件一并隐藏；插件要向流程条附近投放控件时，走 seat 的 owner 份额，而不是导入 view 状态。取消 tab 条移除了通用的逐 View 导航表面——当前注册的 View 只有 chat 与 trajectory，未来出现第三个 View 时必须刻意重新引入导航（store 与 `openView` 请求路径仍在）。dsw 重映射一次性给所有 dsh 风格表面上色，上游组件改样式仍能在 AlphaDeck 配色下工作；代价是设计平台与最终渲染之间多了一层间接。web 浏览器 e2e 车道仍是记录在案的债务（自 U1 起过时）；U 系列的存证是聚焦套件加 Playwright 烟雾。

## 备选方案

**并行的头部选择器组件**（为每个输入框座位做一个 chip 样式变体）——否决。同一名册/菜单行为有两套实现，会在锁定规则、失败文案与菜单结构上漂移；一个组件两个座位使输入框与标题栏可证一致。

**把轨迹控件放进标题行，而不是经流程条线程传入**——否决。计划把 chip 的位置固定在步骤与当前步骤行之间，而那只有 FlowBar 拥有；把渲染好的控件经 seat 的 owner 份额传入，位置归流程条、行为归头部，且不给 ui-mode 增加 view 依赖。

**分叉 dsh 组件 CSS 以适配 AlphaDeck 配色**——否决。每个被触碰的组件都要逐规则修改，并在上游每次改样式时继续分叉；别名重映射只有一处定义，且按构造即可在上游变更下存活。
