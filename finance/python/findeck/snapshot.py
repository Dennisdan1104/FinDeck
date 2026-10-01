"""数据快照纪律：拉取的原始数据落 parquet 归档，让报告数字可跨会话复现。

快照与缓存职责不同：缓存（见 findeck-python-env）是为了"本会话不重复拉数"，
快照是为了"任何时候能重算报告里的数字"。快照落在会话工作目录的 ``data/`` 下，
命名 ``snapshot_<接口名>_<参数摘要>_<日期>.parquet``；报告引用关键数字时应注明快照路径。

开关：环境变量 ``FINDECK_SNAPSHOT``，``0`` 关闭，默认开。
"""
from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

import pandas as pd

__all__ = ['enabled', 'snapshot_path', 'snapshot', 'load_or_fetch']

_SNAPSHOT_DIR = Path('data')


def enabled() -> bool:
    """快照开关是否打开（``FINDECK_SNAPSHOT=0`` 关闭，默认开）。"""
    return os.environ.get('FINDECK_SNAPSHOT', '1').strip() != '0'


def snapshot_path(source: str, **params: object) -> Path:
    """计算某次取数的快照路径（不读写文件）。

    :param source: 接口/数据源名，如 ``stock_zh_a_hist``。
    :param params: 该次调用的全部参数，参与摘要 hash；顺序无关。
    """
    digest = hashlib.sha1(
        json.dumps(params, sort_keys=True, ensure_ascii=False, default=str).encode('utf-8')
    ).hexdigest()[:8]
    day = datetime.now().strftime('%Y%m%d')
    return _SNAPSHOT_DIR / f'snapshot_{source}_{digest}_{day}.parquet'


def snapshot(df: pd.DataFrame, source: str, **params: object) -> Path:
    """把一份原始数据落成快照并打印路径（幂等：同参数同日覆盖写）。

    :param df: 接口返回的原始数据（建议 rename 前后均可，快照的是"接口给了什么"）。
    :param source: 接口/数据源名。
    :param params: 该次调用的全部参数。
    :returns: 快照文件路径。
    """
    p = snapshot_path(source, **params)
    p.parent.mkdir(exist_ok=True)
    df.to_parquet(p)
    print(f'[snapshot] {source} -> {p}')
    return p


def load_or_fetch(
    fetch: Callable[[], pd.DataFrame],
    source: str,
    **params: object,
) -> pd.DataFrame:
    """取数统一入口：同参数同日已有快照则复用，否则执行取数并落快照。

    :param fetch: 无参取数函数（真正调接口的闭包）。
    :param source: 接口/数据源名。
    :param params: 该次调用的全部参数。
    :returns: 原始数据；快照关闭时直接执行 ``fetch`` 不落盘。
    """
    if not enabled():
        return fetch()
    p = snapshot_path(source, **params)
    if p.exists():
        print(f'[snapshot] 复用快照 {source} <- {p}')
        return pd.read_parquet(p)
    df = fetch()
    snapshot(df, source, **params)
    return df
