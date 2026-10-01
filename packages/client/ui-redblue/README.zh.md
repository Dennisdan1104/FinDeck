---
description: "系统设置里的红蓝提示词编辑卡：两个文本域写入 rbcheck settings 命名空间，空值代表使用内置默认。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-redblue

[English](README.md) | 中文

## 概述

`dsh-client-ui-redblue` 是红蓝提示词编辑卡：系统设置区里的一个 `settings.general.item` 行（`redblue-prompts`），在 `rbcheck` settings 命名空间之上渲染两个文本域。保存时经 settings Remote 写入两份提示词；文本域留空代表「使用内置默认」，因此重置按钮写空串，而不是复制出厂提示词。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与后置工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 web profile 中、`ui-shell`、设置界面与注册该命名空间的 redblue 宿主包之后挂载该行。它需要 `ctx.slots`、`ctx.locale`，以及它所读取的 settings Remote 面。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-client-ui-redblue'
```

无配置。卡片挂载在系统设置区；它编辑的提示词由宿主 `/rb-check` 命令读取。

### 卡片呈现什么

- **红队提示词**——攻击方审查契约，带恢复默认按钮。
- **蓝队提示词**——辩护方回应契约，带自己的恢复按钮。
- **保存**——一个按钮写入两份提示词；成功时报告保存时间戳，失败时报告失败文案，初始读取完成前保持禁用。

### 可观察的成功与失败

初始读取失败渲染卡片的错误行；保存失败把失败文案渲染在按钮旁，并保留已输入的文本。保存空提示词是合法操作——这正是回到内置默认的文档化方式。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`RedblueCard` 持有两个文本域的值、加载标记、忙碌标记与最近保存时间戳；`src/client/index.ts` 注册 `settings.redblue` 字典与卡片行，并把 settings Remote 适配成卡片的 `load` / `save` 属性。卡片从不直接读取命名空间，因此宿主包始终是提示词默认值的唯一所有者。

### 源码地图

- `src/client/index.ts`——字典注册、`redblue-prompts` 卡片行，以及 `load` / `save` 适配器。
- `src/client/RedblueCard.tsx`——卡片：两个文本域、重置按钮、保存与错误状态。
- `src/client/locales.ts`——`settings.redblue` 字典键。

-----

<a id="model-experience"></a>
## Model Experience

无——卡片只读写 settings 命名空间；模型实际收到的提示词文本由宿主 redblue 包负责。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## 已知限制与后置工作

<a id="known-limitations-and-deferred-work"></a>

- **全局一份提示词对**——卡片编辑唯一的 `rbcheck` 命名空间，改动作用于每次 `/rb-check`，而非按预设或按会话。
- **纯文本域**——没有提示词预览、diff 或字数统计；保存什么文本，命令就注入什么文本。
- **不校验提示词**——任何文本都被接受；不可用的提示词会在之后表现为模型行为问题，而不是保存错误。
- **重置写空串**——重置不会把出厂默认复制进命名空间，因此卡片显示空文本域，由宿主在读取时替换默认值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

重置之所以写空串，是因为宿主在读取时会替换为出厂默认；命名空间的 base 持有默认文本，卡片从不复制它。

</details>
