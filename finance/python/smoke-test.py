# FinDeck 数据环境冒烟测试：三个市场源各拉一次真实数据。
# 用法: finance/python/.venv/Scripts/python.exe finance/python/smoke-test.py   (Windows)
#       finance/python/.venv/bin/python finance/python/smoke-test.py           (Linux/macOS)
# 判定: 国内源（akshare 或 baostock）至少一个成功 = PASS；境外源为信息项（国内网络常需代理）。
import sys
import time
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = Path("data")
results = []

# 取数区间相对今天：近一年。akshare 用 YYYYMMDD，baostock 用 YYYY-MM-DD。
START_AK = (date.today() - timedelta(days=365)).strftime("%Y%m%d")
END_AK = date.today().strftime("%Y%m%d")
START_ISO = (date.today() - timedelta(days=365)).isoformat()
END_ISO = date.today().isoformat()


def call_ak(fn, *args, retries: int = 3, **kwargs):
    for i in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1.5)


# 1) akshare: A股日线（东财源，偶发首次断连 → 带重试）
try:
    import akshare as ak
    df = call_ak(ak.stock_zh_a_hist, symbol="600519", period="daily",
                 start_date=START_AK, end_date=END_AK, adjust="qfq")
    DATA.mkdir(exist_ok=True)
    results.append(("PASS", "akshare", f"A股600519 rows={len(df)} last={df.iloc[-1]['日期']} close={df.iloc[-1]['收盘']}"))
except Exception as e:
    results.append(("FAIL", "akshare", f"{type(e).__name__}: {str(e)[:70]}"))

# 2) baostock: A股日线备选源
try:
    import baostock as bs
    import pandas as pd
    lg = bs.login()
    rs = bs.query_history_k_data_plus(
        "sh.600519", "date,open,high,low,close,volume",
        start_date=START_ISO, end_date=END_ISO, frequency="d", adjustflag="2")
    rows = []
    while rs.error_code == "0" and rs.next():
        rows.append(rs.get_row_data())
    bs.logout()
    if not rows:
        raise RuntimeError("empty result")
    results.append(("PASS", "baostock", f"A股600519 rows={len(rows)} last={rows[-1][0]} close={rows[-1][4]}"))
except Exception as e:
    results.append(("FAIL", "baostock", f"{type(e).__name__}: {str(e)[:70]}"))

# 3) yfinance: 美股（境外源，信息项）
# multi_level_index=False：yfinance 1.7 默认返回 MultiIndex 列，df['Close'] 会是 DataFrame。
try:
    import yfinance as yf
    df2 = yf.download("AAPL", period="1mo", auto_adjust=True, progress=False,
                      multi_level_index=False)
    if len(df2) == 0:
        raise RuntimeError("empty frame (rate limited / unreachable)")
    results.append(("PASS", "yfinance", f"AAPL rows={len(df2)} last_close={float(df2['Close'].iloc[-1]):.2f}"))
except Exception as e:
    results.append(("NET?", "yfinance", f"{type(e).__name__}: {str(e)[:60]}"))

# 4) ccxt: 加密货币（境外源，信息项）
try:
    import ccxt
    ex = ccxt.binance({"enableRateLimit": True, "timeout": 15000})
    t = ex.fetch_ticker("BTC/USDT")
    results.append(("PASS", "ccxt", f"BTC/USDT last={t['last']}"))
except Exception as e:
    results.append(("NET?", "ccxt", f"{type(e).__name__}: {str(e)[:60]}"))

for status, src, msg in results:
    print(f"[{status:>4}] {src:<9} {msg}")

cn_ok = any(s == "PASS" and src in ("akshare", "baostock") for s, src, _ in results)
print(f"\ngate (any domestic source): {'PASSED' if cn_ok else 'FAILED'}")
sys.exit(0 if cn_ok else 1)
