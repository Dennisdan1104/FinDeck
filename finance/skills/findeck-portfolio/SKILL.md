---
name: findeck-portfolio
description: >
  中文：投资组合构建手册——等权/市值加权/最小方差/风险平价/均值方差优化，净值与绩效评估（年化/夏普/回撤/相关性矩阵），仓位再平衡，基于预装库（numpy/scipy/pandas）的完整模板。用户说"帮我配一个组合""这几只股票怎么分配仓位""优化权重"时用本 Skill。
  English: Portfolio-construction manual — equal-weight, cap-weight, minimum-variance, risk-parity, and mean-variance optimization, NAV and performance evaluation (annualized return, Sharpe, drawdown, correlation matrix), and rebalancing, with complete templates on the bundled numpy/scipy/pandas.
whenToUse: 当任务涉及多资产配置、权重优化、组合绩效评估、分散化分析时使用。
---

# 投资组合构建

前置：数据环境见 `findeck-python-env`；出图见 `findeck-visualization`；
回测验证见 `findeck-backtesting`。
所有模板输入 `rets: pd.DataFrame`（index=日期, columns=标的, 值=日收益率）。

## 权重方案速查

| 方案 | 一句话 | 适用 |
|---|---|---|
| 等权 | 每只 1/N，按年再平衡 | 基线，小样本稳健 |
| 市值加权 | 按流通市值比例 | 跟踪指数化 |
| 最小方差 | 波动最小的权重 | 不想押注收益预测 |
| 风险平价 | 每只贡献相等风险 | 平衡波动贡献，桥水风格 |
| 均值方差(MVO) | 给定期收益下的最优 | 收益估计可靠时（危险：对输入极敏感） |

## 模板

```python
import numpy as np, pandas as pd
from scipy.optimize import minimize

def _checked(res, cols, label: str) -> pd.Series:
    """优化结果体检：不收敛 / 权重非有限 / 权重和不为 1 一律报错，不返回脏权重。"""
    if not res.success:
        raise RuntimeError(f"{label} 未收敛：{res.message}（检查目标收益是否可行、约束是否自相矛盾）")
    w = np.asarray(res.x, dtype=float)
    if not np.all(np.isfinite(w)):
        raise RuntimeError(f"{label} 返回非有限权重：{w}")
    if abs(w.sum() - 1) > 1e-6:
        raise RuntimeError(f"{label} 权重和 {w.sum():.6f} ≠ 1，约束未被满足")
    return pd.Series(w, index=cols)

def w_equal(rets):  return pd.Series(1/rets.shape[1], index=rets.columns)

def w_minvar(rets):
    cov = rets.cov().values * 252
    n = len(cov)
    fun = lambda w: w @ cov @ w
    cons = ({'type': 'eq', 'fun': lambda w: w.sum() - 1},)
    res = minimize(fun, np.ones(n)/n, constraints=cons, bounds=[(0, 1)]*n, method='SLSQP')
    return _checked(res, rets.columns, 'w_minvar')

def w_riskparity(rets):
    """风险平价：每只资产的风险贡献相等。"""
    cov = rets.cov().values * 252
    n = len(cov)
    def risk_contrib(w):
        rc = w * (cov @ w)
        return rc / rc.sum()
    fun = lambda w: np.sum((risk_contrib(w) - 1/n) ** 2)
    cons = ({'type': 'eq', 'fun': lambda w: w.sum() - 1},)
    res = minimize(fun, np.ones(n)/n, constraints=cons, bounds=[(0, 1)]*n,
                   method='SLSQP')
    return _checked(res, rets.columns, 'w_riskparity')

def w_mvo(rets, target_annual=0.10, max_w=0.4):
    """均值方差：组合年化收益 ≥ target_annual 下方差最小。收益预测用历史均值时要非常谨慎。

    `target_annual` 超过单票上限下的可达收益时问题无解——直接报错，
    不要拿没收敛/不可行的权重去下单。
    """
    mu = rets.mean().values * 252
    cov = rets.cov().values * 252
    n = len(mu)
    # 可行性上界：sum(w)=1 且 0<=w<=max_w 时，把上限尽量配给 mu 最高的标的
    order = np.sort(mu)[::-1]
    k = int(np.ceil(1 / max_w))
    reach = max_w * order[:k - 1].sum() + (1 - max_w * (k - 1)) * order[k - 1]
    if target_annual > reach + 1e-9:
        raise ValueError(f"target_annual={target_annual:.2%} 不可行：单票上限 {max_w:.0%} 下最高可达 {reach:.2%}")
    cons = ({'type': 'eq', 'fun': lambda w: w.sum() - 1},
            {'type': 'ineq', 'fun': lambda w: w @ mu - target_annual})
    res = minimize(lambda w: w @ cov @ w, np.ones(n)/n,
                   constraints=cons, bounds=[(0, max_w)]*n, method='SLSQP')
    return _checked(res, rets.columns, 'w_mvo')
```

## 组合净值与绩效

```python
def evaluate(rets: pd.DataFrame, w: pd.Series, label='组合'):
    port = rets @ w
    nav = (1 + port).cumprod()
    ann = port.mean() * 252
    sharpe = (port.mean() / port.std()) * np.sqrt(252) if port.std() > 0 else 0
    dd = (nav / nav.cummax() - 1).min()
    print(f"{label}: 年化 {ann:.1%} | 夏普 {sharpe:.2f} | 最大回撤 {dd:.1%}")
    return nav
```

对比基准（等权、沪深300），画 `charts.equity_curve(nav, benchmark=bench)`，
配 `charts.corr_heatmap(rets)` 看分散化成色，最后 read_image 展示。

## 纪律

1. **优化是放大器不是预言机**：MVO 对期望收益极其敏感，历史均值外推基本无效——
   用最小方差/风险平价更稳，MVO 只在用户明确给观点时用。
2. **样本外验证**：权重用前段数据算，后段验证净值；滚动窗口再平衡（季度常用）。
3. **约束现实**：单票上限（A 股常见 max 40%）、不做空（上面模板 bounds 已限）。
4. **成本**：再平衡换手 × 单边成本计入净值后再下结论。
5. 免责声明照 research skill 要求。
