---
name: findeck-backtesting
description: >
  中文：策略回测手册——vectorbt（向量化，快速验证/参数扫描）与 backtrader（事件驱动，拟真交易）的安装、代码模板、数据接入（akshare/yfinance 直接喂入）、指标解读（年化/夏普/最大回撤/卡玛/胜率），以及未来函数、幸存者偏差、交易成本等致命坑的规避清单。验证交易策略、选股信号、均线/动量/轮动等任何策略有效性时用本 Skill。
  English: Strategy backtesting manual — vectorbt (vectorized validation and parameter sweeps) and backtrader (event-driven simulation) install and templates, akshare/yfinance data feeds, metric reading (CAGR, Sharpe, drawdown, Calmar, hit rate), and the lookahead, survivorship, and trading-cost trap list.
whenToUse: 当需要回答"这个策略行不行"、需要历史模拟验证信号、或用户给出买卖规则要评估时使用。
---

# 回测手册

数据环境见 `findeck-python-env`。回测库不预装，按需装：
`<py>` 代指数据环境解释器。

```bash
<py> -m pip install vectorbt      # 向量化：快，适合信号初筛和参数扫描
<py> -m pip install backtrader    # 事件驱动：拟真（限价单/仓位/手续费），适合最终验证
```

选型：**先 vectorbt 粗筛，像样的再 backtrader 精测**。两者都免费开源。

## vectorbt 模板（双均线示例 + 参数网格）

```python
import vectorbt as vbt
import pandas as pd

df = pd.read_parquet("data/market_cn_600519_daily.parquet")   # 列: open/high/low/close/volume, DatetimeIndex
px = df["close"]

# 单组参数
fast = vbt.MA.run(px, 10).ma
slow = vbt.MA.run(px, 30).ma
entries = fast.vbt.crossed_above(slow)
exits  = fast.vbt.crossed_below(slow)
pf = vbt.Portfolio.from_signals(px, entries, exits,
                                init_cash=100_000, fees=0.0003, freq="1D")
print(pf.stats())          # 总收益/夏普/最大回撤/胜率/交易次数 全都有

# 参数扫描（vectorbt 的强项：一次算完网格）
fast = vbt.MA.run(px, window=vbt.Param([5, 10, 20]))
slow = vbt.MA.run(px, window=vbt.Param([30, 60, 120]))
pf2 = vbt.Portfolio.from_signals(px, fast.ma.vbt.crossed_above(slow.ma),
                                 fast.ma.vbt.crossed_below(slow.ma),
                                 init_cash=100_000, fees=0.0003, freq="1D")
print(pf2.stats())          # 每组参数一行的成绩单
# 警告：挑参数最好的一组 = 过拟合。留出样本外区间再确认一次。
```

（注：`vbt.MA.run` 的 `window` 传 `vbt.Param` 列表即自动网格。）

## backtrader 模板（含手续费与绩效分析器）

```python
import backtrader as bt
import pandas as pd

class DualMA(bt.Strategy):
    params = dict(fast=10, slow=30)
    def __init__(self):
        self.fast = bt.ind.SMA(period=self.p.fast)
        self.slow = bt.ind.SMA(period=self.p.slow)
        self.xup = bt.ind.CrossOver(self.fast, self.slow)
    def next(self):
        if not self.position:
            if self.xup > 0: self.buy()                    # 全仓（演示用）
        elif self.xup < 0:
            self.close()

df = pd.read_parquet("data/market_cn_600519_daily.parquet")
data = bt.feeds.PandasData(dataname=df)                   # 需要 open/high/low/close/volume + DatetimeIndex

cerebro = bt.Cerebro()
cerebro.adddata(data)
cerebro.addstrategy(DualMA)
cerebro.broker.setcash(100_000)
cerebro.broker.setcommission(commission=0.0003)           # 万三（0.03%）单边，不含卖出印花税
cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe', timeframe=bt.TimeFrame.Days, riskfreerate=0.02)
cerebro.addanalyzer(bt.analyzers.DrawDown, _name='dd')
cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
res = cerebro.run()[0]
print("Sharpe:", res.analyzers.sharpe.get_analysis().get('sharperatio'))
print("MaxDD: %.1f%%" % res.analyzers.dd.get_analysis().max.drawdown)

tr = res.analyzers.trades.get_analysis()
def _total(node, *keys):
    """TradeAnalyzer 的键名大小写随 backtrader 版本变化（won/Won、total/Total），逐个尝试。"""
    for k in keys:
        sub = node.get(k)
        if isinstance(sub, dict):
            for t in ('total', 'Total'):
                if t in sub:
                    return sub[t]
    return 0

won, lost = _total(tr, 'won', 'Won'), _total(tr, 'lost', 'Lost')
print(f"Win rate: {won}/{won+lost} = {won/max(won+lost,1):.0%}")
cerebro.plot(volume=False)   # 需要 matplotlib（预装）
```

## 数据接入注意

- akshare 拉 A股后按 `findeck-market-data-cn` 模板把列名转成 `open/high/low/close/volume` + DatetimeIndex，两个回测库都直接吃。
- **必须用前复权（qfq/auto_adjust=True）**，否则分红除权会造成假信号。
- 加密货币：ccxt 的 OHLCV 直接是英文列，套用即可；7×24 无休，`freq="1D"` 按 UTC 自然日。

## 指标解读基准

| 指标 | 及格线参考 | 说明 |
|---|---|---|
| 年化收益 | > 买入持有才算有超额 | 一定要和"拿着不动"比 |
| 夏普 | > 1 可看，> 2 优秀 | 记得写明无风险利率假设 |
| 最大回撤 | 个人能承受为准（常见 >30% 已难拿住） | 和回撤持续天数一起看 |
| 卡玛比率 | 年化/最大回撤 > 1 | 风险调整后收益更直观 |
| 交易次数 | < 20 次无统计意义 | 次数太少的结果别当真 |

## 致命坑清单（回测好看≠能赚钱）

1. **未来函数**：信号用了当日收盘价，却假设当日收盘价成交。正确做法：T 日收盘出信号 → T+1 成交。
   backtrader 的 `coo`（cheat-on-open）**默认关闭、需显式 `cerebro.broker.set_coo(True)` 才开**，
   开了才能用当根 bar 的开盘价成交，正好是前视——保持默认即可；vectorbt 用 `price=px.shift(-1)` 类推。
2. **幸存者偏差**：只测了活到今天的股票，等于提前剔除了当年被调出/退市的输家。选股池必须是**回测时点当时**的成分名单：
   - 国证指数系（深证成指 `399001`、创业板指 `399006`、中小100 `399005`）有"历史调样"接口 `ak.index_detail_hist_adjust_cni(symbol='399001')`，列为 `开始日期/结束日期/样本代码/样本简称/所属行业/调整类型`（`OLD`=区间内保留、`+`=纳入、`-`=剔除）。重建时点名单：筛 `开始日期 <= 回测日 <= 结束日期`，取 `调整类型 in ('OLD','+')` 的 `样本代码` —— `399001` 按此式恰好 500 只。覆盖区间以接口返回为准（`399001` 自 2021-12 起），更早的回测拿不到。
   - 中证指数系（沪深300 `ak.index_stock_cons_csindex(symbol='000300')`、中证500 `'000905'`）和申万 `ak.index_component_sw(symbol='801001')` 只给**最新**名单/权重（申万带"计入日期"，仅能近似重建）。
   - 拿不到历史名单时，报告里必须写明这是幸存者偏差，并做一次"当前名单 vs 全市场池"的对照，而不是照抄结论。
3. **成本**：A股零售佣金约 万1~万3（单边，含规费）、过户费 0.001% 双向、印花税**只在卖出**收 0.05%。
   模板里的 `fees=0.0003` 只覆盖单边佣金+过户费、**不含印花税**：A股回测请把卖出侧成本加进去
   （双边合计约 0.11%），或直接把 `fees` 调到 0.0006 做保守估计。高频信号对成本极敏感，成本翻倍后结论若反转，就不是策略。
4. **过拟合**：参数网格最好的那组恰恰最可疑。把数据切成 段：开发段调参 → 样本段确认，报告样本段成绩。
5. **流动性**：小票/加密山寨币按收盘价全仓成交是幻觉，报告里注明容量假设。
