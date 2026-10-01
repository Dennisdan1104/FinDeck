---
description: "面向侧栏的官方 DeepSeek Harness 品牌填充，FinDeck 各 bundle 已不再装配；供选择或替换品牌呈现的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

## 概述

本包向侧栏品牌槽位——`sidebar.brand.mark` 与 `sidebar.brand.name`——填充官方 DeepSeek Harness 标志与名称，并自带这份图形资源（`src/client/FishLogo.tsx`、`src/client/BrandWordmark.tsx`）。**没有任何 FinDeck bundle 装配它**：随附 profile 不为本包挂载行，其注册门控测试的 profile 取值（`official`）也不是 FinDeck 会设置的值，因此侧栏保留 FinDeck 标志与本地构建标签。只有当部署身份就是 DeepSeek 自身时才恢复它。会话首屏槽位（`conversation.hero.brand.mark`）在所有构建中都保持无填充：其声明包以 FinDeck 标志作为回退渲染。它不保留任何运行时状态，也不向模型请求贡献任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在身份为 DeepSeek 自身的部署的浏览器名单中挂载本插件，并让客户端构建采用其门控接受的 profile 取值。FinDeck 两者都不提供：它的 [web bundle](../../bundle/web-app/cordis.patch.yml) 没有本包的行，`pnpm run build` 设置的是 `DSH_CLIENT_BUILD_PROFILE=findeck`（[构建环境](../../../scripts/client-build-environment.ts)）。

### 选择 profile

`DSH_CLIENT_BUILD_PROFILE` 决定渲染哪个品牌。`official` 构建在侧栏显示官方标志与名称；任何其他取值——包括所有 FinDeck 构建设置的 `findeck`——都让外壳回退（FinDeck 标志与本地构建标签）保持原样。会话首屏无论 profile 如何都显示来自 `dsh-client-ui-conversation` 的 FinDeck 标志。两种情况下插件都会照常加载并通过校验；只有注册受 profile 门控。

恢复官方品牌因此需要部署在自己的组合中做两处改动：恢复本包的 `dsh.client` 行，并让构建给出这个门控接受的 profile 取值——或把门控指向该部署自己的 profile 值，或扩展 [`scripts/client-build-environment.ts`](../../../scripts/client-build-environment.ts) 中的 profile 集合。

### 替换品牌

自有身份的部署不组合本包，而是组合另一个占据侧栏槽位——以及本包留给回退的首屏槽位——的包。占据槽位是唯一的组合路径；这里不存在任何品牌配置面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

两个填充作为一组声明感知的注册安装：嵌套的 `ctx.slots.inject()` 调用等待侧栏声明，因此无论本行在声明者之前还是之后激活，这组注册都能工作；声明消失时两个填充一并撤回，HMR 期间也不会留下残缺的品牌混合。浏览器半部是 [`src/client/index.ts`](src/client/index.ts)；node 半部是一个空 Loader 座位。浏览器标题是构建环境的事（`DSH_CLIENT_TITLE`），不在槽位系统之内。

标志与字标图形资源放在本包内（`src/client/FishLogo.tsx`、`src/client/BrandWordmark.tsx`），而不放在 `dsh-client-ui-primitives`，因此每个客户端 bundle 静态播种的通用 primitives 不再携带上游品牌图形。两个模块只从 primitives 取共享的图标 props 类型（`import type`，构建时擦除）。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当品牌面不够用时阅读以下页面。它们从本包占据的槽位进入渲染这些槽位的外壳。

- [ui-sidebar](../ui-sidebar/README.zh.md)——声明 `sidebar.brand.mark` 与 `sidebar.brand.name` 并渲染其回退。
- [ui-conversation](../ui-conversation/README.zh.md)——在首屏声明 `conversation.hero.brand.mark`。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了品牌呈现的供给方式。它们是当前包约束，不是品牌设计对比或任务积压。

- **FinDeck 不装配它**——随附 profile 不为本包挂载行，其门控测试的 profile 取值也不是 FinDeck 构建会设置的值；恢复它属于部署自身的组合改动（见上文「选择 profile」）。
- **标记是重新绘制的近似版本**——它来自字体字形，而本地设计数据无法导出其矢量几何；在获得精确导出路径前，使用手工重建版本代替。
- **只有一组填充**——替代呈现属于占据相同槽位的另一个 Cordis 包。
- **浏览器标题独立**——`DSH_CLIENT_TITLE` 在构建时选择标题文本，而非通过 UI 槽位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包不保留可变状态，两个 slot occupant 通过同一个事务性 effect 安装和释放。
