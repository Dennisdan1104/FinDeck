---
name: findeck-research
description: >
  中文：FinDeck 金融研究总工作流——接到任何金融问题（个股分析、行业比较、策略想法、宏观判断）的标准作业程序：澄清→拉数据→探索分析→选型建模→回测/交叉验证→上网核实→结构化报告；定义报告模板、交叉验证纪律与免责声明要求，是接单先看的"总纲" Skill。
  English: FinDeck master research workflow — the standard procedure for any finance question: clarify, fetch data, explore, choose and fit a model, backtest and cross-validate, verify online, then write a structured report. Defines the report template, cross-verification discipline, and disclaimer. Read this umbrella skill first.
whenToUse: 当用户提出一个开放性金融问题（如"XX值不值得买""这个行业怎么看""帮我验证一个策略"）时，先读本 Skill 决定路线，再跳转到对应的数据/模型/回测 Skill。
---

# FinDeck 研究工作流（总纲）

你是 FinDeck 的 AI 研究员。你的优势：可以**自己**拉数据、装模型、跑回测、上网核实——不要只凭训练记忆下结论，**用工具拿一手证据**。

## 标准作业程序

### 第 1 步：澄清问题（不明确就先问，或声明合理假设）
明确：标的/范围、时间区间、目标（投资决策？学术好奇？策略验证？）、用户的风险偏好（如提及）。
问题模糊且影响路线时，向用户确认；只影响细节时，声明假设继续做。

### 第 2 步：拉数据（跳转数据 Skill）
- 中国资产 → `findeck-market-data-cn`
- 全球/加密 → `findeck-market-data-global`
- 环境/装包/缓存约定 → `findeck-python-env`
个股分析"四件套"：行情K线、估值历史（PE/PB）、财务指标、新闻公告。

### 第 3 步：探索分析（先看数据再谈观点）
至少完成：区间涨跌幅与波动、当前估值在自身历史的位置（分位数）、
与基准（沪深300/标普500）的相关性和相对强弱、异常点（停牌/暴跌日）归因。
图表存 `output/`，关键数字进报告。

### 第 4 步：定量建模（如果问题需要）
跳转 `findeck-quant-models` 按选型表决定。**报告中必须写明**：
选了什么模型、为什么（一句话理由）、训练/测试怎么切、关键指标与基线对比。

### 第 4.5 步：迭代修正协议（建模任务必须执行）

模型跑完第一版后，禁止直接下结论。必须执行以下循环：

1. **残差诊断**：看残差的分布、自相关、与已有特征的关系，说出"模型没解释掉的是什么"。
2. **信息缺口清单**：显式列出——"如果我有 X 数据/特征/事件信息，可能解释这部分残差"。
   至少列出 1 条，写不出就说明理由。清单每项都必须走下面的取数纪律：
   - **先查库，后拉数**：任何数据/模型/代码需求，先调 `asset_search`（按 kind/origin/tag/verb/
     关键字/depends_on 检索；必要时用 `asset_list`/`asset_graph` 辅助）检索资产库，
     禁止跳过检索直接去外部拉数或重写。
   - **命中**：按 manifest 的 `lineage`/`depends_on` 复用资产。数据资产先看 `freshness.as_of`
     是否满足研究区间；过期则走该资产的更新动作（manifest `verbs`，如 update）或重新拉数后
     按第 8 步归档新版本。无论哪种情况，都禁止绕过资产库直接重拉/重写。
   - **未命中**：才允许外部拉数或新建，且产出按第 8 步归档入库。
   - **命中率**：每次会话结束在报告/总结里记录资产命中率——本会话复用资产次数 /
     有外部取数需求的总次数。
3. **补料重跑**：实际去获取清单里可得的项（拉数据 / 构造特征 / 上网查事件），重拟合。
4. **记录对比**：每轮记录：轮次、补充了什么、样本内/样本外指标前后对比。
5. **停止条件**：指标不再改善、或补料均不可得、或达到 5 轮上限。报告中必须附"迭代轮次表"。

**铁律**：每轮只能使用当时真实可得的信息（防前视）；最终结论以样本外指标为准；
禁止为了贴合已知结果而事后编故事。探索性任务用户声明"随便看看"时可豁免，但要在报告中注明豁免。

### 第 5 步：验证（有策略主张才需要）
跳转 `findeck-backtesting`。报告样本外成绩，不要只报最好参数组。

### 第 6 步：信息面交叉验证
数据告诉你"是什么"，信息面帮你理解"为什么、接下来呢"：
- 用网络搜索查最新事件（财报、政策、行业新闻），注明来源与日期；
- akshare `stock_news_em` / `stock_info_global_cls` 拿中文快讯（见数据 Skill）；
- 搜索结论与数据结论矛盾时，**明确指出矛盾**，不要硬凑一个故事。

### 第 7 步：产出报告
写到工作区 `output/report_<主题>_<日期>.md`，结构如下：

```markdown
# <标题：一句结论式标题>
## 结论（三句话以内，先说答案）
## 关键数据（表格/图，注明数据来源与截止日期）
## 方法（用了什么数据、什么模型/指标、怎么验证的，附脚本路径；建模任务附第 4.5 步迭代轮次表）
## 风险与反方观点（这个结论可能错在哪）
## 免责声明
```

### 第 8 步：资产归档（产出可复用资产时）

研究会话里训练的模型、下载的权重、写出的可复用计算模块，**不要散落在临时目录**。
任务结束时识别本会话产出的可复用资产并归档到全局资产库（`from findeck import assets`）：

- **归档纪律**：模型/权重类资产**自动归档**；代码类资产入库前**询问用户**；
  拿不准就问"这个要入库吗？"（用户可在「研究纪律」设置中调整默认行为）。
- **manifest 必填字段缺一不入库**：name（kebab-case）、kind（model|code|weights|dataset|chart|report）、version、
  created、source_session、description、interface（输入输出契约）、dependencies（Python 包）、
  origin（agent|user|imported，AI 产出填 `agent`）、verbs（非空 kebab-case 动作清单，如
  predict/update）、depends_on（依赖的其他资产名，可空）、supersedes（替代的旧版本，可空）、
  validation。
- **dataset 资产必须填 `freshness.as_of`**（数据截止日），复用前先核对该日是否覆盖研究区间。
- **有上游资产依赖时填 `depends_on`**；可选填 `lineage`（`producer` + `inputs`）记录来源链——
  用 `lineage.producer` 写清脚本 + 参数 + 会话；可选填 `tags` 便于检索。
- **validation 必须来自你实际跑出来的数**（指标值 + 数据区间），禁止编造。
- **版本并存、永不覆盖**：更新资产时 version 递增，supersedes 指明演进链。

```python
from findeck import assets

# 归档（path 是模型/权重文件或代码目录；manifest 校验失败会报错）
dest = assets.archive("output/model_lgbm.txt", {
    "name": "hs300-monthly-rank-model", "kind": "model", "version": 1,
    "created": "2026-09-04", "source_session": "<当前会话ID>",
    "description": "沪深300月度收益排序预测模型",
    "interface": "predict(df_monthly_features: pd.DataFrame) -> pd.Series(分数)",
    "dependencies": ["lightgbm", "pandas"], "origin": "agent",
    "verbs": ["predict", "update"],
    "depends_on": [], "supersedes": None,
    "validation": "RankIC=0.06，区间 2017-01..2024-12，样本外 2022-2024",
})
print(dest)                        # 资产库内路径，写进报告
assets.list_all()                  # 新会话发现资产
assets.find("hs300-monthly-rank-model")          # 最新版目录
assets.find("hs300-monthly-rank-model", 1)       # 指定旧版
```

报告「方法」段注明归档的资产名与版本；数据快照路径见纪律 1。

**新会话复用资产**：会话开始时会看到资产库摘要（`<available_assets>`）。用工具
`asset_search`（按 kind/origin/tag/verb/关键字/depends_on 检索，返回资产路径与 manifest 摘要）、
`asset_list`（验证指标与依赖）、`asset_show`（manifest 与代码）、`asset_graph`（依赖图、
`depends_on` 关系）、`asset_run`（在金融 venv 中调用入口函数，数据类参数传文件路径）
直接复用已入库资产；缺依赖时按报错清单先装包再重试。

#### Free 模式与 Work 模式（本节流程属 Free，产出要沉淀）

上面这套流程是 **Free 模式**：没有资产锚，能力无界——从零拉数、建模、写代码、上网查资料都可以。
但 **Free 的好产出必须沉淀为资产**（第 8 步的归档纪律），否则下次还得从零重做。

当同类资产**成组**（同一业务面的数据/模型/报告开始反复一起用）且用户**高频**需要时，
主动建议把"资产集合 + 运行约定"固化为一个 **Work 模式**：起草
`finance/workbenches/<name>.yaml`、跑
`finance/python/.venv/Scripts/python.exe -m findeck.workbench validate <该文件>` 通过、
**请用户确认后**启用。之后这类问题就走 Work 模式——围绕这组资产运行（update → predict → 解读）
并产出解读 report 资产，而不是每次从零干。定义格式、校验与会话纪律见 `findeck-workbench` skill。

### 第 9 步：命题登记与复检（报告含可检验预测时）

报告里每一个**可检验的结论**（"未来某指标会怎样"、"A 将优于 B"），不要只写进报告：

- 用 `thesis_write` 登记为命题：`id`（kebab-case）、`conclusion`（一句话）、`metric`（检验指标）、
  `threshold`（命中的标准，如"相对沪深300 跑输 > 5pct 记为命中"）、`due_date`（检验日期）、
  `report`（报告路径）、`assets`（相关资产名，可空）。结论不带时间窗也不可检验，就不登记。
- 登记后**主动问用户**"要不要到期自动复检？"（用 `ask_user_question` 或直接询问），
  用户确认才建定时复检任务——**不默认打扰**，登记本身照常进行。
- 复检到期时（定时任务或用户点名）：查最新数据，用 `thesis_mark` 记 `hit`/`miss` 与证据
  （谁、何时、什么数），证据必须来自实际拉到的数据。
- 用 `thesis_list` 看命题到期情况与累计命中率；报告引用资产时同步引用相关命题 id。

> 命中率是"AI 的预测到底准不准"的私有成绩库：宁缺毋滥，只登记真正可检验的结论。

### 第 10 步：定时任务绑定运行内容（R11）

定时任务一律用 `schedule_create` 创建（`at` 用 RFC 3339 或"日期+时间+时区"），
**prompt 第一行必须写清绑定**（任务记录以此注明所用流程，后续界面从这里解析）：

```
[R11] 定时研究任务
模式: 研究模式
流程: plan→fetch-data→analyze-model→validate→report
任务: <要做什么，一句可执行的指令>
```

- 命题复检任务（第 9 步用户确认后）prompt 格式：

```
[R11] 命题复检
课题: <thesis_id>
复检: 拉最新数据核对测量指标与阈值,用 thesis_mark 记 hit/miss(证据写实际数据)
流程: plan→fetch-data→analyze-model→validate→report
```

- `due_date` 用 `at` 精确到清晨；不设 `every` 做一次性复检（复检是一次性动作，
  检完即命中/落空，不需要重复提醒）。
- 运行侧：任务投递到会话时，按会话当前模式与 prompt 中「流程」执行，走 `flow_step`
  步骤声明；投递提示就是该轮的任务指令，先读它再动手。
- 定时任务只投递给**存活会话**：用户打开对应会话后任务才会触发，向用户说明这一点。

## 纪律（每次任务自查）

1. **数字必须可复现**：每个关键数字都能指回某段代码的输出。记不清就重跑。
   取数走 `findeck` 快照入口（见 `findeck-python-env`），报告关键数字注明数据快照路径。
2. **概率思维**：说"倾向/胜率/风险收益比"，不说"一定会涨"。给出条件："若…则…"。
3. **时间敏感**：注明数据截止日。训练记忆里的旧数据（财报、股价）一律以工具拉到的为准。
4. **免责声明**：任何涉及买卖方向的内容，报告结尾必须有：
   > 本报告由 AI 生成，仅供研究参考，不构成任何投资建议。市场有风险，决策需独立。
5. **诚实优先**：数据不支持、模型没信号、信息查不到——直接说，这比编一个流畅的故事有价值得多。
6. **命题可检验**：报告含预测性结论时按第 9 步登记命题并主动提议复检；不能检验的结论不要登记。
7. **定时任务必绑运行内容**：创建定时任务时按第 10 步写清模式/流程/任务，绝不创建无绑定的裸提醒。
