---
name: findeck-market-data-global
description: >
  中文：全球市场金融数据获取手册——美股/全球股票/ETF/外汇/商品期货（yfinance，预装）与加密货币交易所行情（ccxt，预装），以及 FRED 宏观数据（需免费 key）。含代码模板、多标的批量拉取、代理配置。涉及美股、特斯拉、苹果、纳斯达克、比特币、BTC、以太坊、黄金、原油、美元指数、美联储利率等任务先用本 Skill。
  English: Global market-data manual — US and international equities, ETFs, FX, and commodity futures through the bundled yfinance, crypto exchange data through the bundled ccxt, and FRED macro series with a free key: code templates, multi-symbol batch pulls, and proxy setup.
whenToUse: 当任务涉及美国/港股以外的全球股票、指数（标普/纳指/道指）、外汇、大宗商品、加密货币、或美国宏观经济数据时使用。中国资产请用 findeck-market-data-cn。
---

# 全球市场数据获取

数据环境见 `findeck-python-env`。yfinance/ccxt 已预装。
**注意**：yfinance 与 ccxt 需要访问境外网络；国内环境如超时，给进程设代理 `HTTPS_PROXY=http://127.0.0.1:7890`（换成实际端口）。

## yfinance：股票/指数/ETF/外汇/商品

```python
import yfinance as yf

# 单标的，自动复权
df = yf.download("AAPL", start="2019-01-01", end="2026-09-01", auto_adjust=True)
print(df.tail())

# 多标的批量（列是 MultiIndex: field, ticker）
px = yf.download(["AAPL", "MSFT", "NVDA"], start="2024-01-01", auto_adjust=True)["Close"]

# 基本面/资讯（一个标的全套）
t = yf.Ticker("AAPL")
# t.info              # dict: 市值、PE、行业、52周高低、分析师目标价…
# t.financials        # 利润表（年度）；t.quarterly_financials 季度
# t.balance_sheet     # 资产负债表
# t.cashflow          # 现金流量表
# t.dividends         # 分红历史 (Series)
# t.earnings_dates    # 财报日
# t.news              # 近期新闻列表
```

**符号速查**：

| 资产 | 符号 |
|---|---|
| 标普500 / 纳指 / 道指 / VIX | `^GSPC` / `^IXIC` / `^DJI` / `^VIX` |
| 美元指数 | `DX-Y.NYB` |
| 人民币汇率 | `USDCNY=X`（`EURUSD=X`、`USDJPY=X` 同理） |
| 黄金 / 原油 / 天然气 | `GC=F` / `CL=F` / `NG=F` |
| 比特币（yfinance 也能拉） | `BTC-USD`（深度行情用 ccxt） |
| 常用 ETF | `SPY` `QQQ` `TLT`(美债) `GLD`(黄金) `UVXY`(波动率) |

## ccxt：加密货币交易所

```python
import ccxt
ex = ccxt.binance({"enableRateLimit": True})   # 免费无需 key；也可 okx/Bybit/coinbase 等

ohlcv = ex.fetch_ohlcv("BTC/USDT", timeframe="1d", limit=1000)  # [ts,o,h,l,c,v] 列表
ticker = ex.fetch_ticker("BTC/USDT")          # 最新价/24h量
depth  = ex.fetch_order_book("BTC/USDT", limit=50)  # 盘口

import pandas as pd
df = pd.DataFrame(ohlcv, columns=["ts","open","high","low","close","volume"])
df["date"] = pd.to_datetime(df["ts"], unit="ms")
df = df.set_index("date").drop(columns="ts")
```

- 历史 K 线超过单次 limit 时分页：传 `since=毫秒时间戳` 循环往后翻。
- timeframe：`1m/5m/1h/4h/1d/1w`。
- 交易所状态/精度：`ex.load_markets()`。

## FRED：美国宏观（需免费 API key）

```bash
<py> -m pip install fredapi
```
到 fred.stlouisfed.org/docs/api/api_key.html 免费申请 key，然后：

```python
from fredapi import Fred
fred = Fred(api_key="你的KEY")
rates = fred.get_series("DFF")      # 联邦基金利率
cpi   = fred.get_series("CPIAUCSL") # CPI
unemp = fred.get_series("UNRATE")   # 失业率
# 常用序列: FEDFUNDS, T10YIE(通胀预期), DGS10(十年美债), VIXCLS, PAYEMS(非农)
```

没有 key 时，可用 yfinance 的宏观代理：`^TNX`(十年美债收益率×10)、`^FVX`、`GLD`、`TLT` 等。

## 缓存与输出

沿用 `findeck-python-env` 的约定：`data/market_us_AAPL_daily.parquet`、`data/crypto_binance_btcusdt_1d.parquet`，图表存 `output/`。
真正调接口取数时走 `from findeck import snapshot as snap` 的 `snap.load_or_fetch(...)` 落快照（默认开，报告数字可复现，详见 `findeck-python-env`）。
