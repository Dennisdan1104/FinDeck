---
description: "dsh web 客户端的系统提示词个性化：宿主侧 `system-prompt` settings 命名空间，以及编辑它的系统设置行与系统提示词页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-persona

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-persona` 同时拥有用户对系统提示词的个性化两端。宿主半边注册 `system-prompt` settings 命名空间，并把该值镜像成提示词段：非空的 `personaPrefix` 紧跟在部署人格之后渲染，非空的 `personaSuffix` 紧跟第一方指导之后，非空的 `customInstructions` 排在整个提示词的最末尾。浏览器半边是该命名空间的编辑器——三个文本域加一个保存按钮——在同一个 scope 上挂载两处：系统设置区里的 `settings.general.item` 行（`system-prompt`），以及壳层的「系统提示词」目的地所路由到的 `settings.section` 页（`system-prompt`）。两处读同一个命名空间、按同一个 revision 重新播种，因此在任一处编辑后，另一处显示的就是该结果。

每个字段的组合层 base 都是空字符串，因此缺失或清空的字段不贡献任何段，而不是贡献一个空段。清空字段通过注册它的同一个 effect 注销该段。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后置工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 web profile 中、设置界面旁边挂载该编辑器。插件需要 `ctx.slots`、`ctx.locale` 与 `ctx.settingsScope`；它的宿主半边只在 profile 同时组合了 settings 提供方与 `dsh-system-prompt` 时才激活。

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-persona'
```

无配置。打开 **系统**（`settings.general.item` 位于通用分组的列中）或壳层的 **系统提示词** 页编辑：

- **人格前缀** — 排在第一方指导之前，段序号 `1`。
- **人格后缀** — 排在第一方指导之后，序号 `10210`。
- **自定义指令** — 追加到系统提示词末尾，序号 `10220`。

保存会写入 `system-prompt` 命名空间的三个字段。把字段保存为空串，就是移除该段的既定做法。

### 生效时机

提示词组装在每个模型步骤执行一次（`ctx.systemPrompt.assemble()`），因此已提交的值会进入每个会话的下一步请求——既不需要重启，也不需要新开会话。命名空间正是因此以 `applies: 'live'` 注册。循环会把变化后的系统提示词记录为 `request/header` 事件（reason 为 `change`），所以会话中途的个性化仍可从会话日志重建。

### 可观察的成功与失败

命名空间仍在读取时，以及宿主文档只读、或浏览器远端到设置只能进程本地保存时，文本域与保存按钮都会禁用，行内会说明存储只读。写入失败会在按钮旁渲染失败文本，并保留已输入的文本。写入提交后，文本域会按宿主 revision 重新播种。

-----

<a id="understand-the-implementation"></a>
## 理解实现

宿主半边（`src/index.ts`）以「空个性化」为 `base` 注册命名空间，然后订阅变更：`sync` 先注销每个字段当前注册的段，再在新文本非空时注册一个新段。它创建的一切都属于 `ctx.inject(['settings', 'systemPrompt'])` 的 fiber，因此失去任一服务时，这些段会随命名空间一起注销。

浏览器半边通过 `ctx.settingsScope` 绑定同一个命名空间，把其快照镜像进每一处的 store；`SystemPromptRow` 经 `props.useStore` 读取镜像，草稿放在组件本地状态里，并在宿主 revision 变化时重新播种。每处各自持有 store 句柄与镜像订阅，因为 store 的唯一写入者是它被挂载的那个条目的 apply 世界监听器。保存经 scope 的 revision 栅栏 `set` 写入三个字段。

### 源码索引

- `src/persona-settings.ts` — 命名空间、字段名、段名、schema 与空 base，两侧共用。
- `src/index.ts` — 宿主半边：命名空间注册与段镜像。
- `src/client/index.ts` — 字典注册、scope 绑定、两处编辑器挂载（系统行与系统提示词页），以及各自的 store 镜像。
- `src/client/SystemPromptRow.tsx` — 该编辑器：三个文本域、保存、错误状态。
- `src/client/store.ts` — 编辑器的 store 声明。
- `src/client/locales.ts` — `settings.systemPrompt` 字典键。

-----

<a id="model-experience"></a>
## Model Experience

本包是系统提示词的终端用户编辑器。它对模型可见的效果恰好是它注册的段：`settings:persona-prefix`（序号 `1`，在 `harness:identity` 与 `deployment:persona-prefix` 之后、所有第一方指导之前）、`settings:persona-suffix`（`10210`，在 `10200` 的部署后缀之后）、`settings:custom-instructions`（`10220`，最后）。空文本不注册段，因此清空字段即保持提示词不变。

#### KV Cache effect

任何改变已渲染段的保存，都会从第一个变化的系统提示词 token 起让提供方的前缀复用失效，与部署侧改 `personaPrefix` 完全一致。只改一个字段不会扰动它之前的段，因此复用能保留到变化的那一段为止。

## 已知限制与后置工作

<a id="known-limitations-and-deferred-work"></a>

- **全局，而非按 agent** — 这些段注册在根作用域，因此作用于部署的每个 agent。注册了自己的 `deployment:persona-prefix` 遮蔽的 agent preset 会保留用户的前缀与后缀；声明 `complete: true` 的 preset 会替换整个提示词，用户的文本随之消失。
- **没有组装结果的预览** — 该行只编辑三个字段，不展示渲染结果；本包依赖的注册顺序以文档形式列在上面。
- **纯文本域** — 没有字数计数、格式帮助或校验。任何文本都会被接受；文本里的 `{{variable}}` 引用会严格插值，未知引用会让那次组装响亮失败。
- **同一时刻只有一个进程本地 revision** — 用户存在未保存草稿时，外部对 settings 文档的修改会重新播种文本域并丢弃这些草稿。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作上下文 — 点击展开</summary>

用户段使用自己的名字（`settings:*`，而不是 `deployment:persona-prefix`/`deployment:persona-suffix`），因为提示词注册表始终全局注册部署那一对：再注册一个同名的全局段属于重复注册并会抛错。带作用域的 persona 行（`dsh-persona`）能复用这些名字，是因为带作用域的段会遮蔽全局段，而根作用域的贡献方没有这个手段。

</details>
