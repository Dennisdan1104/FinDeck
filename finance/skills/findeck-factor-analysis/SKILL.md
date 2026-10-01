---
name: findeck-factor-analysis
description: >
  中文：因子分析手册——检验一个因子（特征）有没有预测力：IC 序列与 RankIC、分层回测（分组收益）、多空组合、因子相关性/共线性（VIF）、换手率，含基于预装库（pandas/sklearn/scipy）的完整代码模板。用户问"这个因子有效性怎么样""XX 指标能不能预测涨跌"时用本 Skill。
  English: Factor-analysis manual — test whether a factor (feature) predicts returns: IC and RankIC series, quantile backtests by group, long–short portfolios, factor correlation and collinearity (VIF), and turnover, with complete templates on the bundled pandas/sklearn/scipy.
whenToUse: 当需要评估因子预测力、做分层测试、构建多因子组合、检查因子间冗余时使用。
---

# 因子分析

前置：数据环境见 `findeck-python-env`；出图约定见 `findeck-visualization`。
因子 = 一个每期对每个标的计算的数值（如 20 日动量、PE、换手率变化），
因变量 = 未来 N 日收益或方向。

## 标准检验流程（按顺序）

### 1) IC 分析（信息系数）——因子有效性的第一道关

```python
import pandas as pd
from scipy.stats import spearmanr

def ic_series(panel: pd.DataFrame, factor: str, fwd_ret: str = 'fwd_ret_1d') -> pd.Series:
    """panel: index=(date, symbol) MultiIndex, 列含因子与未来收益。逐日截面 RankIC。"""
    def _day(g):
        ok = g[[factor, fwd_ret]].dropna()
        return spearmanr(ok[factor], ok[fwd_ret]).statistic if len(ok) > 10 else None
    return panel.groupby(level='date').apply(_day).dropna().rename('ic')

ic = ic_series(panel, 'mom_20')
print("IC均值 %.4f | ICIR(IC均值/IC标准差) %.2f | IC>0占比 %.1f%%"
      % (ic.mean(), ic.mean()/ic.std(), (ic > 0).mean()*100))
```

**判读基准**：|IC均值| > 0.02 弱有效，> 0.05 强；|ICIR| > 0.3 可交易化；
IC>0 占比 > 55% 说明方向稳定。三者要一起看。

### 2) 分层回测（分位数分组）——IC 之外看收益结构

```python
def layered_returns(panel: pd.DataFrame, factor: str, fwd_ret: str = 'fwd_ret_1d',
                    q: int = 5) -> pd.DataFrame:
    """逐日按因子分 q 组，返回各组平均未来收益（%）的累计净值。"""
    def _day(g):
        ok = g[[factor, fwd_ret]].dropna()
        if len(ok) < q * 3: return None
        grp = pd.qcut(ok[factor].rank(method='first'), q, labels=False)
        return ok.groupby(grp)[fwd_ret].mean()
    daily = panel.groupby(level='date').apply(_day).dropna()
    nav = (1 + daily).cumprod()
    return nav

nav = layered_returns(panel, 'mom_20')
print(nav.iloc[-1])                    # 各组终值：单调性一眼可见
```

**判读**：组间收益应单调（Q1 最差 Q5 最好或反之）；多空 = 做最好组做空最差组，
其夏普和回撤才是因子的真实含金量。画图：`from findeck import charts` 后
`charts.price_chart(df)`（df 需含 close 列），或直接把 `nav` 交给 `charts.equity_curve`。
展示方式见 `findeck-visualization`。

### 3) 因子相关性与冗余——组合前的体检

```python
from statsmodels.stats.outliers_influence import variance_inflation_factor
import statsmodels.api as sm
from findeck import charts

factors = ['mom_20', 'vol_20', 'turn_chg', 'pe_ttm']
X = sm.add_constant(panel[factors].dropna())
vif = pd.Series([variance_inflation_factor(X.values, i+1) for i in range(len(factors))],
                index=factors)
print(vif)          # VIF > 10 的因子与其他因子高度共线，考虑剔除或正交化
charts.corr_heatmap(panel[factors].dropna(), title='因子相关性')   # 记得 read_image
```

### 4) 换手率与衰减

逐期算因子排名的变化（`rank.pct_change().abs().mean()`）：
换手过高 → 交易成本吃掉收益。IC 衰减：把 fwd_ret 换成 5/10/20 日再看 IC，
衰减快的因子只适合短持有期。

## 多因子合成（简单有效版）

1. 横截面 z-score 标准化每个因子（`g.groupby('date')[f].transform(lambda s: (s-s.mean())/s.std())`）；
2. 剔除 VIF>10 的冗余因子；
3. 等权或 IC 加权求和得 composite；
4. 用 `findeck-quant-models` 的 LightGBM 也可以直接学非线性合成
   （`fit_predict` 输入多因子，看 `importance`）。

## 常见坑

- **截面太小**：某天只有 8 只股票，qcut 分组无意义；`len(ok) < q*3` 的日子跳过。
- **未来函数**：fwd_ret 必须 shift(-N) 构造；因子只允许用 T 日收盘可知的数据。
- **行业/市值污染**：动量因子可能只是行业 β。严谨做法按行业中性化
  （逐行业回归取残差），数据拿得到时（申万行业 via akshare `stock_board_industry_cons_em`）。
- **单一区间结论**：至少覆盖牛熊两段（如 2022 与 2024），IC 分年报告。
