# verb 执行桥协议（verb-bridge）

脸的按钮/表单不自己干活——它们只是**请求**。真正执行的是资产版本目录里的 verb，
执行桥负责把请求落到正确的资产版本上，并把结果回流成结构化响应。P3 的资产页面靠它接上后端。

实现：`finance/python/findeck/verb_bridge.py`（`execute(request) -> dict` + CLI）。

```
脸 / UI  ──请求 JSON──▶  verb_bridge  ──▶  资产库内某个版本目录
                                              ├── <verb>.py 脚本（子进程）
                                              ├── 同名函数
                                              └── 内建兜底（preview）
   脸 / UI  ◀──响应 JSON──┘
```

---

## 1. 请求

```json
{ "asset": "hs300-index-monthly", "version": 1, "verb": "preview", "params": { "n": 5 } }
```

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `asset` | 是 | string | 资产名（kebab-case）。只能是**库内资产**，不解析路径。 |
| `verb` | 是 | string | 动作名。必须在该版本 manifest 的 `verbs` 里声明。 |
| `version` | 否 | int | 目标版本号；省略取 `latest`（该资产的最大版本号）。 |
| `params` | 否 | object | 传给 verb 的参数；省略等价于 `{}`。 |

字段缺失或类型错误（`asset`/`verb` 非空字符串、`params` 是对象、`version` 是整数）一律返回
`status='error'`，不抛异常、不猜默认值。

## 2. 响应

```json
{
  "status": "ok",
  "asset": "hs300-index-monthly",
  "version": 1,
  "verb": "preview",
  "duration_s": 0.0409,
  "result": { "source": "ab_hs300_index_monthly.parquet", "columns": ["date", "..."],
              "dtypes": { "date": "datetime64[us]" }, "rows": 128, "head": [ { "date": "2016-01-29T00:00:00" } ] }
}
```

| 字段 | 何时出现 | 类型 | 说明 |
|---|---|---|---|
| `status` | 总是 | `"ok"` \| `"error"` | 唯一的成功判据。 |
| `asset` | 总是 | string \| null | 回显请求值；请求无法解析时为 `null`。 |
| `version` | 总是 | int \| null | **实际解析到**的版本号（省略 `version` 时这里给出 `latest` 的真实值）。 |
| `verb` | 总是 | string \| null | 回显请求值。 |
| `duration_s` | 总是 | number | 本次调用耗时（秒，保留 4 位）。 |
| `result` | `status='ok'` | 任意 JSON | verb 的返回值；无返回值时为 `{}`。 |
| `stdout` | 脚本路径且脚本被执行 | string | 子进程的完整 stdout（含 marker 行），便于 UI 展示原始输出。 |
| `error` | `status='error'` | string | 人类可读的失败原因。 |

**错误响应同样结构完整**——除 `result`/`stdout` 外的字段一律存在，调用方无需为空字段做特殊判断。

CLI 退出码与 `status` 对齐：`ok` → `0`，`error` → `1`（含请求 JSON 本身无法解析）。

### 组件如何消费 `result`

桥不解释 `result`，原样返回；消费规则在渲染器一侧，由 face.json 的组件类型决定：

| 组件 | 期望的 `result` |
|---|---|
| `metric-card` / `status-badge` | **标量**；返回字典时按 `extract` 点路径抽取（见下）。可用 `validation`、`rows`、`tail.-1.date`、`description` 等键 |
| `line-chart` | 可画成 `x`+`y` 的表（列名取自组件的 `x`/`y`）；只有 4a 数据表路径有 |
| `data-table` | 表：`{columns, rows, head, tail?}` 或行对象数组；只有 4a 数据表路径有 |
| `log-view` | 文本或行列表。取值次序：`result.text` → `result.files`（字符串数组，按行）→ 响应的 `stdout` |
| `action-button` / `param-form` | 不消费 `result`（触发类，只关心 `status`） |

**`metric-card` / `status-badge` 的抽取契约**：

1. `extract` 存在时，按点路径从 `result` 逐段下钻取值；段是标识符（字典键）或整数下标
   （列表下标，负下标从尾部数）。例如内建 `preview` 的返回上：
   - `extract: "rows"` → 总行数（整数，4a）；
   - `extract: "tail.-1.date"` → **最新一期日期**（配 `params: {"tail": 1}`，4a）；
   - `extract: "validation"` → **实测指标文本**（4b，模型/报告资产露样本外指标就用它）；
   - `extract: "description"` / `"created"` → 4b 的资产自述字段；
   - `extract: "head.-1.date"` → `head` 窗口最后一条记录的日期。注意 `head` 是**前** n 行窗口
     （`df.head(n)`），`n` 小于行数时 `-1` 指向第 n 行而非最后一行——取最新一期请用 `tail`。
   - `extract` 只能取到**标量**：`files` 这类字符串数组交给 `log-view`，不要用 `metric-card`。
2. `extract` 缺省时，渲染器按组件约定自取：`result` 是标量就直接用；是字典时 `metric-card`
   优先取数值标量键（`rows`、`ic`、`sharpe` …），`status-badge` 优先取 `status`/`state`/`badge`。
3. 抽取不到时显示空值，**不回退成整个字典**。

同一次调用的 `result` 可以被同一张脸的多个组件消费（例如 `preview` 同时喂 `data-table`、
`line-chart` 和两个 `metric-card`），渲染器可以对相同的 `asset`+`verb`+`params` 去重只调一次。
4b 路径上同一份摘要也能同时喂 `metric-card`（`extract: "validation"`）和 `log-view`（`text`／`files`）。

## 3. verb 解析约定（convention over configuration）

按顺序逐级尝试，**manifest 结构不变**——约定全部落在文件命名与函数命名上。

### 第 1 级：verb 声明检查（安全闸门）

读版本目录的 `manifest.yaml`，`verb` 必须在 `verbs` 列表中；否则：

```json
{"status": "error", "error": "verb 'fly' 未在 manifest.verbs 中声明: ['preview']"}
```

这一级先于一切执行：**库内资产不会因为脸上写了什么就跑到没声明的动作**。

**例外：`preview` 豁免本级检查。** `preview` 是只读的内建检视动作（第 4 级兜底实现），
不执行任何资产自带代码、不产生副作用，且**所有资产天然具备**——因此无论 manifest 的 `verbs`
是否列出它，`preview` 都放行（模型/代码/报告资产没声明 `preview` 也能被检视，这正是 4b 路径的用途）。
豁免只限 `preview` 这一个内建动作：**其他任何 verb（包括资产自己声明的、实现为脚本/函数的）
都必须先声明**，否则照旧被本级拦下。

> 注意区分「声明」与「处理器」：声明检查通过 ≠ 有东西可跑。例如某资产声明了 `retrain` 却没有
> `retrain.py`／同名函数，请求会走到第 5 级报 `verb 无处理器`——这是正确路径，不是闸门失效。

### 第 2 级：`<verb>.py` 脚本

版本目录内存在 `<verb>.py` → 作为**子进程**运行：

- `cwd` = 版本目录；`sys.executable` 为当前解释器；
- 环境变量 `FINDECK_VERB_PARAMS` = `params` 的 JSON 文本；
- 环境变量 `PYTHONIOENCODING=utf-8`（固定子进程输出编码）；
- **stdout 末尾的最后一行** `###FINDECK_VERB_RESULT### <json>` 解析为 `result`；
- 退出码 ≠ 0，或 marker 缺失/JSON 非法 → `status='error'`，同时返回已捕获的 `stdout`；
- 超时上限 `FINDECK_VERB_TIMEOUT` 秒（默认 600），超时即 error。

```python
# <version-dir>/retrain.py
import json, os
params = json.loads(os.environ["FINDECK_VERB_PARAMS"])
print("正在重训……")
print("###FINDECK_VERB_RESULT### " + json.dumps({"ic": 0.043}, ensure_ascii=False))
```

### 第 3 级：同名函数

版本目录内任一 `.py` 定义了与 verb 同名的函数 → 以 `params` 为关键字参数调用，返回值即 `result`。
函数名含连字符的 verb 亦接受下划线写法（`run-factor` ≡ `run_factor`）。查找按文件名字典序，
命中即停；导入或调用抛异常时返回 error（消息含文件名与函数名）。

```python
# <version-dir>/factors.py
def retrain(n_estimators=300, objective="regression"):
    return {"ic": 0.043}
```

### 第 4 级：内建兜底 —— `preview`

`verb == 'preview'` 时按资产形态走两条路之一。`preview` **豁免第 1 级声明检查**（见上），
所以任何资产都能被检视，无需在自己的 `verbs` 里列出它。

#### 4a. 数据表路径（`kind=dataset` 且版本目录内有 `.parquet`/`.csv`）

读版本目录内**首个**（字典序）`.parquet` / `.csv`，返回：

```json
{ "source": "ab_hs300_index_monthly.parquet",
  "columns": ["date", "open", "high", "low", "close", "volume", "amount"],
  "dtypes": { "date": "datetime64[us]", "close": "float64" },
  "rows": 128,
  "head": [ { "date": "2016-01-29T00:00:00", "close": 2946.09 } ],
  "tail": [ { "date": "2026-08-31T00:00:00", "close": 4625.0862 } ] }
```

`params`：

| 键 | 类型 | 缺省 | 语义 |
|---|---|---|---|
| `n` | 非负整数 | `5` | `head` 的行数：数据的**前** n 行（`n=0` 时 `head` 为空数组）。 |
| `tail` | 正整数 | 无 | 数据的**末尾** n 行，写入 `tail` 键（结构同 `head`）。缺省时结果**不含** `tail` 键。 |

- **`head` 与 `tail` 是同一份数据的两个窗口，互不影响**，可以同时给；`head` 的原义（前 n 行）不变。
- **取最新一期用 `tail: 1` 配 `extract: "tail.-1.date"`**——`tail.-1` 就是最后一行的日期。
  不要用 `head.-1` 取最新一期：`head` 是前 n 行窗口，只有 `n` 覆盖全部行时它才落到末尾。
- 纯数据资产因此**零成本**就有一张可用的默认脸，不需要写任何脚本。
- `tail` 非正整数（`0`、`-3`、`1.5`、`"3"` 等）→ error；`n` 非法同理。
- 读文件失败（文件损坏、缺 pandas/pyarrow）→ error，不返回半截结果。

#### 4b. manifest 摘要路径（非 dataset，或 dataset 无可读数据表）

返回资产自述 + 文件清单，让没有数据表可读的资产（模型 / 代码 / 报告 / 图表）也有一张零成本的脸：

```json
{ "name": "hs300-daily-report", "kind": "report", "version": 1, "created": "2026-09-16",
  "description": "沪深300日报（…）", "validation": "实测日报已生成：…", "verbs": ["preview"],
  "freshness": null, "depends_on": ["hs300-monthly-panel", "hs300-monthly-rank-model"],
  "tags": ["hs300", "daily", "report"],
  "files": ["daily_report.md", "manifest.yaml"],
  "text": "# 沪深300日报 2026-09-16\n…" }
```

| 键 | 语义 |
|---|---|
| `name` / `kind` / `version` / `created` / `description` / `validation` | 直接取自 manifest 同名字段（`validation` 即该资产的实测指标文本）。 |
| `verbs` / `depends_on` / `tags` | 取自 manifest，缺省为空数组。 |
| `freshness` | 取自 manifest；未声明时为 `null`。 |
| `files` | 版本目录内全部文件的相对路径（含 `manifest.yaml` / `face.json`），字典序。 |
| `text` | **仅当**版本目录存在 `.md` / `.txt` 时出现：**首个**（路径字典序）该文件的内容，UTF-8（非法字节以 U+FFFD 替代）；超过 20KB 截断，末尾追加 `[已截断：仅显示前 20480 字节，完整内容见 <文件名>]`。 |

- `params.n` / `params.tail` 只作用于 4a；4b 路径**忽略**它们。
- 4b 路径不读数据文件，因此**不需要** pandas/pyarrow。

### 第 5 级：无处理器

`verb != 'preview'` 且前四级都没接住：

```json
{"status": "error", "error": "verb 无处理器: foo@v1 内无 run.py、无同名函数，且不适用内建兜底（verb='retrain', kind='model'）"}
```

## 4. 安全边界

- **只跑库内资产**：`asset` 只按名字在资产库根目录（`FINDECK_ASSET_DIR`，默认
  `~/.findeck/asset-library/`）内解析，不接路径、不接 `..`，不存在即 error。
- **verb 必须预声明**：第 1 级闸门保证"脸能点的动作"是 manifest 里写明的动作子集。
  脸本身不携带代码，也不携带样式。
- **不新开能力面**：执行桥只是把"已经在库里的脚本/函数"按参数跑一遍，
  它不下载、不安装、不注册任何东西。
- **两个已知边界（不是疏忽，是约定）**：
  1. 第 3 级会 import 版本目录内的 `.py`，因此该文件在**模块顶层**的代码会被执行——
     库内资产本就由本机 AI/用户产出，信任级别与 `assets.archive()` 拷贝进来的文件一致；
     要绝对隔离请在 `verb_bridge` 之外包一层沙箱。
  2. 第 2 级以当前解释器（venv python）运行脚本，脚本继承环境变量（含 `FINDECK_VERB_PARAMS`）。

## 5. CLI 用法

```sh
# 一次"按钮点击"的命令行模拟
finance/python/.venv/Scripts/python.exe -m findeck.verb_bridge \
  '{"asset":"hs300-index-monthly","verb":"preview","params":{"n":5}}'

# 也可从 stdin 读请求
echo '{"asset":"hs300-index-monthly","verb":"preview"}' | python -m findeck.verb_bridge
```

stdout 打印一行响应 JSON（`ensure_ascii=False`，中文原样输出）；退出码见 §2。

## 6. 后台执行（长任务）

同步调用（§5）会一直占到 verb 跑完——**重训、刷面板这类分钟级任务会占住调用方**（P3 的 BFF 超时、
圆桌里的一次发言）。`--background` 把执行交给一个**分离子进程**，调用方立刻拿到 `run_id`：

```sh
# 立刻打印 {"run_id": "20260916103000-9f3c1a2b", "status": "running"} 并 exit 0
finance/python/.venv/Scripts/python.exe -m findeck.verb_bridge --background \
  '{"asset":"hs300-index-monthly","verb":"preview","params":{"n":3}}'

# 稍后按 run_id 收结果
finance/python/.venv/Scripts/python.exe -m findeck.verb_bridge --status 20260916103000-9f3c1a2b
```

`--background` 只允许出现在**最前面**；其后的参数（请求 JSON，或省略参数走 stdin）语义与同步调用
完全一致——子进程跑的就是"去掉 `--background` 的原命令行"。请求 JSON 本身非法 → 照旧 exit 1，
**不产生 run 记录**；请求合法但内容会被判 error（未知资产/未声明 verb 等）→ 照常起后台 run，
失败落在记录的 `status='error'` 上。

### 6.1 run 记录

落在 `<asset_root>/runs/<run_id>.json`（`asset_root` 见 §4，默认 `~/.findeck/asset-library/`）：

```json
{ "run_id": "20260916103000-9f3c1a2b", "kind": "verb",
  "request": { "asset": "hs300-index-monthly", "verb": "preview", "params": { "n": 3 } },
  "status": "running", "ts_start": "2026-09-16T10:30:00.123+08:00",
  "session": "9afb8f8e-…", "ts_end": "2026-09-16T10:30:04.400+08:00", "duration_s": 4.28,
  "response": { "status": "ok", "asset": "hs300-index-monthly", "version": 1, "verb": "preview",
                "duration_s": 0.049, "result": { "rows": 128, "…": "…" } } }
```

| 字段 | 何时出现 | 说明 |
|---|---|---|
| `run_id` | 总是 | `YYYYmmddHHMMSS-<8 位 hex>`，同时是文件名 |
| `kind` | 总是 | `verb`（verb_bridge）/ `pipeline`（pipeline，见 pipeline 模块） |
| `request` | 总是 | 原始请求：verb 的请求 JSON，或 pipeline 的 `{path, mode}` |
| `status` | 总是 | `running` \| `ok` \| `error`，成功判据 |
| `ts_start` | 总是 | 起 run 的本地时间（ISO8601，毫秒精度） |
| `session` | 有 `DSH_SESSION_ID` 时 | 发起 run 的会话 id；圆桌等引擎按它过滤本桌 run |
| `ts_end` / `duration_s` | **仅终态** | 结束时间（ISO8601）与墙钟耗时（秒，2 位） |
| `response` | 终态且跑出了响应 | verb 的**完整响应**（结构同 §2）；pipeline 为 `{status, pipeline, steps}` |
| `error` | `status='error'` | 人类可读的失败原因（与 `response.error` 同一句） |

**缺省的键一律省略，不写显式 `null`**（同 manifest 的 R3 裁约）：running 的 run 没有
`ts_end` / `duration_s`，无会话的 run 没有 `session`，`ok` 的 run 没有 `error`。
子进程的 stdout/stderr 重定向到 `<asset_root>/runs/<run_id>.log`（排障用）。

### 6.2 `--status <run_id>`

打印 run 记录 JSON（原样，不裁剪 `response`），退出码：

| status | 退出码 | 含义 |
|---|---|---|
| `ok` | 0 | 跑完了，`response` 是完整响应 |
| `error` | 1 | 跑完了但失败，看 `error` |
| `running` | 2 | 还在跑，稍后再查 |
| （无此记录） | 4 | 打印 `{"run_id": …, "status": "missing", "error": …}` |

### 6.3 已知限制

- **进程被杀 → 记录停在 `running`**：分离子进程的退出码不可直接收获，终态由子进程自己在退出前
  写回；机器重启、任务管理器结束、父进程被强杀时它写不了，记录就永远停在 `running`。读者按
  `ts_start` 自行判断该 run 是否已成僵尸，本机制**不做超时回收**。
- **没有并发上限、没有取消接口**：`run_id` 是唯一句柄，发起即跑。
- run 记录与 `.log` **不自动清理**，`<asset_root>/runs/` 由使用者自行归档。

## 7. P3 UI 的调用方式（预告）

P3 的资产页面**不直接** import 这个模块，而是：

1. 页面按 face.json 渲染；数据类组件在打开时调一次桥，拿 `result` 填组件。
2. 按钮点击 / 表单提交 → 页面把 `{asset, version, verb, params}` 交给 BFF，
   BFF 以子进程方式执行 CLI 桥（`python -m findeck.verb_bridge '<json>'`），
   读 stdout 的响应 JSON，透传给前端。
3. BFF 只做转发与超时控制，不加业务逻辑——**协议就是这一份，前后端共用**。

把桥放在子进程而非进程内 import，是为了让一次按钮点击的失败（脚本崩了、超时了）
不会带走 Web 服务的进程；URL/路由由 P3 定义，本协议只约定 JSON。
