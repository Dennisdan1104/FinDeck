# Agent Note: AlphaDeck 根 shell——替换 dsh 三栏框架

Status: implemented

[English](2026-09-06-alphadeck-ui-root-shell.md) | 中文

> AlphaDeck UI 重构工单 U1（设计见 `UI_REBUILD_PLAN.md`，视觉基准 `output/ui-prototype/index.html`）。记录为什么新 shell 是替换而不是扩展 dsh chrome，以及随它迁移了什么。

## 问题

用户对 AlphaDeck UI 的定调是彻底重构，明确不是扩展 dsh 的窗口 chrome：固定 236px 导航侧栏（研究/圆桌 tab、直达导航、按工作区分组的会话、可折叠设置收纳框、用户卡片）加路由化内容区，dsh 的三栏 AppFrame（可缩放侧栏、详情栏、设置弹窗体系）整体废弃。dsh 布局机制基于槽位、可以替换——runtime 只渲染内建 `root` 槽——但替换必须保留每个功能面：会话（ui-conversation）、工具详情面板（ui-chat 的 DetailsPanel）、工作区浏览器（ui-workspace），以及全部设置 section（模型、系统、Agent 预设、帮助、占位页）都注册在旧 shell 声明的槽位上。

## 决策

**一个新包独占 root 槽位。** `dsh-client-ui-shell` 把 `ShellFrame` 贡献进 `root`（web-app bundle 行；`ui-layout` 与 `ui-sidebar` 行在那里被禁用而非删除——同时挂两个 shell 的 profile 会在子槽位声明冲突处响亮报错，这是组合错误被设计说出的方式，不是隐藏回退）。ShellFrame 重新声明被替换条目拥有的面向 occupant 的槽位——`conversation`、`details`、`shell.overlay`、`sidebar.workspaces`——因此所有 occupant 原样挂载。固定 236px 侧栏、无折叠；`ctx.layout` 保持契约，`toggleSidebar` 是有据可查的空操作（详情开/关对继续可用）。

**页面导航是单个 `settings.section` id。** shell 路由是 section id 或 `undefined`（会话页）。非会话页经新增 `shell.page` 槽位渲染，由设置域的页面宿主占用（ui-settings-general 的 `SettingsPageHost`）：它按请求的 section id 解析并整页渲染该 section 的内容——同一注册表、同一组件、无弹窗。设置收纳框项、直达导航块与圆桌 tab 是固定的 shell 文案；圆桌面即 `roundtable` section。任何地方打开会话都会把内容区带回会话页（当前会话变化的 effect）。

**主题与标题投影随 shell 迁移。** 主题呈现器从 ui-layout 迁到 ui-shell（已无 profile 挂载 ui-layout 的 root 条目，且 feature 插件之间不能以值导入共享 presenter——shell 自持）。浏览器标题效果内联在 ShellFrame 中，避免孪生组件文件。原型配色以一份 `--ad-*` token 落在 `ui-theme/src/styles/alphadeck.css`（全局样式表归 ui-theme 所有），是 U 系列的唯一颜色来源。

**无弹窗时设置页照常工作。** ui-settings-general 把 `SettingsPageHost` 注册进 `shell.page`——这是旧 `SettingsRoot` 之外的第二个注册（后者保留给渲染 `sidebar.settings` 的 profile）；两者永不共存，因为各自在自己的洞口声明上休眠，且 settings.section 的声明冲突会让同时挂载的世界响亮失败。

**U1 有意让新手导览休眠。** 首启导览协调器在（未渲染的）SettingsRoot 上；它随 U5 设置四页回归。工作区浏览器保留 dsh 视觉，直到 U2 会话工单重绘。

## 备选方案

**以更低优先级遮蔽 `root` 单元。** 保留 ui-layout 的 root 注册并覆盖渲染，可以避免禁用行，但被遮蔽的条目仍声明 `conversation`/`details`——ui-shell 无法重新声明它们，组合仍然耦合 dsh 框架的形状。禁用被替换行才使替换完整。

**让 shell 自己声明 `settings.section`。** section 注册表属于设置域（ui-settings）；从 shell 声明会转移所有权，并破坏同时挂载两个世界的 profile。页面宿主留在 ui-settings-general，声明本来就在那里。

**以值导入复用 ui-layout 的主题呈现器。** feature 插件不得运行时导入另一个 feature 插件的值；移动文件保持一份拷贝、一个所有者（挂载中的 shell）。`DocumentTitle` 留在 ui-layout 供 AppFrame 使用；shell 内联等效效果。

**导航标签取自 section ledger。** 按 section id 读标签可复用注册者文案，但策展过的 IA（研究/圆桌 tab、固定收纳框项）与 ledger 的顺序和集合不同——shell 在 `shell` 命名空间持有自己的 chrome 文案。

## 后果

组装后的 web 应用首次加载即渲染 AlphaDeck 侧栏并路由页面：直达导航、设置收纳框（模型/数据与环境/系统/预设/帮助）、圆桌 tab，以及整页呈现的既有 section。设置可达性不变（模型、系统、Agent 预设、帮助、数据环境），插件 inventory 以页面呈现，会话保持无弹窗行为。详情面板与 overlay occupant 行为如旧。暗色 `--ad-*` 覆盖、新手导览与重绘的工作区浏览器是后续工作（U2/U5、暗色主题工单）。
