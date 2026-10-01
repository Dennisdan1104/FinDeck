"""A/B 实验数据准备：沪深300 成分股月线面板（baostock 源）。

产出：
- data/ab_hs300_monthly.parquet    成分股月线长表（code, date, open/high/low/close/volume/amount）
- data/ab_hs300_index_monthly.parquet  沪深300 指数月线（做市场特征）
- 同步落数据快照（R8 纪律，见 findeck.snapshot）

用法（仓库根目录）：
    finance/python/.venv/Scripts/python.exe finance/experiments/fetch_hs300_monthly.py

幂等：缓存存在即跳过，删缓存重跑。东财（akshare）持续断连时用 baostock 兜底，
成分股清单是**当前**名单，存在幸存者偏差——实验报告必须注明此局限。
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import baostock as bs
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from findeck import snapshot as snap

START, END = '2016-01-01', '2026-09-01'
PANEL = Path('data/ab_hs300_monthly.parquet')
INDEX = Path('data/ab_hs300_index_monthly.parquet')


def fetch_monthly(code: str) -> pd.DataFrame:
    rs = bs.query_history_k_data_plus(
        code, 'date,open,high,low,close,volume,amount',
        start_date=START, end_date=END, frequency='m', adjustflag='2')
    rows = []
    while rs.error_code == '0' and rs.next():
        rows.append(rs.get_row_data())
    if rs.error_code != '0':
        raise RuntimeError(f'{code}: baostock error {rs.error_code} {rs.error_msg}')
    return pd.DataFrame(rows, columns=rs.fields)


def main() -> None:
    if PANEL.exists() and INDEX.exists():
        print(f'[cache] 复用 {PANEL} 与 {INDEX}，如需重拉请先删除')
        return

    bs.login()
    try:
        rs = bs.query_hs300_stocks()
        rows = []
        while rs.error_code == '0' and rs.next():
            rows.append(rs.get_row_data())
        if rs.error_code != '0':
            raise RuntimeError(f'query_hs300_stocks: {rs.error_code} {rs.error_msg}')
        cons = pd.DataFrame(rows, columns=rs.fields)
        snap.snapshot(cons, 'baostock_query_hs300_stocks', symbol='000300', date=cons['updateDate'].iloc[0])
        print(f'constituents: {len(cons)} (updateDate={cons["updateDate"].iloc[0]})')

        frames, skipped = [], []
        for i, code in enumerate(cons['code'], 1):
            try:
                one = fetch_monthly(code)
            except RuntimeError as e:
                skipped.append(str(e))
                continue
            if one.empty:
                skipped.append(f'{code}: empty')
                continue
            one.insert(0, 'code', code)
            frames.append(one)
            if i % 25 == 0 or i == len(cons):
                print(f'  {i}/{len(cons)} ok')
            time.sleep(0.05)

        panel = pd.concat(frames, ignore_index=True)
        for c in ('open', 'high', 'low', 'close', 'volume', 'amount'):
            # 停牌月数值列可能为空串，转 NaN；整月无K线则该行本来就不存在
            panel[c] = pd.to_numeric(panel[c], errors='coerce')
        panel = panel.dropna(subset=['close'])
        panel['date'] = pd.to_datetime(panel['date'])
        panel = panel.sort_values(['code', 'date']).reset_index(drop=True)
        PANEL.parent.mkdir(exist_ok=True)
        panel.to_parquet(PANEL)
        snap.snapshot(panel, 'baostock_hs300_monthly_panel', start=START, end=END, stocks=len(cons))
        print(f'panel: {len(panel)} rows, {panel["code"].nunique()} stocks -> {PANEL}')

        idx = fetch_monthly('sh.000300')
        for c in ('open', 'high', 'low', 'close', 'volume', 'amount'):
            idx[c] = pd.to_numeric(idx[c], errors='coerce')
        idx['date'] = pd.to_datetime(idx['date'])
        idx = idx.sort_values('date').reset_index(drop=True)
        idx.to_parquet(INDEX)
        snap.snapshot(idx, 'baostock_hs300_index_monthly', start=START, end=END)

        if skipped:
            print(f'skipped {len(skipped)}:')
            for s in skipped[:10]:
                print(' ', s)
    finally:
        bs.logout()


if __name__ == '__main__':
    main()
