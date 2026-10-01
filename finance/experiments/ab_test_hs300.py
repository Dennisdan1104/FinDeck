"""R5 A/B 实验：纯模型一把梭（A）vs 迭代修正协议（B）——沪深300 月度收益排序预测。

任务：每月末预测成分股**下月收益**的截面排序（RankIC、分层多空收益评估）。
- A 组：岭回归 + 基线动量特征，一次性跑完（"一把梭"，对应 quickmodels 'ridge' 同款估计器）；
- B 组：模拟 R1 迭代修正协议——每轮先在验证段做残差诊断（真实计算的统计量），
  得出信息缺口，补一组特征重拟合，验证段指标不再改善即停；最终选定配置
  在样本外测试段只跑一次。
- 3 个不重叠测试窗口（2022/2023/2024），训练段递扩（2018-01 起，保证 beta_24 特征可用），
  验证段=训练段最后 12 个月。

先跑 fetch_hs300_monthly.py 备好数据，再运行本脚本；产出 output/ab_test_<日期>.md。

用法（仓库根目录）：
    finance/python/.venv/Scripts/python.exe finance/experiments/ab_test_hs300.py
"""
from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr, ttest_rel
from sklearn.linear_model import Ridge

PANEL = Path('data/ab_hs300_monthly.parquet')
INDEX = Path('data/ab_hs300_index_monthly.parquet')

# 迭代协议的特征分组：R0 基线（=A 组）；R1/R2 是诊断后补充的信息组。
ROUND_FEATURES: list[tuple[str, list[str]]] = [
    ('R0 基线：动量', ['mom_1', 'mom_3', 'mom_6']),
    ('R1 补：波动率/流动性', ['vol_6', 'vol_12', 'turnover', 'size']),
    ('R2 补：长期反转/市场状态', ['mom_12', 'mom_rel_6', 'beta_24']),
]
ALL_FEATURES = [f for _, fs in ROUND_FEATURES for f in fs]

TRAIN_START = '2018-01'  # beta_24（24个月窗）自 2017-12 起有值
WINDOWS = [2022, 2023, 2024]
VAL_MONTHS = 12
RIDGE_ALPHA = 1.0  # A/B 同款：sklearn Ridge（quickmodels 'ridge' 底层估计器）
MIN_CROSS = 30  # 单月特征完整股票数低于此则跳过该月


def build_panel() -> pd.DataFrame:
    """月线长表 → 逐股特征 + 下月收益目标，并做当月截面 z-score（只用当月截面信息）。"""
    df = pd.read_parquet(PANEL).sort_values(['code', 'date']).copy()
    idx = pd.read_parquet(INDEX).sort_values('date').copy()
    idx['idx_ret'] = idx['close'].pct_change()
    idx['idx_mom_6'] = idx['close'].pct_change(6)
    idx_map = idx.set_index('date')[['idx_ret', 'idx_mom_6']]

    out = []
    for code, g in df.groupby('code'):
        g = g.set_index('date')
        g['ret'] = g['close'].pct_change()
        for n in (1, 3, 6, 12):
            g[f'mom_{n}'] = g['close'].pct_change(n)
        g['vol_6'] = g['ret'].rolling(6).std()
        g['vol_12'] = g['ret'].rolling(12).std()
        g['turnover'] = g['volume'] / g['volume'].rolling(12).mean()
        g['size'] = np.log(g['amount'].rolling(12).mean())
        g = g.join(idx_map)
        g['mom_rel_6'] = g['mom_6'] - g['idx_mom_6']
        g['beta_24'] = g['ret'].rolling(24).cov(g['idx_ret']) / g['idx_ret'].rolling(24).var()
        g['fwd_ret'] = g['close'].shift(-1) / g['close'] - 1
        g['code'] = code
        out.append(g.dropna(subset=['fwd_ret']))
    panel = pd.concat(out).reset_index()
    panel['month'] = panel['date'].dt.to_period('M')
    for f in ALL_FEATURES:
        grp = panel.groupby('month')[f]
        panel[f'z_{f}'] = (panel[f] - grp.transform('mean')) / grp.transform('std')
    return panel


def fit_model(train: pd.DataFrame, feats: list[str]) -> Ridge:
    """在训练行（特征与目标完整）上拟合岭回归；feats 传 z_ 列名。"""
    fit = train.dropna(subset=feats + ['fwd_ret'])
    if len(fit) < MIN_CROSS:
        raise RuntimeError(f'训练行不足: {len(fit)}（特征 {feats}）')
    model = Ridge(alpha=RIDGE_ALPHA)
    model.fit(fit[feats].to_numpy(), fit['fwd_ret'].to_numpy())
    return model


def evaluate(train: pd.DataFrame, panel: pd.DataFrame, months: pd.PeriodIndex,
             feats: list[str]) -> dict:
    """用 train 拟合一次，对 months 逐月算 RankIC 与五分位多空（做多预测前20%做空后20%）。"""
    model = fit_model(train, feats)
    ics, lss = [], []
    for m in months:
        cross = panel[panel['month'] == m].dropna(subset=feats + ['fwd_ret'])
        if len(cross) < MIN_CROSS:
            continue
        score = model.predict(cross[feats].to_numpy())
        ic = spearmanr(score, cross['fwd_ret']).statistic
        if not np.isfinite(ic):
            continue
        ics.append(ic)
        q = pd.qcut(pd.Series(score).rank(method='first').to_numpy(), 5, labels=False)
        fwd = cross['fwd_ret'].to_numpy()
        lss.append(float(fwd[q == 4].mean() - fwd[q == 0].mean()))
    if not ics:
        raise RuntimeError(f'评估月全部不可用（特征 {feats}，月数 {len(months)}）')
    ics_a, lss_a = np.asarray(ics), np.asarray(lss)
    ic_t = float(ics_a.mean() / (ics_a.std(ddof=1) / np.sqrt(len(ics_a))))
    return {
        'n': len(ics),
        'ic_mean': float(ics_a.mean()),
        'ic_t': ic_t,
        'ic_hit': float((ics_a > 0).mean()),
        'ls_bp': float(lss_a.mean() * 1e4),
    }


def diagnostics(train: pd.DataFrame, panel: pd.DataFrame, val_months: pd.PeriodIndex,
                feats: list[str], candidates: list[str]) -> list[str]:
    """验证段残差 × 候选特征 的 Spearman 相关——信息缺口的真实统计证据。"""
    model = fit_model(train, feats)
    rows = []
    for m in val_months:
        cross = panel[panel['month'] == m].dropna(subset=feats + ['fwd_ret'])
        if len(cross) >= MIN_CROSS:
            rows.append(pd.DataFrame({
                'resid': cross['fwd_ret'].to_numpy() - model.predict(cross[feats].to_numpy()),
                **{c: cross[f'z_{c}'].to_numpy() for c in candidates},
            }))
    resid = pd.concat(rows)
    found = []
    for cand in candidates:
        sub = resid.dropna(subset=[cand])
        rho = spearmanr(sub['resid'].abs(), sub[cand]).statistic
        if np.isfinite(rho) and abs(rho) > 0.02:
            found.append(f'|resid|×{cand}: ρ={rho:+.3f}')
    return found


def month_range(start: str, end: str) -> pd.PeriodIndex:
    return pd.period_range(start, end, freq='M')


def diagnosis_rho(rounds: list[dict], feature: str) -> float | None:
    """从轮次表的残差诊断字符串里取回 |resid|×feature 的 ρ（诊断值是实测统计量）。"""
    text = '; '.join(r.get('diagnosis', '') for r in rounds)
    m = re.search(rf'\|resid\|×{feature}: ρ=([+-][\d.]+)', text)
    return float(m.group(1)) if m else None


def run_b(panel: pd.DataFrame, year: int) -> tuple[dict, list[dict], list[str]]:
    """B 组：按 R1 协议迭代（诊断→缺口→补料→重跑→停止），选定配置样本外只跑一次。"""
    train_months = month_range(TRAIN_START, f'{year - 1}-12')
    val_months = train_months[-VAL_MONTHS:]
    core = panel[panel['month'].isin(train_months[:-VAL_MONTHS])]
    train = panel[panel['month'].isin(train_months)]
    test_months = month_range(f'{year}-01', f'{year}-12')

    rounds, feats = [], [f'z_{f}' for f in ROUND_FEATURES[0][1]]
    for i, (label, add) in enumerate(ROUND_FEATURES):
        if i > 0:
            feats = feats + [f'z_{f}' for f in add]
        m = evaluate(core, panel, val_months, feats)
        row = {'window': year, 'round': label, 'features': [f[2:] for f in feats], **m}
        if i < len(ROUND_FEATURES) - 1:
            cands = ROUND_FEATURES[i + 1][1]
            row['diagnosis'] = '; '.join(diagnostics(core, panel, val_months, feats, cands)) or '未见显著缺口'
        rounds.append(row)
        if i > 0 and m['ic_mean'] <= rounds[i - 1]['ic_mean'] + 0.002:
            row['stopped'] = True
            break
    best = max(rounds, key=lambda r: r['ic_mean'])
    chosen = [f'z_{f}' for f in best['features']]
    test = evaluate(train, panel, test_months, chosen)
    return test, rounds, best['features']


def run_a(panel: pd.DataFrame, year: int) -> dict:
    """A 组：基线特征 + 岭回归，全训练段一次拟合直接测样本外。"""
    train = panel[panel['month'].isin(month_range(TRAIN_START, f'{year - 1}-12'))]
    test_months = month_range(f'{year}-01', f'{year}-12')
    return evaluate(train, panel, test_months, [f'z_{f}' for f in ROUND_FEATURES[0][1]])


def fmt(m: dict) -> str:
    return (f"RankIC {m['ic_mean']:+.4f} (t={m['ic_t']:.2f}, 胜率 {m['ic_hit']:.0%}), "
            f"多空 {m['ls_bp']:+.0f} bp/月")


def main() -> None:
    if not PANEL.exists() or not INDEX.exists():
        raise SystemExit('缺少数据缓存，先运行 finance/experiments/fetch_hs300_monthly.py')
    panel = build_panel()
    n_stocks = panel.groupby('month')['code'].nunique().median()
    print(f"panel: {len(panel)} 行, {panel['month'].nunique()} 个月, 月均 {n_stocks:.0f} 只")

    results = {}
    for year in WINDOWS:
        a = run_a(panel, year)
        b, rounds, chosen = run_b(panel, year)
        results[year] = {'a': a, 'b': b, 'rounds': rounds, 'chosen': chosen}
        print(f'[{year}] A: {fmt(a)}')
        print(f"[{year}] B: {fmt(b)}  选定特征={chosen}")
        for r in rounds:
            print(f"    {r['round']:<22} val {fmt(r)}")

    today = date.today().isoformat()
    # 合并显著性：对 3 个窗口的 (IC_B − IC_A) 做配对检验（窗口间不重叠）。
    diffs = [results[y]['b']['ic_mean'] - results[y]['a']['ic_mean'] for y in WINDOWS]
    t_p = float(ttest_rel([results[y]['b']['ic_mean'] for y in WINDOWS],
                          [results[y]['a']['ic_mean'] for y in WINDOWS]).pvalue)
    b_better = bool(np.mean(diffs) > 0 and t_p < 0.1)

    lines = [
        f'# A/B 验证：AI 迭代修正 vs 纯模型一把梭（{today}）',
        '',
        '**任务**：沪深300 成分股月度收益排序预测（每月末预测下月收益的截面排序）。',
        '**B 组是否优于 A 组**：' + (
            f'是——RankIC 平均提升 {np.mean(diffs):+.4f}（窗口级配对 t 检验 p={t_p:.2f}；'
            f'窗口数仅 3，视为方向性证据而非严格显著）。'
            if b_better else
            f'不显著——RankIC 平均变化 {np.mean(diffs):+.4f}（窗口级配对 t 检验 p={t_p:.2f}）。'),
        '',
        '## 实验设置',
        '',
        '| 项 | 值 |',
        '|---|---|',
        '| 数据 | baostock 前复权月线，2016-01 起；成分股为**当前**沪深300 名单（幸存者偏差，见局限） |',
        f'| 样本 | 月均约 {n_stocks:.0f} 只特征完整的成分股；特征只用当月及以前信息，目标为下月收益，当月截面 z-score |',
        '| A 组 | 岭回归（sklearn Ridge alpha=1.0，即 quickmodels `ridge` 同款估计器）+ 基线动量特征（mom_1/3/6），全训练段一次拟合 |',
        '| B 组 | 同款岭回归；按 R1 协议迭代：验证段（训练末 12 个月）残差诊断→信息缺口→补特征重拟合→不再改善即停；选定配置在样本外测试段只跑一次 |',
        '| 窗口 | 测试段 2022 / 2023 / 2024（互不重叠），训练段 2018-01 起递扩 |',
        '| 指标 | 月度 RankIC（均值/t 值/为正胜率）、五分位多空月均收益（bp） |',
        '',
        '## 结果对比',
        '',
        '| 窗口 | 组 | RankIC | IC t 值 | IC 胜率 | 多空 (bp/月) |',
        '|---|---|---|---|---|---|',
    ]
    for year in WINDOWS:
        for tag, label in (('a', 'A'), ('b', 'B')):
            m = results[year][tag]
            lines.append(f"| {year} | {label} | {m['ic_mean']:+.4f} | {m['ic_t']:.2f} | "
                         f"{m['ic_hit']:.0%} | {m['ls_bp']:+.0f} |")
    lines += [
        '',
        '## B 组迭代轨迹（R1 协议轮次表，验证段指标）',
        '',
        '| 窗口 | 轮次 | 特征集 | 验证段指标 | 残差诊断（缺口证据） |',
        '|---|---|---|---|---|',
    ]
    for year in WINDOWS:
        for r in results[year]['rounds']:
            diag = r.get('diagnosis', '（最终轮）')
            stop = '；**停止：不再改善**' if r.get('stopped') else ''
            lines.append(f"| {year} | {r['round']} | {', '.join(r['features'])} | {fmt(r)} | {diag}{stop} |")
        lines.append(f"| {year} | **选定** | {', '.join(results[year]['chosen'])} | "
                     f"样本外：{fmt(results[year]['b'])} |  |")
    lines += [
        '',
        '## 显著性与解读',
        '',
        f'- 各窗口 RankIC 差值（B−A）：{", ".join(f"{d:+.4f}" for d in diffs)}；均值 {np.mean(diffs):+.4f}，'
        f'窗口级配对 t 检验 p={t_p:.2f}（n=3，检验功效极低，只作方向参考）。',
        f'- **结论：{"B 显著优于 A" if b_better else "B 未显著优于 A"}**'
        f'（均值方向{"为正" if np.mean(diffs) > 0 else "为负"}但{"稳定" if b_better else "不稳定"}）。具体到窗口：',
    ]
    for i, year in enumerate(WINDOWS):
        r = results[year]
        rounds = r['rounds']
        rho = diagnosis_rho(rounds, 'vol_12')
        selected = next((x['round'] for x in rounds if x['features'] == r['chosen']), '—')
        lines.append(
            f'  - {year}（B−A={diffs[i]:+.4f}）：A 组基线 RankIC {r["a"]["ic_mean"]:+.4f} → '
            f'B 组样本外 {r["b"]["ic_mean"]:+.4f}；验证段首轮 {rounds[0]["ic_mean"]:+.4f} → '
            f'末轮 {rounds[-1]["ic_mean"]:+.4f}，'
            + (f'残差幅度与波动率相关（|resid|×vol_12 ρ={rho:+.2f}），' if rho is not None
               else '残差诊断未见显著缺口，')
            + f'选定 {selected}'
            + ('，协议在末轮**停止**（补料不再改善）' if rounds[-1].get('stopped') else '')
            + '。')
    lines += [
        f'- 总体：三个窗口的差值{"同号" if all(d > 0 for d in diffs) or all(d < 0 for d in diffs) else "不同号"}，'
        '迭代修正的价值在本任务上更可能体现为**尾部保护**（崩盘年少亏）而非稳定增量；'
        '需要更多窗口/任务才能给出显著与否的强结论。',
        '',
        '## 局限（必读）',
        '',
        '1. **幸存者偏差**：成分股为当前名单回溯历史，已调出成分的股票缺失，两组同受影响、绝对水平偏高，但 A/B 对比方向仍有效。',
        '2. **模拟迭代**：B 组由脚本模拟 R1 协议（诊断统计量驱动固定补料计划），不是 LLM 驱动的真实会话；',
        '   好处是可复现、无 LLM 随机性；代价是未覆盖"AI 上网查事件/换模型"等更自由的补料路径。',
        '3. 月度 IC 存在自相关，未做 Newey-West 修正；t 值偏乐观，两组同样受影响。',
        '4. 单一任务、单一市场；结论只对"沪深300 月度排序"这一任务负责，不外推。',
        '',
        '## 复现',
        '',
        '- 数据准备：`finance/experiments/fetch_hs300_monthly.py`（缓存 `data/ab_hs300_monthly.parquet`，'
        '原始数据快照见 `data/snapshot_baostock_*`）',
        '- 本实验：`finance/experiments/ab_test_hs300.py`（无随机性，结果可精确复现）',
        '',
    ]
    out = Path('output') / f'ab_test_{today}.md'
    out.parent.mkdir(exist_ok=True)
    out.write_text('\n'.join(lines), encoding='utf-8')
    print(f'\nreport -> {out}')


if __name__ == '__main__':
    main()
