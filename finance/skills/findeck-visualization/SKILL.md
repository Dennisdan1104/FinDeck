---
name: findeck-visualization
description: >
  中文：FinDeck 可视化手册——如何让图表真正显示在 Web UI 里。核心规则：markdown 里的本地图片路径不会渲染，必须用 read_image 工具读取 output/ 下的 PNG 才会变成图卡。含内置 charts 工具箱（价格图/净值回撤/特征重要度/相关性热力图）的函数表。跑模型、回测、出图任务必读。
  English: FinDeck visualization manual — how a chart actually appears in the Web UI: a local image path in markdown does not render, so the PNG must be read from output/ with read_image to become a chart card. Includes the bundled charts toolbox (price, NAV and drawdown, feature importance, correlation heatmap).
whenToUse: 当你要画图、想展示 PNG、或用户要求可视化（K线图、净值曲线、重要度、热力图）时使用。
---

# FinDeck 可视化

## 铁律：图要"显示"，必须走 read_image

Web UI 的 markdown **不渲染本地图片路径**（`![](output/x.png)` 只会显示成文字）。
正确姿势两步：

1. 用 `findeck.charts`（或 matplotlib）把图存到 `output/xxx.png`；
2. 调用 **`read_image` 工具**读取该路径 —— 图片会作为附件进入会话，在 UI 里渲染成图卡。

> 判断标准：用户说"给我看看 / 画出来 / 可视化" ⇒ 必须走 read_image；
> 只是中间调试 ⇒ 存盘即可，不必读。

## 内置图表工具箱（预装，直接 import）

```python
from findeck import charts
```

| 函数 | 用途 | 输入要点 |
|---|---|---|
| `charts.price_chart(df, title, ma=(5,20,60))` | 收盘价+均线+成交量 | df 需 `close`（可选 `volume`），DatetimeIndex 升序 |
| `charts.equity_curve(nav, benchmark=None, title)` | 净值 vs 基准 + 回撤填充 | 净值序列 1.0 起步；基准可选 |
| `charts.feature_importance_chart(imp, title, top=20)` | 特征重要度横条图 | 传 `fit_predict` 返回的 `importance` |
| `charts.corr_heatmap(df, title)` | 数值列相关性热力图 | 自动选数值列 |

全部返回**绝对路径**；中文字体已配置好。典型流水线：

```python
from findeck import charts, quickmodels
r = quickmodels.fit_predict(df, y, model='lightgbm', features=feats)
p = charts.feature_importance_chart(r['importance'], title='特征重要度')
print(p)          # 然后 read_image 读这个路径
```

## 自定义 matplotlib 图

工具箱没有的图自己画，但遵守同一约定：

```python
import matplotlib.pyplot as plt
from pathlib import Path
fig, ax = plt.subplots(figsize=(11, 5.5))
# ... 画 ...
Path('output').mkdir(exist_ok=True)
fig.savefig('output/my_chart.png', dpi=150, bbox_inches='tight')
# 然后 read_image('output/my_chart.png')
```

中文乱码时：`plt.rcParams['font.sans-serif']=['Microsoft YaHei','SimHei']`（findeck 已全局设置，自定义图同样受益）。

## 报告配图规范

- 每张图一个明确结论做标题（"茅台 PE 处于 5 年 82% 分位"），不要"图1"这种无信息标题。
- 关键图至少三件套：价格/净值走势、估值或对比、模型结果（重要度/IC）。
- 报告里引用图时写明数据来源与截止日期。
