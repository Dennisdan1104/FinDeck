---
name: findeck-macro-playbook
description: >
  中文：宏观研究剧本——常用分析框架与数据对照表：美林时钟（增长×通胀→资产轮动）、利率传导（政策利率→债券→股市估值）、信用周期（社融/M2→经济领先）、汇率与流动性、政策跟踪清单，数据接口对应 akshare/FRED/yfinance。用户问"现在处于什么宏观环境""降息对股市影响"这类宏观问题时用本 Skill。
  English: Macro research playbook — frameworks and their data mapping: the Merrill Lynch clock (growth × inflation → asset rotation), rate transmission (policy rate → bonds → equity valuations), the credit cycle (TSF/M2 leading indicator), FX and liquidity, and a policy watchlist on akshare/FRED/yfinance.
whenToUse: 当任务涉及宏观经济判断、政策解读、大类资产配置逻辑、利率/通胀/汇率影响分析时使用。
---

# 宏观研究剧本

原则：**框架先行，数据落地**。先说出你的假设属于哪个框架，再用数据验证，
不要数据堆砌没有逻辑。

## 剧本一：美林时钟（增长 × 通胀 → 资产轮动）

| 象限 | 增长 | 通胀 | 占优资产 |
|---|---|---|---|
| 复苏 | ↑ | ↓ | **股票** |
| 过热 | ↑ | ↑ | **商品** |
| 滞胀 | ↓ | ↑ | **现金** |
| 衰退 | ↓ | ↓ | **债券** |

**中国数据落地**（akshare，见 market-data-cn）：
增长代理：`macro_china_pmi`（50 荣枯线）、`macro_china_gdp_yearly`、工业增加值；
通胀代理：`macro_china_cpi`、`macro_china_ppi`；
验证资产：沪深300 `index_zh_a_hist('000300')`、国债ETF(511260)、黄金ETF(518880)、螺纹钢 `futures_main_sina('RB0')`。
画图：三个代理指标的标准化对比（z-score 或同比）+ 资产表现，read_image 展示。

**美国版**（FRED：`fred.get_series`，见 market-data-global）：
增长：`UNRATE`（失业率，反向）、`PAYEMS` 环比；通胀：`CPIAUCSL` 同比、`PCEPI`。

## 剧本二：利率传导链

```
政策利率(OMO/LPR or 联邦基金)
  → 资金利率(DR007 / SOFR)
    → 债券收益率(10Y 国债)
      → 股市估值(PE 重心，成长股久期长更敏感)
        → 房地产/信贷需求
```

验证要点：
1. 政策利率变了没有、市场利率跟了没有（有时传导堵塞，那是重要发现）；
2. 10Y-1Y 期限利差走阔=复苏预期，倒挂=衰退信号（美债 `DGS10-DGS1` or yfinance `^TNX`）；
3. 股市对利率的敏感度：高 PE 指数（创业板）vs 低 PE（上证50）在利率下行期的相对表现。

**中国利率数据**：`macro_china_lpr`、DR007 用银行间数据接口；**美国**：FRED `DFF`/`DGS10`。

## 剧本三：信用周期（最可靠的领先指标之一）

社融增量 `macro_china_shrzgm` 与 M2 增速是经济的领先指标（领先约 2-4 个季度）：
社融放量 → 信用扩张 → 经济企稳 → 企业盈利改善 → 股市（尤其顺周期）。
**M2-社融 剪刀差**走阔往往对应资金空转/资产价格泡沫化。
验证：社融同比 vs 沪深300 提前 2 个季度叠加图。

## 剧本四：汇率与流动性

- 人民币汇率（`USDCNY=X` via yfinance）：贬值压力大时北向流出（`stock_hsgt_fund_flow_summary_em`）、
  货币政策空间受限。
- 美元指数（`DX-Y.NYB`）与全球风险偏好：美元强 → 新兴市场承压 → A股/港股流动性受损。
- 美股波动率 `^VIX`：>30 的恐慌区往往对应 A 股情绪底。

## 剧本五：政策事件跟踪清单

判断"政策底"的信号强度排序：
1. 定调变化（政治局会议表述，需上网搜最新会议通稿核实）；
2. 实质工具落地（降准/降息/财政赤字目标，akshare LPR/FRED 验证）；
3. 数据验证（社融、PMI 连续回升）。
只有 1 没有 23 = 情绪脉冲；123 齐备 = 趋势反转概率大。

## 输出规范

宏观结论必须写成"**证据 → 推理 → 概率判断**"三段：
- 证据：列出指标当前值+近12个月方向（附图表与数据截止日）；
- 推理：套用哪个剧本、链条哪一环；
- 判断：给出概率化表述（"倾向衰退象限，置信中等"），并写出"什么数据会推翻我"。
最后附免责声明（research skill）。
