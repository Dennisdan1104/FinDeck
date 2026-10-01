# Agent Note: 金融技能文档按已安装环境核实

Status: implemented

[English](2026-09-11-finance-skill-api-verification.md) | 中文

## 问题

十篇 `finance/skills/*/SKILL.md` 手册告诉模型该调哪个函数、该信哪个指标。一次审计把手册里声称的每个 akshare 函数与 `finance/python/setup-env.sh` 真正建出的 venv 逐一核对，发现手册已经与该环境脱节：

- `ak.stock_a_indicator_lg`（`alphadeck-market-data-cn`）与 `ak.index_stock_hist`（`alphadeck-backtesting`）在已安装的 akshare 里都不存在。两者都是承重的：前者是单只个股估值"四件套"的一根支柱，后者是唯一写明可获得历史指数成分股的路径。
- `quickmodels.fit_predict` 用 `est.predict` 的硬 0/1 标签推导分类 `auc` 与 `accuracy`，等于让 `roc_auc_score` 去评一个被量化的统计量（实测 0.6434，而同样折上的概率 AUC 是 0.6695）。`alphadeck-quant-models` 的"AUC 高于 0.55 才值得动手"正是建在这个数上。
- `lasso` 承诺 L1 稀疏，但分类路径映射到了普通的 `LogisticRegression`（sklearn 默认惩罚是 L2），因此从来没有系数被压到零。
- 交易成本差一个数量级：`commission=0.0003` 被标成"千三"（0.3%），实际是万三（0.03%）；紧邻的建议又把 A 股双边成本写成 0.1%–0.3%，而真实零售佣金是单边万1–万3。
- `requirements-data.txt` 只写下限、没有上限，因此解析出的 akshare 版本——正是手册所对照的那个依赖——取决于当天 PyPI 提供什么。两个死函数就是这样产生的。

两个用来证明这一层可用的脚本，在真正重要的场合跑不起来：`test-toolbox.py` 读 `data/market_cn_600519_daily_bs.parquet`，而仓库里没有任何脚本会生成该文件，且 `data/` 被 gitignore，所以它在全新克隆上以 `FileNotFoundError` 失败；并且 `pytest.ini`、`package.json`、CI 配置与 `scripts/` 全都不引用金融层，因此没有任何门禁会发现以上任何一条。

## 决策

写进技能文档的每个 API 名与每个数字，都先在已安装的 venv 里核实；并由环境把版本钉在让这些陈述成立的范围上。

- 死掉的估值调用替换为 `stock_zh_valuation_baidu(symbol, indicator, period)`，同伴表用 `stock_zh_valuation_comparison_em`，两者都先真实调用再写进文档。legulegu 系列（`stock_a_all_pb`、`stock_index_pe_lg`、`stock_index_pb_lg`）被否决：它们存在，但运行时返回 `None`。
- 历史指数成分股改由 `index_detail_hist_adjust_cni`（成分区间加调整类型）说明，它能重建过去的成分名单；`index_stock_cons_csindex` 与 `index_component_sw` 明确标注为只给最新名单，使幸存者偏差的警告可执行而非装饰。
- `quickmodels.fit_predict` 对分类器返回概率，并把硬标签单独带出，于是 AUC 是概率 AUC，策略阈值读作置信度。
- `lasso` 分类改用真正的 L1 惩罚，并按已安装 scikit-learn 接受的参数形态来选。
- `fit_predict` 新增 `purge` 与 `embargo`，`alphadeck-quant-models` 警告 `horizon > 1` 的目标会在 `TimeSeriesSplit` 各折之间重叠。
- `requirements-data.txt` 带上限、显式声明 `scipy`、并写明钉版策略；`akshare` 钉到次版本，因为手册跟随的正是它。
- `test-toolbox.py` 有缓存用缓存、无缓存走文档所述 akshare 路径抓取、离线时退到确定性合成数据，并打印实际走了哪条路。中英 README 改为描述这一行为，而不是声称一次从未发生的抓取。

## 备选方案

**只靠读已安装包的签名来核实手册。** 否决：签名自省会放过 `stock_a_all_pb`，它的失败发生在调用时而非导入时。留下来的函数都是被真实调用过的。

**把 akshare 钉死成精确版本，手册不动。** 否决：精确钉版只记录了一天的环境，而读手册的是一个在任务中途无法分辨"名字过时"与"名字有效"的模型。正确的名字加上有界范围，才能让两者同步。

**让 `test-toolbox.py` 保持需要手工前置数据，并把缺失文件写进文档。** 否决：跑不起来的回归测试不是回归测试，而且 README 里"需要真实数据"的说法本身就已经不实。

## 影响

- 技能里写出的调用在 `setup-env` 建出的环境里可用，且核实这两者的命令无需网络即可复现。
- 金融层在 `package.json`、`pytest.ini` 与 CI 中仍然没有门禁。这些修复靠钉版策略和下一个改技能的人维持，而非自动执行。
- `backtrader`、Chronos 与东方财富板块接口在此无法实测；涉及它们的片段读取两种键名写法、用 `getattr` 取默认值、并说明板块名必须来自哪个列表接口，而不是断言一个未经核实的行为。
- 读修正版手册的模型能拿到可用的调用；读到钉版范围之外版本的模型仍可能撞上被移动的 API，这是手册无法防止的。
