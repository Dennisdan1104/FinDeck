---
name: findeck-market-data-cn
description: >
  中文：中国市场金融数据获取手册（A股/港股/指数/基金/期货/宏观/新闻公告），基于预装的 akshare 库（备选 baostock）。包含行情K线、财务报表、估值PE/PB、个股新闻、北向资金、行业板块、宏观数据（CPI/PMI/LPR/社融）的具体接口名、参数和代码模板。任何涉及中国股票、A股分析、宏观经济数据的任务先用本 Skill。
  English: China market-data manual (A-shares, Hong Kong, indices, funds, futures, macro, news) on the bundled akshare (baostock fallback): interface names, parameters, and templates for quotes, financials, PE/PB, stock news, northbound flows, sectors, and macro series (CPI/PMI/LPR/TSF).
whenToUse: 当任务涉及 A 股、港股、中国指数、公募基金、国内期货、或中国宏观经济数据时使用。
---

# 中国市场数据获取（akshare）

数据环境与解释器路径见 `findeck-python-env`（下文用 `<py>` 代指 venv 解释器）。
接口以东方财富/新浪/乐咕为主源，免费无需 token。**akshare 迭代快**：接口报错时先 `print(ak.__version__)`（≥1.14），再查 akshare.akfamily.xyz 对应接口文档。

## 接口速查表

| 数据 | 接口 | 关键参数/返回 |
|---|---|---|
| A股日线/周线/月线 | `ak.stock_zh_a_hist(symbol, period, start_date, end_date, adjust)` | symbol 无前缀如 `'600519'`；period `'daily'/'weekly'/'monthly'`；adjust `''`(不复权)/`'qfq'`(前复权,回测默认)/`'hfq'`；日期 `'20200101'` 格式；返回列：日期/开盘/收盘/最高/最低/成交量/成交额/振幅/涨跌幅/涨跌额/换手率 |
| 全市场实时快照 | `ak.stock_zh_a_spot_em()` | 全部A股当前价/涨跌幅/换手率/市值 |
| 个股资料 | `ak.stock_individual_info_em(symbol='600519')` | 总市值/流通市值/行业/上市时间 |
| 财务指标（多期） | `ak.stock_financial_analysis_indicator(symbol='600519')` | ROE/毛利率/资产负债率/每股收益 等，按报告期 |
| 三大报表 | `ak.stock_financial_report_sina(stock='sh600519', symbol='资产负债表')` | symbol 还可 `'利润表'`/`'现金流量表'`；注意 sh/sz 前缀 |
| 估值 PE/PB 历史（个股） | `ak.stock_zh_valuation_baidu(symbol='600519', indicator='市盈率(TTM)', period='近十年')` | 百度股市通；返回 `date`/`value` 两列，一次只取一个指标：indicator 取 `'总市值'/'市盈率(TTM)'/'市盈率(静)'/'市净率'/'市现率'`，period 取 `'近一年'/'近三年'/'近五年'/'近十年'/'全部'`（PE 与 PB 要分两次调用再按 date 合并） |
| 同行估值比较（个股） | `ak.stock_zh_valuation_comparison_em(symbol='SH600519')` | 东财 F10 行业截面，**交易所前缀在前**（`'SH'/'SZ'` + 代码）；返回 排名/代码/简称/PEG/市盈率-TTM/市净率-MRQ/… 外加"行业中值/行业平均"行。akshare 会把返回页末行提到首行（多数情况是查询标的，但**不保证**），一律按`代码`列筛选目标股，不要按行号取 |
| 个股新闻 | `ak.stock_news_em(symbol='600519')` | 标题/内容/发布时间/来源 |
| 财联社电报快讯 | `ak.stock_info_global_cls()` | 全市场实时快讯 |
| 北向资金 | `ak.stock_hsgt_fund_flow_summary_em()` | 沪股通/深股通净流入汇总 |
| 行业板块列表 | `ak.stock_board_industry_name_em()` | 东财**行业**板块（返回"板块名称"/"板块代码"列），如 小金属、酿酒行业 |
| 行业板块成分股 | `ak.stock_board_industry_cons_em(symbol='小金属')` | 板块名取自上一接口的"板块名称"列；也可直接传 `BKxxxx` 代码。传非行业名（如概念口径的"白酒"）会 IndexError |
| 概念板块列表 | `ak.stock_board_concept_name_em()` | 东财**概念/题材**板块，如 白酒、固态电池 |
| 概念板块成分股 | `ak.stock_board_concept_cons_em(symbol='白酒')` | 板块名取自上一接口；`白酒` 属概念口径（行业口径是 酿酒行业），两边不要混用 |
| 指数日线 | `ak.index_zh_a_hist(symbol='000300', period='daily', start_date, end_date)` | 沪深300；上证 `'000001'`、中证500 `'000905'`、创业板指 `'399006'` |
| 港股日线 | `ak.stock_hk_hist(symbol='00700', period='daily', adjust='qfq')` | 注意前导零 |
| ETF 日线 | `ak.fund_etf_hist_em(symbol='510300', period='daily', adjust='qfq')` | 沪深300ETF |
| 场外基金净值 | `ak.fund_open_fund_info_em(symbol='110022', indicator='累计净值走势')` |  |
| 期货主力连续 | `ak.futures_main_sina(symbol='RB0', start_date, end_date)` | 螺纹钢RB0、沪金AU0、原油SC0 |
| 宏观-CPI | `ak.macro_china_cpi()` | 国家统计局，月度 |
| 宏观-PMI | `ak.macro_china_pmi()` | 月度，50 为荣枯线 |
| 宏观-LPR | `ak.macro_china_lpr()` | 贷款市场报价利率 |
| 宏观-社融 | `ak.macro_china_shrzgm()` | 社会融资规模增量 |
| 宏观-GDP | `ak.macro_china_gdp_yearly()` |  |

## 标准代码模板（拉行情 + 快照 + 缓存）

```python
import akshare as ak
import pandas as pd
import time
from pathlib import Path
from findeck import snapshot as snap

def call_ak(fn, *args, retries: int = 3, **kwargs):
    """东财接口首次连接常被直接断开（RemoteDisconnected），必须带重试。"""
    for i in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1.5)

def load_cn_daily(symbol: str, start="20190101", end="20261231", adjust="qfq") -> pd.DataFrame:
    """A股日线：同参同日优先复用快照，否则拉接口（拉到即落快照），再写缓存。

    缓存键必须含全部取数参数：只按 symbol 缓存，换了 start/end/adjust 还会命中旧文件，
    静默返回过期数据。
    """
    p = Path("data") / f"market_cn_{symbol}_daily_{start}_{end}_{adjust or 'raw'}.parquet"
    if p.exists():
        return pd.read_parquet(p)
    df = snap.load_or_fetch(
        lambda: call_ak(ak.stock_zh_a_hist, symbol=symbol, period="daily",
                        start_date=start, end_date=end, adjust=adjust),
        "stock_zh_a_hist", symbol=symbol, period="daily",
        start_date=start, end_date=end, adjust=adjust)
    df = df.rename(columns={"日期": "date", "开盘": "open", "收盘": "close",
                            "最高": "high", "最低": "low", "成交量": "volume",
                            "成交额": "amount", "涨跌幅": "pct_chg"})
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    p.parent.mkdir(exist_ok=True)
    df.to_parquet(p)
    return df

df = load_cn_daily("600519")
print(df.tail(3), "\nrows:", len(df))
```

**快照纪律**（默认开，`FINDECK_SNAPSHOT=0` 关闭）：每次真正调接口取数都会在 `data/` 落一份
`snapshot_<接口名>_<参数摘要>_<日期>.parquet`，同参数同日重复取数自动复用（打印"复用快照"）。
自己写取数代码时统一走 `snap.load_or_fetch(fetch闭包, 接口名, **参数)` 或拉完调
`snap.snapshot(df, 接口名, **参数)`；报告关键数字注明快照路径，保证可复现（详见 `findeck-python-env`）。

## 常见坑

- **symbol 格式**：akshare 东财系接口不带交易所前缀（`600519`）；新浪系报表接口要 `sh600519`/`sz000001`（6开头=sh，0/3开头=sz）。
- **复权**：计算收益率/回测必须用 `qfq` 或 `hfq`，否则除权日会出现假暴跌。
- **限频与断连**：东财接口**首次请求常被直接断开**（`RemoteDisconnected`），一律带重试封装（见上面模板的 `call_ak`）；批量拉多只股票时循环里 `time.sleep(0.5)`。若重试后仍持续断连（IP 被临时反爬），**直接改用下方 baostock 模板**，过段时间再切回。
- **列名是中文**：拿到先 `print(df.columns.tolist())`，按需 rename 成英文小写再进模型。
- **乐咕（legulegu）系接口当前取不到数**：`stock_a_all_pb`、`stock_index_pe_lg`、`stock_index_pb_lg` 函数存在，但请求返回 None，实测报 `AttributeError: 'NoneType' object has no attribute 'attrs'`；估值走 `stock_zh_valuation_baidu`（个股 PE/PB 历史）与 `stock_zh_valuation_comparison_em`（同行截面）。

## 备选源：baostock（K线，更稳但更新慢）

```python
import baostock as bs
bs.login()
rs = bs.query_history_k_data_plus(
    "sh.600519", "date,open,high,low,close,volume,amount,turn,pctChg",
    start_date="2019-01-01", end_date="2026-12-31", frequency="d", adjustflag="2")  # 2=前复权
rows = []
while rs.error_code == '0' and rs.next():
    rows.append(rs.get_row_data())
bs.logout()
df = pd.DataFrame(rows, columns=rs.fields)
```

## 决策指引

- 个股全面分析：行情 + `stock_zh_valuation_baidu`(估值 PE-TTM/PB 历史) + `stock_financial_analysis_indicator`(质量) + `stock_news_em`(近况) 四件套；要横向比同行再加 `stock_zh_valuation_comparison_em`。
- 行业比较：`stock_board_industry_name_em` → 选行业板块 → `stock_board_industry_cons_em` 拿成分 → 逐个拉估值对比（记得限频）；题材口径改用 `stock_board_concept_name_em` → `stock_board_concept_cons_em`。
- 宏观叙事验证：先明确"市场在担心什么"（如 PMI 落荣枯线下），再用宏观数据核实，不要凭印象。
