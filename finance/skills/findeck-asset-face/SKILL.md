---
name: findeck-asset-face
description: >
  中文：资产脸（face.json）生成手册——为库内资产生成一张在资产页面上投影其能力的脸：8 种组件的词汇表与必填字段、模型/数据集/代码三类资产的"好脸"规则、存放位置与 manifest 声明方式、必须跑 validate_face.py 通过才算完成。给资产配页面、生成 face、资产入库顺带出脸时必读。
  English: Asset-face (face.json) manual — generate the capability card the asset page projects for an asset: the eight-component vocabulary with required fields, the good-face rules for model, dataset, and code assets, file placement and manifest declaration, and the mandatory validate_face.py pass.
whenToUse: 当你要为资产库内某个资产（模型/数据集/代码/权重/图表/报告）生成或更新 face.json，或资产入库时需要声明 face 字段时使用。规范权威来源见 finance/face-spec/README.md。
---

# FinDeck 资产脸生成手册

**一句话：脸是资产的投影，不是本体。** 你只需要决定"摆什么组件、调哪个 verb、传什么参数"；
配色、排版、交互全部由渲染器唯一决定，face.json 里不许出现样式，也不许自造组件类型。

`<py>` 代指数据环境解释器 `finance/python/.venv/Scripts/python.exe`（见 `findeck-python-env`）。

---

## 1. 脸放在哪、怎么声明

```
~/.findeck/asset-library/<asset-name>/
└── vN/
    ├── manifest.yaml     # 追加一行 face: face.json
    ├── <数据/模型/脚本>
    └── face.json         # 脸
```

- **位置**：`<asset>/vN/face.json`——**版本目录内**。所在目录即身份，face.json 里**不写 asset 字段**。
- **声明**：编辑该版本目录的 `manifest.yaml`，追加 `face: face.json`（相对版本目录的路径，`*.json`、不含 `..`）。
  只改这一行，其余字段保持原样。
- **刷新索引**：对已入库资产，改完 manifest 后调一次
  `<py> -c "from findeck import assets; assets.reindex()"`。
- **依赖 manifest 既有信息**：脸的每个 `verb` 都必须在该版本 manifest 的 `verbs` 里；
  先读 manifest 再动手，不要凭空发明 verb。

## 2. 顶层结构

```json
{ "version": 1, "title": "沪深300指数月线", "blocks": [ ... ] }
```

- `version`：字面量 `1`；`title`：非空字符串；`blocks`：至少 1 个组件，数组顺序即渲染顺序。
- 顶层与每个 block 都 `additionalProperties: false`——**多写一个键直接被拒收**。

## 3. 组件词汇表（v1 封闭集合，8 种）

公共字段：`type`（必填）、`title`（可选）。

**数据来源 verb vs 触发 verb**：数据类组件在**打开脸时**就被渲染器调用（必须快、只读、无副作用）；
触发类组件**只有用户点击/提交时才调**（可以慢、可以有副作用）。写脸前先分清你用的是哪一种。

| 组件 | 用途 | 必填字段 |
|---|---|---|
| `metric-card` | 一个关键数字（样本外 IC、行数、as_of、保鲜度） | `verb`；可选 `params`、`format`、`extract` |
| `line-chart` | 一条时间序列曲线（净值、残差、收盘价） | `verb`；可选 `params`、`x`、`y`（列名） |
| `data-table` | 明细表格（数据预览、指标表） | `verb`；可选 `params`、`columns`、`max_rows` |
| `log-view` | 运行日志 / 文本输出 | `verb`；可选 `params` |
| `status-badge` | 一个状态标签（保鲜度、健康度） | `verb`；可选 `params`、`extract` |
| `action-button` | 一键触发一个 verb | `verb`；可选 `params`、`confirm`(bool) |
| `param-form` | 收参数再触发一个 verb | `verb`、`fields` |
| `embed` | 挂一个自带网页（交互报告） | `path`（版本目录内相对 html 路径，**禁止 `..`**） |

`param-form` 的 `fields` 元素：`{name, label, type: number|string|boolean|select, default?, options?}`；
`type=select` 时 `options` 必填；同一表单内 `name` 不得重复；`default` 类型要与 `type` 一致。

**只有 `metric-card` 与 `status-badge` 有 `extract`**（点路径，段为标识符或整数下标，负下标从尾部数）：
verb 返回字典时用它指出取哪个标量。例：`extract: "rows"` 取行数、`extract: "tail.-1.date"`（配
`params: {tail: 1}`）取最新一期日期。注意 `head`/`tail` 是 verb 返回的**窗口**不是整份数据——
内建 `preview` 中 `head` 是前 n 行、`tail` 是末尾 n 行，取最新一期一律用 `tail`。
路径非法（空格、连续点）会被校验拒收。其它组件不许写 `extract`（`additionalProperties: false` 直接拒）。

## 4. 每类资产的"好脸"规则

**通用规则一：触发类组件（`action-button` / `param-form`）的 verb 必须是该资产实际声明、且存在处理器的 verb**
（版本目录内有 `<verb>.py`，或有同名函数）。声明了却没处理器的 verb 做成按钮，
点击必然返回 `verb 无处理器` error——那是坏体验，不如不放按钮；真要放，先把处理器写出来。

**通用规则二：数据类组件的 `preview` 无需声明。** `preview` 是只读的内建检视动作，所有资产天然具备
（模型/报告/代码资产用它读 manifest 摘要与文件清单），不必出现在 manifest 的 `verbs` 里。
其他 verb 一律必须先声明。

### 模型资产（`kind: model` / `weights`）

**必须露出**：

1. **样本外指标** → `metric-card`；有评估类 verb（如 `evaluate`）就用它并写明 `params`（`split: oos` 之类），
   没有就用 `verb: preview` 配 `extract: "validation"` 取 manifest 里的实测指标文本。
   数字必须来自真实跑出的样本外结果，不许填训练集数字充数。
2. **曲线（`line-chart`）只在资产声明了能产出曲线数据的 verb 时才要求**——
   即存在一个返回可画成 `x`+`y` 的表（净值/残差序列）的 verb。没有这样的 verb 时**不要**硬凑
   `line-chart`，改为 **`metric-card` + 文件清单**（`log-view` + `verb: preview`）为准。

### 数据集资产（`kind: dataset`）

**必须露出**：

1. **`as_of`** → `metric-card`，`verb: preview`，`params: {tail: 1}` 配 `extract: "tail.-1.date"`。
   `tail` 是数据**末尾** n 行的窗口，`-1` 就是最后一行 = 最新一期日期。
   manifest 的 `freshness.as_of` 是期望值，脸要露的是数据里的实际值。
2. **行数** → `metric-card`，`verb: preview`，`extract: "rows"`。
3. **数据预览** → `data-table`，`verb: preview`。`params.n` 取的是 **head（最早 n 行）**；
   要展示**最新** n 行必须写 `params: {"n": 0, "tail": N}`——`n: 0` 让 head 为空，渲染器才落到 tail 窗口。

建议再加：`line-chart` 画主要数值列的时间序列（用 `params` 与 data-table 区分取数范围）。

### 代码 / 脚本资产（`kind: code`）

**必须露出**：

1. **`action-button`**，`verb` 为该资产声明的运行 verb（如 `run`），可选 `confirm: true`。
2. **`log-view`**，`verb` 为返回日志/输出的 verb。

### 其它（`chart` / `report`）

用 `embed` 挂自带网页（路径必须在版本目录内），配 `status-badge` 或 `metric-card` 露出保鲜度；
报告类可加 `log-view` 展示最近一次生成日志。

## 5. 生成流程（照做，不许跳步）

1. 读版本目录的 `manifest.yaml`：`kind`、`verbs`、`freshness`、`interface`。
2. 按 §4 的好脸规则选组件，`verb` 只从 `verbs` 里挑。
3. 写 `<asset>/vN/face.json`。
4. **跑校验，必须全 PASS**：

   ```sh
   <py> finance/face-spec/validate_face.py ~/.findeck/asset-library/<asset>/vN/face.json
   ```

   退出码 0 才算通过。FAIL 时按错误消息改 face.json 再跑，**不要把校验器改成放行**。
5. manifest.yaml 追加 `face: face.json`（只加这一行）。
6. 已入库资产：`<py> -c "from findeck import assets; assets.reindex()"` 刷新索引。

> **完成判据**：validate_face.py 全 PASS + manifest 声明了 face + 索引已刷新。三步缺一不可，
> 没跑过校验的脸一律不算生成完成。

## 6. 铁律

- **脸坏了重新生成，不手修。** 脸是投影：数据变了、verb 变了、不满意了，都重新生成一张，
  不要在 face.json 上手改数字或结构——手修的脸下个版本又会漂回去。
- **不碰样式**：没有颜色、字号、CSS、脚本字段，将来也不会有。想改外观 = 改渲染器（P3）。
- **不造组件**：`type` 只取上面 8 种，自造的组件名会被校验直接拒收。
- **verb 必须已声明（`preview` 除外）**：manifest `verbs` 之外的动作，脸写了也执行不了（执行桥第一级就拦）；
   唯一的例外是只读内建的 `preview`，任何资产都能用它检视。
- **按钮必须有处理器**：没处理器的 verb 不上脸做按钮（点击必报 `verb 无处理器`）。
- **数字来自实测**：metric-card 的值必须来自 verb 实跑返回，不许静态编造。
- 规范全文与八组件完整字段表见 `finance/face-spec/README.md`；按钮如何真正执行见
  `finance/face-spec/verb-bridge.md`。
