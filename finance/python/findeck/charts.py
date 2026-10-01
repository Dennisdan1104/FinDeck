"""研究图表工厂：把行情/回测/模型结果画成 PNG 存到 ``output/``。

所有函数返回图片的**绝对路径**。约定：画完图后调用方（AI）应当用
harness 的 ``read_image`` 工具读取该路径，Web UI 才会渲染成图卡——
markdown 里的本地图片路径不会渲染（见 findeck-visualization skill）。
"""
from __future__ import annotations

from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

__all__ = [
    'price_chart',
    'equity_curve',
    'feature_importance_chart',
    'corr_heatmap',
    'OUTPUT_DIR',
]

OUTPUT_DIR = Path('output')

# 中文字形回退链：Windows(SimHei/雅黑) → macOS(PingFang) → Linux(文泉驿/Noto)
matplotlib.rcParams['font.sans-serif'] = [
    'Microsoft YaHei', 'SimHei', 'PingFang SC', 'WenQuanYi Micro Hei', 'Noto Sans CJK SC',
    'DejaVu Sans',
]
matplotlib.rcParams['axes.unicode_minus'] = False


def _save(fig: plt.Figure, name: str, path: str | None) -> str:
    OUTPUT_DIR.mkdir(exist_ok=True)
    target = Path(path) if path else OUTPUT_DIR / f'{name}.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(target, dpi=150, bbox_inches='tight')
    plt.close(fig)
    return str(target.resolve())


def price_chart(
    df: pd.DataFrame,
    title: str = 'Price',
    ma: tuple[int, ...] = (5, 20, 60),
    path: str | None = None,
) -> str:
    """收盘价 + 均线 + 成交量的标准行情图。df 需含 close（可选 volume），DatetimeIndex 升序。"""
    fig, (ax, axv) = plt.subplots(
        2, 1, figsize=(12, 6.5), sharex=True, gridspec_kw={'height_ratios': [3, 1]},
    )
    ax.plot(df.index, df['close'], lw=1.4, color='#1a355e', label='收盘价')
    palette = ['#f5a623', '#3ed6c0', '#b06ab3']
    for i, w in enumerate(ma):
        if len(df) >= w:
            ax.plot(df.index, df['close'].rolling(w).mean(), lw=1.0,
                    color=palette[i % len(palette)], label=f'MA{w}', alpha=0.9)
    ax.set_title(title)
    ax.legend(loc='upper left', fontsize=9, ncol=4, frameon=False)
    ax.grid(alpha=0.25)
    if 'volume' in df.columns:
        axv.bar(df.index, df['volume'], width=1.0, color='#8fa3c0', alpha=0.7)
        axv.set_ylabel('成交量', fontsize=9)
        axv.grid(alpha=0.25)
    else:
        axv.set_visible(False)
    fig.autofmt_xdate()
    return _save(fig, 'price', path)


def equity_curve(
    nav: pd.Series,
    benchmark: pd.Series | None = None,
    title: str = 'Equity Curve',
    path: str | None = None,
) -> str:
    """策略净值 vs 基准（可选）+ 回撤填充。nav/benchmark 为净值序列（1.0 起）。"""
    fig, (ax, axd) = plt.subplots(
        2, 1, figsize=(12, 6), sharex=True, gridspec_kw={'height_ratios': [2.5, 1]},
    )
    ax.plot(nav.index, nav.values, lw=1.5, color='#1a355e', label='策略')
    if benchmark is not None:
        bench = benchmark.reindex(nav.index).ffill()
        ax.plot(bench.index, bench.values, lw=1.1, color='#9aa7b8', label='基准', alpha=0.9)
    ax.set_title(title)
    ax.set_ylabel('净值', fontsize=9)
    ax.legend(loc='upper left', fontsize=9, frameon=False)
    ax.grid(alpha=0.25)
    dd = nav / nav.cummax() - 1
    axd.fill_between(dd.index, dd.values * 100, 0, color='#c0504d', alpha=0.45)
    axd.set_ylabel('回撤 %', fontsize=9)
    axd.grid(alpha=0.25)
    fig.autofmt_xdate()
    return _save(fig, 'equity', path)


def feature_importance_chart(
    importance: pd.Series,
    title: str = 'Feature Importance',
    top: int = 20,
    path: str | None = None,
) -> str:
    """特征重要度横向条形图（树模型 gain / 线性模型 |coef|）。"""
    imp = importance.abs().sort_values(ascending=True).tail(top)
    fig, ax = plt.subplots(figsize=(9, max(3, 0.35 * len(imp) + 1.2)))
    ax.barh(imp.index.astype(str), imp.values, color='#3ed6c0')
    ax.set_title(title)
    ax.grid(alpha=0.25, axis='x')
    fig.tight_layout()
    return _save(fig, 'importance', path)


def corr_heatmap(
    df: pd.DataFrame,
    title: str = 'Correlation',
    path: str | None = None,
) -> str:
    """数值列相关性热力图。"""
    corr = df.select_dtypes('number').corr()
    fig, ax = plt.subplots(figsize=(max(6, 0.6 * len(corr) + 2), max(5, 0.5 * len(corr) + 2)))
    im = ax.imshow(corr.values, cmap='RdBu_r', vmin=-1, vmax=1)
    ax.set_xticks(range(len(corr)), corr.columns, rotation=45, ha='right', fontsize=9)
    ax.set_yticks(range(len(corr)), corr.columns, fontsize=9)
    for i in range(len(corr)):
        for j in range(len(corr)):
            ax.text(j, i, f'{corr.values[i, j]:.2f}', ha='center', va='center', fontsize=7.5)
    ax.set_title(title)
    fig.colorbar(im, shrink=0.8)
    fig.tight_layout()
    return _save(fig, 'corr', path)
