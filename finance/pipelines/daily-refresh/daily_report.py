"""daily-refresh 步骤 3：生成沪深300日报（面板 as_of + 模型最新预测 top10 + 验证指标摘录）。

输入资产：``hs300-monthly-panel``、``hs300-monthly-rank-model``。
产物：``output/daily_report_<date>.md``（当日报告），并复制一份到 ``produces.out``
（``output/daily_report.md``，稳定文件名，供执行器归档入库）。
"""
from __future__ import annotations

import pickle
import shutil
from datetime import date

import pandas as pd

from _common import FEATURES, MODEL, PANEL, asset_file, asset_manifest, build_dataset, emit_meta, out_path, step_params
from findeck import assets

TOP_N = 10


def main() -> None:
    params = step_params()
    top_n = int(params.get('top_n', TOP_N))
    out = out_path('output/daily_report.md')
    panel = pd.read_parquet(asset_file(PANEL, '.parquet'))
    panel_as_of = (asset_manifest(PANEL).get('freshness') or {}).get('as_of')
    panel_version = assets.find(PANEL).name
    with asset_file(MODEL, '.pkl').open('rb') as f:
        payload = pickle.load(f)
    model_version = assets.find(MODEL).name

    frame = build_dataset(panel, payload.get('window_years', 8))
    last_date = frame.index.get_level_values('date').max()
    latest = frame.xs(last_date, level='date')
    scored = latest.dropna(subset=FEATURES)
    X = scored[FEATURES]
    scores = pd.Series(payload['estimator'].predict(X), index=X.index, name='score')
    last_close = (panel.assign(date=pd.to_datetime(panel['date']))
                  .sort_values('date').groupby('code')['close'].last())
    top = scores.sort_values(ascending=False).head(top_n)

    today = date.today().isoformat()
    lines = [
        f'# 沪深300日报 {today}',
        '',
        f'- 数据面板：`{PANEL}@{panel_version}`，as_of={panel_as_of}，{len(panel)} 行 / '
        f'{panel["code"].nunique()} 只代码',
        f'- 排序模型：`{MODEL}@{model_version}`（{payload["model"]}{payload["estimator_params"]}），'
        f'样本外 RankIC={payload["rank_ic"]:.4f}，ICIR={payload["icir"]:.3f}，'
        f'训练至 {payload["trained_through"]}',
        f'- 预测月：{last_date.date()} 横截面（目标为下一月收益排序），打分 {len(scored)} 只',
        '',
        f'## 模型最新预测 Top{top_n}',
        '',
        '| 排名 | 代码 | 预测分数 | 最新收盘 | 上月收益 |',
        '|---|---|---|---|---|',
    ]
    for rank, (code, score) in enumerate(top.items(), 1):
        close = last_close.get(code)
        mom1 = scored.loc[code, 'mom_1']
        close_txt = f'{close:.2f}' if pd.notna(close) else '—'
        lines.append(f'| {rank} | {code} | {score:.4f} | {close_txt} | {mom1:+.2%} |')
    mean = payload['cv_mean']
    lines += [
        '',
        '## 验证指标摘录',
        '',
        f'- 样本外 RankIC = {payload["rank_ic"]:.4f}，ICIR = {payload["icir"]:.3f}'
        f'（{payload["ic_months"]} 个月横截面、{payload["folds"]} 折时间序列 CV）',
        f'- CV 均值：' + '，'.join(f'{k}={v:.4f}' for k, v in mean.items()),
        f'- 训练样本 {payload["n_train"]} 行（窗口 {payload["window_years"]} 年）',
        '',
        '> 本报告由 FinDeck 资产流水线 `daily-refresh` 自动生成，仅供研究参考，不构成任何投资建议。',
        '',
    ]
    report = '\n'.join(lines)
    dated = out.parent / f'daily_report_{today}.md'
    out.parent.mkdir(parents=True, exist_ok=True)
    dated.write_text(report, encoding='utf-8')
    shutil.copy2(dated, out)
    print(f'[daily-report] 报表 {len(report.splitlines())} 行，打分 {len(scored)} 只，'
          f'top{top_n} 分数 {top.iloc[0]:.4f}~{top.iloc[-1]:.4f}')
    print(f'[daily-report] 产物 -> {dated}（另存稳定副本 {out} 供归档）')
    validation = (f'实测日报已生成：面板 as_of={panel_as_of}（{len(panel)} 行 / '
                  f'{panel["code"].nunique()} 只代码），模型 {MODEL}@{model_version} '
                  f'样本外 RankIC={payload["rank_ic"]:.4f}，预测月 {last_date.date()} 打分 {len(scored)} 只，'
                  f'top{top_n} 分数区间 {top.iloc[0]:.4f}~{top.iloc[-1]:.4f}')
    emit_meta(validation, as_of=panel_as_of, tags=['hs300', 'daily', 'report'])


if __name__ == '__main__':
    main()
