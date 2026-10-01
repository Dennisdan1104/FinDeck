# FinDeck Face Spec v1

**资产的脸 = 资产在资产页面上的投影，不是资产本体。**

脸只描述"怎么把这个资产的已有能力摆出来给人看/给人点"：哪一个组件（卡片/图表/表格/表单/按钮）、
去调哪个 verb、传什么参数。真实数据、真实计算永远在资产本体（模型、数据文件、脚本）里，
脸坏了、过期了、风格不对——**重新生成一张，不手修**。

同一个资产同时服务两端：AI 走文件与 shell，用户走 Face。两端读的是同一份事实来源（资产版本目录），
脸只是一个视图层，不引入第二份状态。

---

## 1. face.json 放哪、是什么

```
~/.findeck/asset-library/<asset-name>/
└── vN/
    ├── manifest.yaml     # 资产本体元数据（六要素）
    ├── <数据/模型/脚本>
    └── face.json         # 脸：本规范描述的文件
```

- **位置**：资产版本目录内（`<asset>/vN/face.json`）。**所在目录即身份**——face.json 里不写 `asset`
  字段，渲染器由当前打开的是哪个版本目录推出资产名与版本号，避免"脸指向的资产"与"脸所在的资产"不一致。
- **声明**：manifest.yaml 的可选字段 `face: face.json`（版本目录内相对路径，必须 `*.json` 且不含 `..`）。
  声明了 `face` 而文件不存在，`assets.archive()` 报错并回滚。
- **一版一脸**：face.json 随版本走。改数据不改脸时，脸在新版本目录里复制一份；脸描述的是**这一版**的样子。

## 2. 顶层结构

```json
{
  "version": 1,
  "title": "沪深300指数月线",
  "blocks": [
    { "type": "metric-card", "title": "数据截止", "verb": "preview", "params": { "n": 1 } },
    { "type": "data-table", "title": "最新 12 行", "verb": "preview", "params": { "n": 12 } },
    { "type": "line-chart", "title": "收盘月线", "verb": "preview", "params": { "n": 128 }, "x": "date", "y": "close" }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | 是 | 规范版本，字面量 `1`。 |
| `title` | 是 | 脸标题，非空字符串。 |
| `blocks` | 是 | 组件列表，至少 1 个，渲染顺序即数组顺序。 |

顶层与每个 block 都 `additionalProperties: false`：**写错键直接拒收**，不静默忽略——
脸是机器生成的，静默忽略只会把错误藏进下一次生成。

## 3. 八种组件（v1 封闭集合）

每个 block 公共字段：`type`（必填，判别字段）与 `title`（可选，界面小标题）。

**数据来源 verb 与触发 verb 的区别**——这是本规范最容易搞混的一处：

- **数据来源 verb**（数据类组件用）：渲染器**打开脸时**就去调它取数，把返回值画出来。必须快、只读、无副作用。
  典型：`preview`、`evaluate`、`check-freshness`。
- **触发 verb**（触发类组件用）：渲染器**不主动调**；只有用户点了按钮/提交了表单才调它。可以有副作用、可以慢。
  典型：`run`、`retrain`、`update`。

同一个 verb 名可以同时出现在两类组件里（例如表单和按钮都触发 `retrain`），但语义由组件的类别决定。

### 数据类

| 组件 | 用途 | 必填 | 可选 |
|---|---|---|---|
| `metric-card` | 一个关键数字（样本外 IC、行数、as_of、保鲜度） | `verb` | `params`、`format`（格式化提示，如 `percent`/`0.000`/`date`）、`extract`（取值点路径） |
| `line-chart` | 时间序列曲线（净值、收盘价、残差） | `verb` | `params`、`x`（X 轴列名）、`y`（Y 轴列名） |
| `data-table` | 明细表格（数据预览、指标表） | `verb` | `params`、`columns`（列名数组）、`max_rows`（正整数） |
| `log-view` | 运行日志/文本输出 | `verb` | `params` |
| `status-badge` | 一个状态标签（保鲜度、健康度） | `verb` | `params`、`extract`（取值点路径） |

`verb` 返回值约定：`metric-card`/`status-badge` 取标量（返回字典时按下面的 `extract` 规则取）；
`line-chart` 取可画成 `x`+`y` 的表；`data-table` 取表（`{columns, rows, ...}`）；
`log-view` 取文本或行列表。具体返回值见 [verb-bridge.md](verb-bridge.md)。

#### `metric-card` / `status-badge` 的取值规则（`extract`）

这两个组件要的是**一个标量**，但它们的 verb 常常返回一个字典——例如 dataset 的 `preview`
返回 `{columns, dtypes, rows, head, tail?}`。取值规则：

1. **`extract` 存在**：按点路径从 verb 返回的字典里逐段下钻，抽取到的值即卡片的值。
   段是标识符（字典键）或整数下标（列表下标，**负下标从尾部数**）。
   例：`rows` 取总行数；`tail.-1.date`（配 `params: {"tail": 1}`）取**最新一期日期**，即 as_of。
   注意 `head`/`tail` 是 **verb 返回的窗口**，不是整份数据——内建 `preview` 的 `head` 是
   `df.head(n)`（**前** n 行）、`tail` 是 `df.tail(n)`（**末尾** n 行），要看最新一期用 `tail`，
   不要用 `head.-1`（它只在 `n` 覆盖全部行时才落到末尾）。窗口语义见 [verb-bridge.md](verb-bridge.md)。
   路径非法（含空格、连续点、非法字符）在 schema 层直接拒收。
2. **`extract` 缺省**：渲染器按组件约定自取——返回是标量就直接用；返回是字典时，
   `metric-card` 优先取 `result` 中的数值标量键（如 `rows`、`ic`、`sharpe`），
   `status-badge` 优先取 `status` / `state` / `badge` 这类标量键。
3. 抽取不到（路径不存在、值不是标量）时渲染器显示空值，**不回退成整个字典**。

`extract` 只决定渲染器**取哪个数**，不改变 verb 的返回值——verb 仍返回它的完整结果，
`data-table`/`line-chart` 等组件照旧消费同一份返回值。

### 触发类

| 组件 | 用途 | 必填 | 可选 |
|---|---|---|---|
| `action-button` | 一键触发一个 verb | `verb` | `params`、`confirm`（true 时点击先弹确认） |
| `param-form` | 收参数再触发 verb | `verb`、`fields` | `params` |

`fields` 是字段数组，元素结构：

```json
{ "name": "n_estimators", "label": "树数量", "type": "number", "default": 300 }
{ "name": "objective", "label": "目标函数", "type": "select", "default": "regression",
  "options": ["regression", "binary"] }
```

| 键 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 参数名，提交后作为 verb 的 `params` 键；**同一表单内不得重复**。 |
| `label` | 是 | 界面标签。 |
| `type` | 是 | `number` / `string` / `boolean` / `select`。 |
| `default` | 否 | 默认值；运行时类型必须与 `type` 一致，`select` 的默认值必须落在 `options` 内。 |
| `options` | `type=select` 时必填 | 候选项字符串数组，至少 1 个。 |

### 自带网页

| 组件 | 用途 | 必填 | 可选 |
|---|---|---|---|
| `embed` | 挂一个自带网页的工具（交互式报告、notebook 导出） | `path` | `title` |

## 4. embed 安全约束

`embed.path` 必须是**资产版本目录内的相对 html 路径**，且：

- 不得是绝对路径（不得以 `/` 开头）；
- 不得含任何 `..` 片段——`pattern: ^(?!/)(?!.*\.\.)[A-Za-z0-9._/-]+$` 直接拒收
  `../secrets/leak.html` 这类越界路径；
- 只允许 `A-Za-z0-9._/-` 字符（无盘符、无反斜杠、无查询串）。

理由：脸是 AI 生成的，embed 是唯一能引入外部内容的组件。渲染器据此约束把嵌入范围钉死在版本目录内，
不给"脸指向库外文件"留口子。渲染器落地时还应做一次 `Path.resolve()` 后的前缀检查（纵深防御）。

## 5. 校验器用法

```sh
finance/python/.venv/Scripts/python.exe finance/face-spec/validate_face.py path/to/face.json
finance/python/.venv/Scripts/python.exe finance/face-spec/validate_face.py examples/valid/*.json
```

- 收一个或多个 face.json 路径，逐一打印 `PASS` / `FAIL` + 具体错误，最后一行是汇总。
- **退出码**：全部 PASS → `0`；任一 FAIL → `1`；缺 `jsonschema` 依赖 → `2`。
- 依赖：`jsonschema`（已列入 `finance/python/requirements-data.txt`）。缺依赖时的提示命令：
  `finance/python/.venv/Scripts/pip.exe install jsonschema`。

自测（examples 全量断言：valid 全 PASS、invalid 全 FAIL）：

```sh
finance/python/.venv/Scripts/python.exe finance/face-spec/test-face-spec.py
```

### 校验分工（schema 与程序化检查）

`face.schema.json`（JSON Schema 2020-12）负责：字段必填、类型、枚举、`additionalProperties: false`、
`blocks` 非空、`version` 字面量、`embed.path` 的 `..` 禁令、`type=select` 必须有 `options`（用 `if/then`）。

`validate_face.py` 在 schema 通过后追加**少量**程序化检查（JSON Schema 表达别扭或无法表达的部分）：

1. `param-form` 内 `fields[].name` 不得重复（渲染器按 name 收集参数）；
2. `fields[].default` 的运行时类型必须与声明的 `type` 一致，`select` 的 default 必须落在 `options` 内。

除这两条外的一切规则都在 schema 里，不在 Python 里。

## 6. AI 生成、渲染器唯一

- **组件集合封闭**：v1 只有上面 8 种。AI 不得自造组件类型或自定义样式——`type` 不在集合内直接被校验拒收。
- **配色、排版、交互由渲染器唯一决定**，face.json 里没有颜色、字号、CSS、脚本字段，将来也不会有。
  AI 只决定"摆什么、调哪个 verb、传什么参数"。
- **生成后必须过校验**：`validate_face.py` 全 PASS 才算生成完成；未通过的脸不写进 manifest。
- **坏了重新生成**：脸是投影，任何不满意/失效/风格漂移都靠重新生成解决，不手修 face.json。
  手修会让脸与生成它的规则脱节，下一个版本又漂回去。

## 7. 生成一张脸的最短路径

1. 读该版本的 `manifest.yaml`：`kind`、`verbs`、`freshness`、`interface`——脸的 verb 只能取 `verbs` 里的。
2. 按资产类型的"好脸规则"选组件（见 `finance/skills/findeck-asset-face/SKILL.md`）。
   例如 dataset 必须露出 `as_of` 与行数（两个 `metric-card`）+ `preview` 的 `data-table`。
   注意 `data-table` 的 `params.n` 控制 **head（最早 n 行）**；要展示**最新** n 行写 `params: {"n": 0, "tail": N}`
   （`n: 0` 让 head 为空，渲染器才落到 tail 窗口）。
3. 写 `vN/face.json`。
4. 跑 `validate_face.py` 直到全 PASS。
5. manifest.yaml 追加 `face: face.json`，对已入库资产调 `assets.reindex()` 刷新索引。

## 8. 目录内容

```
finance/face-spec/
├── face.schema.json            # 唯一权威 schema（JSON Schema 2020-12）
├── validate_face.py            # 校验器 CLI（schema + 少量程序化检查）
├── test-face-spec.py           # 自测：examples 全量断言
├── verb-bridge.md              # verb 执行桥协议（脸 → 按钮 → 结果回流）
├── README.md                   # 本文件
└── examples/
    ├── valid/                  # 3 个合法用例（含 param-form+action-button 组合、embed）
    └── invalid/                # 6 个非法用例（未知 type、缺 verb、embed 越界 ……）
```

## 9. P3 渲染器（预告）

P3 的资产页面读 face.json 渲染，按钮/表单一律经 verb 执行桥（`finance/python/findeck/verb_bridge.py`）
落到资产本体上执行，返回结构化的 `result` 再回流到组件。渲染器不执行任何 face.json 自带的代码，
也不接受 face.json 里的样式指令——这是"渲染器唯一"的落地方式。
