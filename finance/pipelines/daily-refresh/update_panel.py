"""daily-refresh 步骤 1：刷新沪深300成分股月度面板（baostock 增量；离线则幂等重发库内面板）。

输入资产：``hs300-constituents``（成分股清单）、``hs300-monthly-panel``（当前面板）。
产物：``produces.out``（默认 ``output/hs300_monthly_panel.parquet``）。
纪律：拉数失败或源侧无新月份时**不做任何伪造推进**——原样重发库内最新面板，并在
``meta.validation`` 里如实写"数据未推进（离线/源无新数据），as_of=<实测>"。
"""
from __future__ import annotations

import time
from datetime import date

import pandas as pd

from _common import CONSTITUENTS, PANEL, asset_file, emit_meta, out_path, step_params

NUMERIC = ('open', 'high', 'low', 'close', 'volume', 'amount')
FIELDS = 'date,open,high,low,close,volume,amount'


def _fetch_monthly(bs, code: str, start: str, end: str) -> pd.DataFrame:
    rs = bs.query_history_k_data_plus(code, FIELDS, start_date=start, end_date=end,
                                      frequency='m', adjustflag='2')
    rows = []
    while rs.error_code == '0' and rs.next():
        rows.append(rs.get_row_data())
    if rs.error_code != '0':
        raise RuntimeError(f'{code}: baostock error {rs.error_code} {rs.error_msg}')
    return pd.DataFrame(rows, columns=rs.fields)


def _clean(rows: pd.DataFrame) -> pd.DataFrame:
    for c in NUMERIC:
        rows[c] = pd.to_numeric(rows[c], errors='coerce')
    rows['date'] = pd.to_datetime(rows['date'])
    return rows.dropna(subset=['close'])


def _try_increment(codes: list[str], start: str, today: str, probe_limit: int) -> tuple[str, pd.DataFrame | None]:
    """尝试从 baostock 拉 start..today 的新月度K线。

    先用少量代码（指数 + 前几只成分股）探针：探针全空即判定源侧无新数据，不再扫全表。
    :returns: (说明文字, 新增行 DataFrame 或 None)。
    """
    import baostock as bs

    login = bs.login()
    try:
        if login.error_code != '0':
            raise RuntimeError(f'baostock 登录失败: {login.error_code} {login.error_msg}')
        probe = ['sh.000300'] + codes[:probe_limit]
        hit = False
        for code in probe:
            if not _fetch_monthly(bs, code, start, today).empty:
                hit = True
                break
            time.sleep(0.05)
        if not hit:
            return f'baostock 可登录，探针 {len(probe)} 个代码在 {start}..{today} 无新月度K线', None
        frames, skipped = [], []
        for code in codes:
            try:
                one = _fetch_monthly(bs, code, start, today)
            except RuntimeError as e:
                skipped.append(str(e))
                continue
            if one.empty:
                continue
            one.insert(0, 'code', code)
            frames.append(one)
            time.sleep(0.05)
        if not frames:
            return f'探针命中但成分股全量拉取无新行（跳过 {len(skipped)} 只）', None
        note = f'baostock 增量 {start}..{today}，{len(frames)} 只代码有新月度K线'
        if skipped:
            note += f'，{len(skipped)} 只拉取失败'
        return note, _clean(pd.concat(frames, ignore_index=True))
    finally:
        bs.logout()


def main() -> None:
    params = step_params()
    probe_limit = int(params.get('probe_limit', 5))
    out = out_path('output/hs300_monthly_panel.parquet')

    panel = pd.read_parquet(asset_file(PANEL, '.parquet'))
    panel['date'] = pd.to_datetime(panel['date'])
    panel = panel.sort_values(['code', 'date']).reset_index(drop=True)
    codes = [str(c) for c in pd.read_parquet(asset_file(CONSTITUENTS, '.parquet'))['code'].tolist()]
    as_of = panel['date'].max()
    start = (as_of + pd.Timedelta(days=1)).strftime('%Y-%m-%d')
    today = date.today().isoformat()
    print(f'[update-panel] 库内面板 {len(panel)} 行 / {panel["code"].nunique()} 只代码，as_of={as_of.date()}；'
          f'成分股清单 {len(codes)} 只')

    added, new_rows, note = 0, None, ''
    if start > today:
        note = f'增量窗口为空（{start} 晚于今日 {today}）'
    else:
        try:
            note, new_rows = _try_increment(codes, start, today, probe_limit)
        except Exception as e:  # 离线、DNS、baostock 服务异常都按"未推进"处理，绝不伪造新数据
            note = f'离线/baostock 不可用（{type(e).__name__}: {e}）'
    if new_rows is not None:
        added = len(new_rows)
        panel = pd.concat([panel, new_rows], ignore_index=True)
        panel['date'] = pd.to_datetime(panel['date'])
        panel = (panel.drop_duplicates(subset=['code', 'date'], keep='last')
                 .sort_values(['code', 'date']).reset_index(drop=True))
    as_of_new = panel['date'].max().date().isoformat()
    n_rows, n_codes = len(panel), panel['code'].nunique()
    if added:
        validation = f'已增量追加 {added} 行（{note}），as_of={as_of_new}，面板 {n_rows} 行 / {n_codes} 只代码'
    else:
        validation = (f'数据未推进（{note}），as_of={as_of_new}，面板 {n_rows} 行 / {n_codes} 只代码'
                      '（幂等重发库内既有版本）')
    out.parent.mkdir(parents=True, exist_ok=True)
    panel.to_parquet(out, index=False)
    print(f'[update-panel] {note or "无更新"}')
    print(f'[update-panel] 产物 -> {out}（{n_rows} 行 / {n_codes} 只代码）')
    emit_meta(validation, as_of=as_of_new, tags=['hs300', 'monthly', 'panel'])


if __name__ == '__main__':
    main()
