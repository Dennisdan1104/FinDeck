---
description: "面向模型的 FinDeck 命题工具：把已完成报告中的可检验结论登记为命题、列出到期需复检的命题，并记录复检结果以累积命中/落空成绩。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-thesis

[English](README.md) | 中文

## 概述

研究报告会给出后续数据可以证实或证伪的结论。本消费包为模型提供四个面向持久命题登记表的工具，让一个结论变成带指标、到期日与成绩的受跟踪对象，而不是一段无人复检的文字：`thesis_list` 汇总全部 manifest 及其派生状态与登记表成绩，`thesis_show` 返回单个命题的完整复检历史，`thesis_write` 新增或更新一份 manifest，`thesis_mark` 记录一次复检结果与判定证据。每个命题是 `<thesesDir>/<id>.yaml` 下的一份 YAML manifest（默认 `<harness 主目录>/asset-library/theses`：配置的主目录、`$DSH_HOME`，否则 `~/.findeck`），同一批文件同时供研究资产页的命题视图与定时复检流程使用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本插件即可让 agent 有地方登记并复检结论。它要求 `ctx.tools`；登记表目录是插件配置，不是服务。

### 何时选择

在研究会话会产出含可证伪结论的报告的 FinDeck 组合中使用。只回答问题的会话没有可登记内容，因此工具在研究协议的命题步骤提出要求前一直闲置。

### 挂载与配置

```yaml
- name: '@deepseek-ai/dsh-tool-thesis'
  config:
    thesesDir: '~/.findeck/asset-library/theses'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `thesesDir` | `<harness 主目录>/asset-library/theses` | 存放每个命题一份 `<id>.yaml` manifest 的目录；首次写入时创建。 |

### 模型得到什么

三个参数校验严格的工具：

- `thesis_list` — 每份 manifest 的 `id`、`conclusion`、`metric`、`threshold`、`due_date`、`report`、`assets`，派生 `status`、`overdue`、`check_count`，以及登记表 `score`。
- `thesis_show` — 单份 manifest 全量：全部字段加完整 `checks` 历史（日期、结论、证据），以及该命题自身的命中/落空计数。
- `thesis_write` — 新增或更新一份 manifest；已存在的 id 保留其复检历史与 `created_at`。
- `thesis_mark` — 追加一次 `hit`/`miss` 复检，要求非空证据并写入 `checked_at`。

### 可观察的成功与失败

写入成功返回落盘 manifest 摘要，复检成功返回更新后的状态与成绩。拒绝一律显式：非 kebab-case 的 id、不是真实日历日的到期日、非 `hit`/`miss` 的结果、空证据、给未登记的 id 记复检，都会带拒绝规则报错。不是合法 YAML、或声明 `id` 与文件名不一致的 manifest 会让整次读取失败，而不是被跳过。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 设计概念

登记表以文件为先：一个命题一份按 id 命名的 manifest，用户可以阅读、diff 并手工编辑工具写入的同一批文件。状态与成绩在读取时从追加的 `checks` 历史派生——最新一次复检决定 `open`/`hit`/`miss`，成绩为全登记表的 hits / (hits + misses)。写入以原子替换落盘，写到一半崩溃不会截断 manifest。

### 源码地图

- `src/index.ts` — 工具注册、`thesesDir` 配置、manifest 解析与校验、原子 upsert/mark，以及派生的汇总。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [研究协议第 9 步](../../../finance/skills/findeck-research/SKILL.md) — 模型在此被要求登记命题并复检到期项。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-thesis) — 四个工具的生成式 schema 参考。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`thesis_list` / `thesis_show` / `thesis_write` / `thesis_mark` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-thesis)。

#### Token 影响

工具可见时每个请求的固定 schema 成本。

#### KV Cache 影响

工具定义与可见性不变时前缀稳定。

### 工具结果与错误

#### 模型看到什么

`thesis_list` 渲染成绩行加每个命题一行（状态、到期日、复检次数、到期标记）。`thesis_show` 渲染全部 manifest 字段与逐次复检及其证据；`thesis_write` 渲染落盘 manifest 摘要；`thesis_mark` 渲染更新后的状态与成绩。拒绝渲染拒绝该次调用的校验规则，登记表损坏则渲染文件与其解析失败。

#### Token 影响

成本随 manifest 数量与每个 `conclusion` 长度增长；一次复检只追加自己的结果行。

#### KV Cache 影响

仅追加；新可见结果跟在可复用请求前缀之后。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制说明登记表在什么场景下不合适。它们是当前包的约束，不是任务清单。

- **成绩不加权** — 每次复检都计一次，一个被复检十次的命题会把登记表成绩移动十次；没有按命题加权。
- **没有东西负责调度复检** — `due_date` 与 `overdue` 只是读取侧标记；定时任务流程负责显式绑定复检。
- **不做指标计算** — 工具只保存模型给出的结论；取数与指标计算仍由调用方承担。
- **一个目录一张登记表** — 配置只指定一个 `thesesDir`；多张登记表需要多行插件配置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
