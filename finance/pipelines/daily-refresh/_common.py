"""daily-refresh 三个步骤脚本的共用件：资产读取、步骤协议、月度因子构造。

步骤脚本协议（见 ``findeck.pipeline`` 模块说明）：
- 参数走环境变量 ``FINDECK_STEP_PARAMS``（JSON）；
- 产物写到 ``FINDECK_STEP_OUT``；
- stdout 最后一行必须是 ``###FINDECK_STEP_META### {...}``，validation 必须来自实跑。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'finance' / 'python'))  # 独立运行脚本时也能 import findeck

from findeck import assets  # noqa: E402

MARKER = '###FINDECK_STEP_META###'
PANEL = 'hs300-monthly-panel'
CONSTITUENTS = 'hs300-constituents'
MODEL = 'hs300-monthly-rank-model'

# 月度因子：动量 / 反转 / 波动 / 成交额比。全部只用 t 月及以前的信息，目标为 t+1 月收益。
FEATURES = ['mom_1', 'mom_3', 'mom_6', 'mom_12', 'rev_1', 'vol_3', 'vol_6', 'amt_ratio']


def step_params() -> dict:
    """读步骤参数（``FINDECK_STEP_PARAMS``，缺省空 dict）。"""
    raw = os.environ.get('FINDECK_STEP_PARAMS') or '{}'
    try:
        params = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f'FINDECK_STEP_PARAMS 不是合法 JSON: {raw!r}') from e
    if not isinstance(params, dict):
        raise SystemExit(f'FINDECK_STEP_PARAMS 必须是 JSON 对象: {params!r}')
    return params


def emit_meta(validation: str, **extra: object) -> None:
    """打印步骤 marker（stdout 最后一行）。"""
    payload = {'validation': validation, **extra}
    print(f'{MARKER} {json.dumps(payload, ensure_ascii=False)}')


def out_path(default: str) -> Path:
    """产物落盘路径：优先用执行器给的 ``FINDECK_STEP_OUT``，缺省按仓库相对路径。"""
    env = os.environ.get('FINDECK_STEP_OUT')
    return Path(env) if env else REPO / default


def asset_file(asset_name: str, suffix: str) -> Path:
    """取资产最新版本目录里指定后缀的最大文件（版本目录内只有产物与快照，取最大最稳）。"""
    d = assets.find(asset_name)
    candidates = sorted(d.glob(f'*{suffix}'), key=lambda p: p.stat().st_size, reverse=True)
    if not candidates:
        raise SystemExit(f'资产 {asset_name} 的最新版目录里没有 {suffix} 文件: {d}')
    return candidates[0]


def asset_manifest(asset_name: str) -> dict:
    """读资产最新版本的 manifest。"""
    import yaml

    return yaml.safe_load((assets.find(asset_name) / 'manifest.yaml').read_text(encoding='utf-8'))


def build_dataset(panel: pd.DataFrame, window_years: int | None = 8) -> pd.DataFrame:
    """把长表面板（code, date, OHLCV）变成建模表：索引 (date, code)，含因子列与下一月收益。

    行按日期时间升序排列（TimeSeriesSplit 按行切，必须时间有序）；``fwd_ret`` 在最后一个
    月为 NaN，正好留给预测用（做预测时选最新一月的横截面）。
    """
    p = panel.copy()
    p['date'] = pd.to_datetime(p['date'])
    p = p.sort_values(['code', 'date'])
    g = p.groupby('code', group_keys=False)
    p['ret'] = g['close'].pct_change()
    for k in (1, 3, 6, 12):
        p[f'mom_{k}'] = g['close'].pct_change(k)
    for k in (3, 6):
        p[f'vol_{k}'] = g['ret'].transform(lambda s, k=k: s.rolling(k).std())
    p['amt_ratio'] = g['amount'].transform(lambda s: s / s.rolling(6).mean() - 1)
    p['rev_1'] = -p['mom_1']
    p['fwd_ret'] = g['close'].transform(lambda s: s.shift(-1) / s - 1)

    frame = p.set_index(['date', 'code'])[FEATURES + ['fwd_ret']].sort_index()
    if window_years:
        last = frame.index.get_level_values('date').max()
        cutoff = last - pd.DateOffset(years=int(window_years))
        frame = frame[frame.index.get_level_values('date') >= cutoff]
    return frame


def latest_cross_section(frame: pd.DataFrame) -> pd.DataFrame:
    """最近一个月的横截面（因子无缺失），索引为 code。"""
    last_date = frame.index.get_level_values('date').max()
    rows = frame.xs(last_date, level='date').dropna(subset=FEATURES)
    if rows.empty:
        raise SystemExit(f'最新月份 {last_date.date()} 没有可用因子行')
    return rows
