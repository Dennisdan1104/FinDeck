---
description: "FinDeck 资产中枢页：一个 settings section，读取 assetOverview Remote——assetLibrary 驱动的资产网格与列表、按 runVerb 渲染每种 face.json 组件的脸详情、血缘图，以及报告与模式流程两个 tab。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-assets

[English](README.md) | 中文

## 概述

`dsh-client-ui-assets` 是资产中枢：一个 `settings.section` 行（`research-assets`，侧栏直达区第一项），把资产库按用户读它的方式摆出来——与 AI 读的那批文件是同一份事实。四个 tab：v2 `assetLibrary()` 快照驱动的资产**网格/列表**、带命题成绩的**研究报告**、含每步模型的**模式流程**、以及**血缘图**；再加一个**脸详情视图**，逐块渲染某版本的 `face.json`，并经 `runVerb` 执行桥跑它的 verb。所有读取、每次 verb 执行、以及「交给 AI」打开的会话都由宿主负责；本包只渲染 Remote 的应答。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后置工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 web profile 中、`ui-shell` 与它所读取的 API Remote 之后挂载该行。它需要 `ctx.slots`、`ctx.locale`、`ctx.sessions`，以及已挂载的 `assetOverview` / `agentPresets` Remote 面。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-client-ui-assets'
```

无配置。section id 为 `research-assets`，经 shell 的 `shell.page` 洞以整页呈现。

### 页面呈现什么

- **资产**——v2 索引的每条目一张卡（名称、kind 徽标、来源、最新版本、保鲜度 `as_of`、标签；过期条目前景变灰），或同一份库的紧凑表格。过滤器覆盖 kind、来源、标签，以及名称/描述/标签/动作上的子串；表格可按名称或 `as_of` 排序。点卡片或行即打开该资产的脸。
- **脸详情**——该版本的 manifest 事实（截止、验证、创建、来源会话、接口、动作、标签、上游、版本目录）、一个 **交给 AI** 按钮，以及脸本身：八种 v1 组件（`metric-card`、`line-chart`、`data-table`、`log-view`、`status-badge`、`action-button`、`param-form`、`embed`）用同一套设计语言渲染。声明了脸的 dataset 若无脸，则渲染内置默认脸（as_of、行数、preview 表）；其他资产无脸时显示「暂无脸」占位并提示去生成。
- **血缘**——把资产快照投影成有向分层 SVG：列为依赖深度，箭头由上游指向消费方，点击节点打开该资产的脸。
- **报告**——登记表已知的每份报告（标题、工作区、修改时间），其后是命题条：每条结论的状态、复检次数与登记表的命中/落空成绩。
- **模式流程**——预设分为工作流程（声明了步骤，每步带模型路由）与自由/轻量两类；下方表单复制一个既有工作预设，指定新 id 与名称，并替换其流程。

### 可观察的成功与失败

页面同时加载资产库与 overview 快照；需要哪份快照的 tab 缺失时各自显示失败行与自己的重试按钮。宿主报告为 `problems` 的部分读取结果渲染在 tab 之上。在脸内部，每个数据块有自己的读取中/失败行；触发的 verb 报告耗时与输出（或桥返回的错误消息）；`face.json` 里不符合 v1 规范的块被跳过，并渲染可读的块与跳过数量。流程表单就地报告失败，创建成功后重新加载快照。

### 把资产交给 AI

**交给 AI** 先向宿主取该资产的 seed 文本（`assetBrief`），创建会话（`ctx.sessions.create`）、打开它（`ctx.sessions.open`）、登记提交回显，然后把 seed 作为该会话的第一条 prompt 发出。打开会话本身就是离开本页：当前会话一变，shell 就把主区带回会话页；prompt 被接受后页面还会显式关闭自己的 section。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`AssetsPage` 持有 tab、视图模式、过滤器、排序、选中资产，以及两份快照的一份加载状态；所有子组件都是这些值加注入适配器之上的纯渲染器。`src/client/index.ts` 注册 `ui.assets` 字典与 section 行，并适配 Remote 结果：读取失败抛出带 Remote 消息的错误；`runVerb` 的传输层失败被折叠进协议自身的 `error` 分支，让渲染器继续把 `status` 当唯一判据。

数据块不各自取数：`FaceRenderer` 汇总脸上互不相同的 `asset` + `verb` + `params` 请求，每个只发一次，各块读取自己那条——因此同一份 `preview` 调用喂两张卡片只花一次桥调用，一个块失败也不会拖垮同脸的兄弟块。

### 源码地图

- `src/client/index.ts`——字典注册、`research-assets` section 行，以及 Remote 适配器（`assetLibrary`、`overview`、`assetFace`、`runVerb`、`assetFile`、`assetBrief` + sessions、`savePreset`）。
- `src/client/AssetsPage.tsx`——页面：tab、快照加载状态、过滤/排序/选中状态。
- `src/client/assets/library.ts`——纯投影：过滤、排序、血缘边（`depends_on` ∪ `lineage.inputs`，自环剔除）与分层布局。
- `src/client/assets/labels.ts`——manifest 的 `kind`/`origin` 词汇到字典键的映射。
- `src/client/assets/AssetsView.tsx`——工具条、卡片墙与紧凑表格。
- `src/client/assets/AssetDetail.tsx`——脸详情视图、manifest 事实与交给 AI 入口。
- `src/client/assets/LineageGraph.tsx`——血缘 SVG。
- `src/client/face/spec.ts`——纯的脸读取：块解析、`extract` 点路径、标量/行/图表/表格/文本投影，以及请求去重。
- `src/client/face/FaceRenderer.tsx`——八种块渲染器、共享取数登记表，以及 dataset 默认脸。
- `src/client/reports/ReportsTab.tsx`、`src/client/flows/FlowsTab.tsx`——自上一版页面沿用的两个 tab。
- `src/client/locales.ts`——`ui.assets` 字典键。

-----

<a id="model-experience"></a>
## Model Experience

渲染本身不产生模型输入：页面只读 Remote 快照、只跑资产自己声明的 verb。唯一触达模型的路径是交给 AI 入口——它把宿主生成的 seed 文本（资产名、版本、版本目录、manifest 摘要、血缘、verbs）作为一条普通用户 prompt 发进新会话；该 seed 就是该会话的第一条持久消息，除此之外不注入任何东西。

#### KV Cache effect

本身没有。交给 AI 发出的 prompt 是一个新会话的首个请求，因此它构建的是该会话自己的前缀，而不是延长既有的前缀。

## 已知限制与后置工作

<a id="known-limitations-and-deferred-work"></a>

- **命中率/活物率是留位而非列**——列表视图渲染两个表头与空单元格；它们背后的 `usage.jsonl` 数据归 P4。
- **每次访问一份快照**——页面只加载一次资产库与 overview，失败时可重试，自身不刷新；其他会话归档的新版本要在下次访问才出现。
- **血缘图是静态分层布局**——列按依赖深度、节点按快照顺序摆放，大库读起来是一张很宽的图，没有平移、缩放，也不绕开节点布边。
- **不符合 v1 规范的脸会静默降级**——无法读取的块类型被跳过并计数，而不是整张脸拒收；生成期的校验器才是保持脸合规的闸门。
- **内嵌文档带脚本运行**——`embed` 把资产自带的 html 放进 `iframe sandbox="allow-scripts"`：文档处于不透明源，既够不到本页也够不到资产库，但交互式导出（notebook 导出、自包含报告）预期需要脚本。要收紧成无脚本沙箱只需改一个属性。
- **不渲染报告正文**——报告 tab 只列元数据与成绩；读报告正文仍在写出它的会话或磁盘文件里。
- **流程表单只能复制**——新流程从既有工作预设出发；没有从零创作组合的界面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本页取代了 ui-pages 的 `research-assets` 占位；assets tab 也把旧的 `overview().assets` 卡片列表换成了 v2 `assetLibrary()` 快照（旧字段缺 origin/verbs/freshness/tags/stale，不可复用）。血缘图是同一份快照的纯客户端投影、不新增 graph Remote（按计划 R9 修订）；它读 `depends_on`，因为快照不带 `lineage`，而 `archive()` 保持 `depends_on` 与 `lineage.inputs` 相等（互相回填、不一致即拒），所以并集本来就是快照自己的声明。图布局沿用被它取代的依赖图「按深度分列」思路，并忽略自环（增量刷新那种形状）。

</details>
