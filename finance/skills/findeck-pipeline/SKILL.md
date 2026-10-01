---
name: findeck-pipeline
description: >
  中文：FinDeck 资产流水线（pipeline.yaml）的用法速查——定义格式与校验、步骤脚本协议（marker/参数/产物路径）、手动跑法与 harness 定时跑法、失败语义与版本递增纪律。要"让资产每天自动变新"（定时刷新面板/模型/日报）时读它。
  English: FinDeck asset-pipeline (pipeline.yaml) reference — definition format and validation, the step-script protocol (markers, parameters, artifact paths), manual and harness-scheduled runs, failure semantics, and the version-increment discipline. Read it to make an asset refresh itself daily.
whenToUse: 用户要定义/修改一条资产流水线、手动跑一次流水线、把流水线挂成定时任务，或流水线步骤失败要排查时。
---

# FinDeck 资产流水线

流水线 = **资产引用 + 参数化步骤 + 触发方式**。一条流水线把"消费上游资产 → 跑脚本 → 归档新版本资产"
串起来；血缘由执行器自动写进 manifest，脚本不用自己写 manifest。
校验器与执行器是 `finance/python/findeck/pipeline.py`，定义放 `finance/pipelines/<name>.yaml`，
步骤脚本放 `finance/pipelines/<name>/`。

## 1. pipeline.yaml 格式速查

```yaml
name: daily-refresh            # kebab-case，必须与文件名一致
description: 一句话
trigger: { kind: cron, schedule: "0 17 * * 1-5" }   # 或 { kind: manual }
steps:
  - id: update-panel           # kebab-case，流水线内唯一
    script: finance/pipelines/daily-refresh/update_panel.py   # 仓库相对路径，必须存在
    params: { probe_limit: 5 } # 可选 dict，经 FINDECK_STEP_PARAMS（JSON）传给脚本
    inputs: [hs300-monthly-panel]   # 可选，消费的上游资产名 → depends_on/lineage.inputs
    produces:                  # 可选；声明则步骤成功后执行器归档新版本
      name: hs300-monthly-panel
      kind: dataset            # model|code|weights|dataset|chart|report
      verbs: [preview, update] # kebab-case 非空
      description: 沪深300成分股月度面板
      interface: pd.read_parquet(...) -> DataFrame[...]
      out: output/hs300_monthly_panel.parquet   # 脚本落盘产物的仓库相对路径
      tags: [hs300, monthly]         # 可选（meta 未给 tags 时用它）
      dependencies: [pandas, pyarrow] # 可选，manifest 的 Python 依赖
      update_frequency: monthly       # 可选，仅 dataset，写进 freshness
```

未知字段会被拒绝（顶层、step、trigger、produces 各自有白名单），不做静默兜底。
写完/改完**必须**跑校验器：

```sh
cd <仓库根>
finance/python/.venv/Scripts/python.exe -m findeck.pipeline validate finance/pipelines/daily-refresh.yaml
```

通过打印 `[pipeline] 校验通过: <name>（N 步，trigger=...）`；失败退出码 1 并逐条打印中文错误
（指明了具体字段，如"步骤 x.script 文件不存在"）。校验规则要点：name 与文件名一致；step id 唯一且
kebab-case；script 文件必须存在；`trigger.kind` 合法、`kind=cron` 必填 cron `schedule`；
`produces.kind` 是六种之一、`produces.out` 必填且为仓库内相对路径。
`inputs` 的资产存在性**不在校验期检查**（执行期由 `assets.archive` 的悬空依赖警告兜住）。

## 2. 步骤脚本协议

脚本在**仓库根**为 cwd、用**资产库同一个 finance venv**（执行器直接复用 `sys.executable`）运行。
执行器给的环境变量：

| 变量 | 含义 |
|---|---|
| `FINDECK_STEP_PARAMS` | 该步 `params` 的 JSON 文本（缺省 `{}`） |
| `FINDECK_PIPELINE` / `FINDECK_STEP_ID` | 流水线名 / 步骤 id |
| `FINDECK_STEP_OUT` | 该步 `produces.out` 的绝对路径（无 produces 时为空串） |

脚本职责：

1. 从资产库读上游（`from findeck import assets`；`assets.find("<资产名>")` 拿最新版目录）；
2. 把产物写到 `produces.out`（等同 `FINDECK_STEP_OUT`）；
3. **stdout 最后一行**打印 marker：

```
###FINDECK_STEP_META### {"validation": "实测指标", "as_of": "2026-08-31", "tags": ["hs300"]}
```

- `validation` 必填且**必须来自本次实跑**（禁止静态填写、禁止编造）；
- `as_of` 仅 `kind=dataset` 必填（`YYYY-MM-DD`），取实际数据截止日；
- `tags` 可选（kebab-case）；marker 取 stdout **最后一处**出现的那行。

## 3. 手动跑法

```sh
cd <仓库根>
finance/python/.venv/Scripts/python.exe -m findeck.pipeline run finance/pipelines/daily-refresh.yaml
```

逐步打印进度与耗时；每步一行运行记录追加到 `~/.findeck/asset-library/pipeline-runs/<pipeline>.jsonl`
（`{ts, pipeline, step, status, produced, inputs, duration_s}`；`inputs` 是该步声明的上游资产名，
体检统计会把"作为上游被消费"也算作触碰）。跑完在资产库看新版本：
`~/.findeck/asset-library/<资产名>/vN/manifest.yaml` 与 `index.json`。
只跑某一步做调试时，可以手工设 `FINDECK_STEP_PARAMS` / `FINDECK_STEP_OUT` 后直接
`python finance/pipelines/<name>/<step>.py`（但这样不会归档、不会写运行记录）。

### 3.1 长流水线后台跑（`--background`）

同步 `run` 会占到整条流水线跑完（daily-refresh 是分钟级）。要"发起后不阻塞"就加 `--background`：

```sh
cd <仓库根>
finance/python/.venv/Scripts/python.exe -m findeck.pipeline run finance/pipelines/daily-refresh.yaml --background
# → 立刻打印 {"run_id": "20260919190131-f25c2398", "status": "running"}（exit 0）

finance/python/.venv/Scripts/python.exe -m findeck.pipeline --status 20260919190131-f25c2398
# → 打印 run 记录 JSON；退出码 ok→0 / error→1 / running→2 / 不存在→4
```

- run 记录落 `~/.findeck/asset-library/runs/<run_id>.json`，子进程 stdout/stderr 落同目录
  `<run_id>.log`（排障看它）；记录字段（`status`/`ts_start`/`duration_s`/`response`/`error`/
  `session`）与退出码约定见 `finance/face-spec/verb-bridge.md` §6，实现是 `findeck/background.py`。
- 拿到 `run_id` 后**先干别的**，隔几秒（长任务隔几十秒）查一次 `--status`；`running` 就继续等，
  `error` 看 `error` 字段与 `.log`。
- 后台跑与手动跑**语义完全相同**：照样逐步归档新版本、照样追加 `pipeline-runs/<pipeline>.jsonl`，
  只是执行发生在分离子进程里。
- 进程被杀时记录会停在 `running`（分离子进程的已知限制），目前没有取消接口。

## 4. 定时跑法（harness schedule）

用 `schedule_create` 建一个 cron 会话触发流水线（不要自己写系统 cron/计划任务），
定时消息要把流水线路径写清楚，示例：

```
运行 finance/pipelines/daily-refresh.yaml（python -m findeck.pipeline run ...，仓库根为 cwd），
并汇报产出资产版本（index.json 里的 vN）与运行记录。
```

`daily-refresh` 自身的 `trigger` 声明为 `{ kind: cron, schedule: "0 17 * * 1-5" }`（收盘后、周一至周五）；
`trigger` 是**给人和 AI 看的约定**，真正触发靠 harness 的定时任务——两边要写一致。
提醒：定时任务只投递给存活会话，用户打开会话后才会触发。

### 4.1 每周体检（weekly-healthcheck）

`finance/pipelines/weekly-healthcheck.yaml`（`trigger: {kind: cron, schedule: "0 9 * * 1"}`，每周一 9 点）
一步跑完资产库体检：`kind=dataset` 全量 `preview` 探活、按 `freshness` 映射判过期、
汇总 `usage.jsonl` + `pipeline-runs/*.jsonl` 算活物率（30 天）与死资产候选（90 天），
产出 report 资产 `asset-health-report`（`output/asset_health_report.md`）。
手动跑一次：

```sh
cd <仓库根>
finance/python/.venv/Scripts/python.exe -m findeck.pipeline run finance/pipelines/weekly-healthcheck.yaml
```

挂成定时任务的 `schedule_create` 实例（`at` 用 RFC 3339 或"日期+时间+时区"，`every` 用 cron 表达式）：

```
[R11] 定时任务
模式: Work 模式
流程: 运行 finance/pipelines/weekly-healthcheck.yaml
任务: 跑 weekly-healthcheck（python -m findeck.pipeline run ...，仓库根为 cwd），
     汇报 asset-health-report 的新版本号、活物率、探活失败/过期/死资产清单。
```

体检报告只是快照：报告里的"总资产数/活物率"不含本次体检自己刚产出的那个版本，属预期。

## 5. 失败语义

- 脚本退出码非 0 → 该步失败，**中止整条流水线**并报告失败步（后续步骤不跑），运行记录写 `status: failed`。
- 脚本成功但 stdout 没有 marker / marker 后不是合法 JSON → 同样判失败（不猜结果）。
- 声明了 `produces` 但 `produces.out` 不存在，或 dataset 步的 meta 缺 `as_of` → 判失败，不归档。
- 报错时看 stderr 末尾的脚本输出；修好脚本后直接重跑整条流水线（已完成的步骤会再产出一个新版本，
  这是版本递增纪律的一部分，不是 bug）。
- 因为"失败也不覆盖"，重跑不会破坏旧版本；要回退就把 manifest 指向旧版本目录。

**版本递增纪律**：执行器归档时 `version = 现有最大版 + 1`、`supersedes = "<资产>@v<前一版>"`、
`origin = agent`、`source_session = $DSH_SESSION_ID`（缺省 `pipeline`）、`depends_on = inputs`、
`lineage.producer = {script, params, session}`。**永不覆盖旧版本**；数据资产按 `freshness.as_of`
判断新鲜度，复用前先核对覆盖区间。
