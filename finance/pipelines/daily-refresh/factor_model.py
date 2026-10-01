"""daily-refresh 步骤 2：用库内最新面板训练沪深300月度收益排序模型。

输入资产：``hs300-monthly-panel``（最新面板）。
产物：``produces.out``（默认 ``output/hs300_rank_model.pkl``，pickle 字典：
estimator / features / 样本外指标 / RankIC / ICIR）。
评估口径：quickmodels.fit_predict 的 5 折时间序列 CV 样本外预测，按月横截面算 Spearman RankIC，
ICIR = RankIC 均值 / 标准差。validation 里的数字全部来自本次实跑。
"""
from __future__ import annotations

import pickle
from datetime import date

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from _common import FEATURES, MODEL, PANEL, asset_file, asset_manifest, build_dataset, emit_meta, out_path, step_params
from findeck import quickmodels


def _rank_ic(preds: pd.Series, target: pd.Series) -> tuple[float, float, int]:
    """按月横截面算 RankIC 均值与 ICIR（横截面至少 5 只股票才算一个月）。"""
    ev = pd.DataFrame({'pred': preds, 'y': target.reindex(preds.index)}).dropna()
    ics = [float(spearmanr(g['pred'], g['y']).statistic)
           for _, g in ev.groupby(level='date') if len(g) >= 5]
    ics = [i for i in ics if np.isfinite(i)]
    if not ics:
        return float('nan'), float('nan'), 0
    mean = float(np.mean(ics))
    std = float(np.std(ics, ddof=1)) if len(ics) > 1 else float('nan')
    icir = mean / std if std and np.isfinite(std) and std > 0 else float('nan')
    return mean, icir, len(ics)


def main() -> None:
    params = step_params()
    model = str(params.get('model', 'ridge'))
    est_params = params.get('estimator_params') or params.get('model_params') or {'alpha': 1.0}
    n_splits = int(params.get('n_splits', 5))
    window_years = params.get('window_years', 8)
    out = out_path('output/hs300_rank_model.pkl')

    panel = pd.read_parquet(asset_file(PANEL, '.parquet'))
    panel_as_of = (asset_manifest(PANEL).get('freshness') or {}).get('as_of')
    frame = build_dataset(panel, window_years)
    target = frame['fwd_ret']
    X = frame[FEATURES]
    used = X.notna().all(axis=1) & target.notna()
    n_train = int(used.sum())
    print(f'[factor-model] 面板 {len(panel)} 行 / {panel["code"].nunique()} 只代码，as_of={panel_as_of}；'
          f'窗口 {window_years} 年 → 建模表 {len(frame)} 行（可用 {n_train} 行），因子 {len(FEATURES)} 个')

    r = quickmodels.fit_predict(X, target, model=model, features=FEATURES,
                               params=est_params, n_splits=n_splits)
    rank_ic, icir, n_ic = _rank_ic(r['predictions'], target)
    mean = r['metrics']['mean']
    estimator = r['fitted']
    if estimator is None:
        raise SystemExit('quickmodels 未返回拟合好的估计器，无法落模型文件')
    payload = {
        'model': model,
        'estimator': estimator,
        'features': FEATURES,
        'estimator_params': est_params,
        'window_years': window_years,
        'n_splits': n_splits,
        'folds': len(r['metrics']['folds']),
        'n_train': n_train,
        'cv_mean': mean,
        'rank_ic': rank_ic,
        'icir': icir,
        'ic_months': n_ic,
        'panel_as_of': panel_as_of,
        'trained_through': str(frame.index.get_level_values('date').max().date()),
        'created': date.today().isoformat(),
        'note': 'estimator = 最后一折时间序列 CV 训练段拟合的估计器；指标为各折样本外汇总',
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('wb') as f:
        pickle.dump(payload, f)
    print(f'[factor-model] CV 均值 {({k: round(v, 4) for k, v in mean.items()})}；'
          f'样本外 RankIC={rank_ic:.4f}，ICIR={icir:.3f}（{n_ic} 个月横截面）')
    print(f'[factor-model] 产物 -> {out}（{out.stat().st_size} bytes，模型 {model}）')
    validation = (f'实测样本外 RankIC={rank_ic:.4f}，ICIR={icir:.3f}（{n_ic} 个月横截面、'
                  f'{len(r["metrics"]["folds"])} 折时间序列 CV）；模型 {model}{est_params}；'
                  f'训练样本 {n_train} 行（窗口 {window_years} 年，面板 as_of={panel_as_of}）')
    emit_meta(validation, tags=['hs300', 'monthly', 'rank-model'])


if __name__ == '__main__':
    main()
