"""weekly-healthcheck 步骤：资产库体检（探活 + 保鲜度过期 + 活物率/死资产候选）。

数据口径（T4.1/T4.2 定稿规格）：
- **探活**：对 index.json 里每个 ``kind=dataset`` 资产调 ``verb_bridge.execute({asset, verb:'preview',
  params:{n:1}})``——读得动就活，``status='error'`` 记死并保留错误消息。
- **过期**：读 ``freshness.as_of``，按 ``update_frequency`` 映射阈值（daily>2 天 / weekly>8 天 /
  monthly>32 天 / quarterly>95 天 / 其余或缺省>31 天），以 as_of 到今天的自然日计；
  没有可解析 ``freshness.as_of`` 的资产不参与过期判定。
- **触碰**：``<asset_root>/usage.jsonl``（TS 侧写，``{ts, tool, asset?, session?}``，可能不存在）
  + ``<asset_root>/pipeline-runs/*.jsonl``（流水线写，``status=ok`` 的行取 ``produced.asset`` **与**
  ``inputs``——消费上游也算触碰，R8-3；旧记录没有 ``inputs`` 键则只计 ``produced``）合并，
  取每资产最近一次；
  活物率 = 30 天内被触碰的库内资产数 / 总资产数；90 天未被触碰 = 死资产候选
  （从未被触碰的资产用最新版本的 ``created`` 兜底，避免把刚入库的资产当死资产）。
- 报告落 ``produces.out``，stdout 末行按 findeck.pipeline 的 marker 协议输出摘要。
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'finance' / 'python'))  # 独立运行脚本时也能 import findeck

from findeck import assets, verb_bridge  # noqa: E402

MARKER = '###FINDECK_STEP_META###'
FRESHNESS_LIMITS = {'daily': 2, 'weekly': 8, 'monthly': 32, 'quarterly': 95}
DEFAULT_LIMIT_DAYS = 31
_LOCAL_TZ = datetime.now().astimezone().tzinfo


def _step_params() -> dict:
    """步骤参数（``FINDECK_STEP_PARAMS``，缺省空 dict）。"""
    raw = os.environ.get('FINDECK_STEP_PARAMS') or '{}'
    try:
        params = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f'FINDECK_STEP_PARAMS 不是合法 JSON: {raw!r}') from e
    if not isinstance(params, dict):
        raise SystemExit(f'FINDECK_STEP_PARAMS 必须是 JSON 对象: {params!r}')
    return params


def _out_path(default: str) -> Path:
    env = os.environ.get('FINDECK_STEP_OUT')
    return Path(env) if env else REPO / default


def _emit_meta(validation: str, **extra: object) -> None:
    print(f'{MARKER} {json.dumps({"validation": validation, **extra}, ensure_ascii=False)}')


def _parse_ts(value: Any) -> datetime | None:
    """解析 ISO 时间戳；无时区按本机时区处理，不可解析返回 None。"""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=_LOCAL_TZ)


def _collect_touches(root: Path, now: datetime) -> dict:
    """汇总 usage.jsonl 与 pipeline-runs/*.jsonl，返回每资产的最近触碰与记录条数。"""
    touches: dict[str, dict] = {}
    stats = {'usage_lines': 0, 'usage_bad': 0, 'run_lines': 0, 'run_bad': 0, 'unknown': 0}

    def note(asset_name: Any, ts: Any, source: str) -> None:
        dt = _parse_ts(ts)
        if isinstance(asset_name, str) and asset_name.strip() and dt is not None:
            if asset_name in touches and touches[asset_name]['ts'] >= dt:
                touches[asset_name]['source'] |= {source}
                return
            prev = touches.get(asset_name, {}).get('source', set())
            touches[asset_name] = {'ts': dt, 'source': prev | {source}}

    usage_path = root / 'usage.jsonl'
    if usage_path.is_file():  # TS 侧可能还没建这个文件，缺失按空处理
        for line in usage_path.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                stats['usage_bad'] += 1
                continue
            if not isinstance(rec, dict):
                stats['usage_bad'] += 1
                continue
            stats['usage_lines'] += 1
            note(rec.get('asset'), rec.get('ts'), 'usage')

    runs_dir = root / 'pipeline-runs'
    for run_file in sorted(runs_dir.glob('*.jsonl')) if runs_dir.is_dir() else []:
        for line in run_file.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                stats['run_bad'] += 1
                continue
            if not isinstance(rec, dict):
                stats['run_bad'] += 1
                continue
            stats['run_lines'] += 1
            if rec.get('status') != 'ok':
                continue
            produced = rec.get('produced')
            if isinstance(produced, dict):
                note(produced.get('asset'), rec.get('ts'), 'pipeline')
            # R8-3：消费上游也算触碰。旧记录没有 inputs 键 → 只计 produced，不报错。
            consumed = rec.get('inputs')
            if isinstance(consumed, list):
                for item in consumed:
                    note(item, rec.get('ts'), 'pipeline-input')
    return {'touches': touches, **stats}


def _probe(name: str) -> dict:
    """对一个 dataset 资产跑 preview verb 探活。"""
    resp = verb_bridge.execute({'asset': name, 'verb': 'preview', 'params': {'n': 1}})
    result = resp.get('result') if isinstance(resp.get('result'), dict) else {}
    return {
        'asset': name,
        'version': resp.get('version'),
        'ok': resp.get('status') == 'ok',
        'rows': result.get('rows'),
        'error': resp.get('error'),
    }


def _freshness_state(entry: dict, today: date) -> dict | None:
    """算某资产的保鲜度状态；没有可解析 freshness.as_of 时返回 None（不参与过期判定）。"""
    freshness = entry.get('freshness')
    if not isinstance(freshness, dict):
        return None
    as_of = freshness.get('as_of')
    if not isinstance(as_of, str):
        return None
    try:
        as_of_date = date.fromisoformat(as_of)
    except ValueError:
        return None
    freq = freshness.get('update_frequency')
    limit = FRESHNESS_LIMITS.get(freq, DEFAULT_LIMIT_DAYS) if isinstance(freq, str) else DEFAULT_LIMIT_DAYS
    age = (today - as_of_date).days
    return {'asset': entry['name'], 'as_of': as_of, 'frequency': freq or '(缺省)',
            'limit': limit, 'age': age, 'expired': age > limit}


def _last_seen(entry: dict, touches: dict, now: datetime) -> tuple[datetime | None, str]:
    """最近触碰时间；从未被触碰时回退到最新版本的 created（入库时间）。"""
    name = entry['name']
    if name in touches:
        return touches[name]['ts'], '触碰记录'
    versions = entry.get('versions') or []
    if versions:
        created = (versions[-1].get('manifest') or {}).get('created')
        dt = _parse_ts(f'{created}T00:00:00') if isinstance(created, str) else None
        if dt is not None:
            return dt, '入库时间'
    return None, '未知'


def _table(header: list[str], rows: list[list[str]]) -> list[str]:
    if not rows:
        return ['（无）', '']
    out = ['| ' + ' | '.join(header) + ' |', '|' + '---|' * len(header)]
    out += ['| ' + ' | '.join(r) + ' |' for r in rows]
    return out + ['']


def main() -> None:
    params = _step_params()
    alive_days = int(params.get('alive_days', 30))
    dead_days = int(params.get('dead_days', 90))
    out = _out_path('output/asset_health_report.md')

    root = assets.asset_root()
    index = json.loads((root / 'index.json').read_text(encoding='utf-8'))
    entries = [a for a in (index.get('assets') or []) if isinstance(a, dict) and a.get('name')]
    now = datetime.now().astimezone()
    today = date.today()
    touch_info = _collect_touches(root, now)
    touches = touch_info['touches']
    known = {a['name'] for a in entries}

    datasets = [a for a in entries if a.get('kind') == 'dataset']
    probes = [_probe(a['name']) for a in datasets]
    failed = [p for p in probes if not p['ok']]

    freshness = [s for s in (_freshness_state(a, today) for a in entries) if s is not None]
    expired = [s for s in freshness if s['expired']]

    alive = [a['name'] for a in entries
             if a['name'] in touches and now - touches[a['name']]['ts'] <= timedelta(days=alive_days)]
    rate = len(alive) / len(entries) if entries else 0.0

    dead: list[dict] = []
    for a in entries:
        seen, basis = _last_seen(a, touches, now)
        if seen is None:
            continue
        age = (now - seen).days
        if age > dead_days:
            dead.append({'asset': a['name'], 'kind': a.get('kind'), 'seen': seen, 'basis': basis, 'age': age})

    unknown_touched = sorted(set(touches) - known)
    lines = [
        f'# 资产库体检报告 {today.isoformat()}',
        '',
        f'> 由资产流水线 `weekly-healthcheck` 生成（cron `0 9 * * 1`）；资产根目录 `{root}`。',
        '',
        '## 总览',
        '',
        '| 指标 | 值 |',
        '|---|---|',
        f'| 总资产数 | {len(entries)} |',
        f'| 活物率（{alive_days} 天内被触碰） | {len(alive)}/{len(entries)} = {rate:.1%} |',
        f'| 探活失败 | {len(failed)} / {len(probes)} 个 dataset |',
        f'| 过期资产 | {len(expired)} |',
        f'| 死资产候选（{dead_days} 天未被触碰） | {len(dead)} |',
        f'| 触碰记录来源 | usage.jsonl {touch_info["usage_lines"]} 条'
        f'（坏行 {touch_info["usage_bad"]}）/ pipeline-runs {touch_info["run_lines"]} 条'
        f'（坏行 {touch_info["run_bad"]}） |',
        '',
        '## 探活结果（dataset × preview）',
        '',
    ]
    lines += _table(['资产', '版本', '结果', '行数', '错误'],
                    [[p['asset'], f'v{p["version"]}' if p['version'] else '—',
                      '活' if p['ok'] else '死',
                      str(p['rows']) if p['rows'] is not None else '—',
                      p['error'] or '—'] for p in probes])
    lines += [
        f'## 过期资产（freshness.as_of 超期）',
        '',
        '映射：' + ' / '.join(f'{k}>{v}天' for k, v in FRESHNESS_LIMITS.items())
        + f' / 其余或缺省>{DEFAULT_LIMIT_DAYS}天（自然日）。',
        '',
    ]
    lines += _table(['资产', 'as_of', 'update_frequency', f'阈值(天)', '已过(天)'],
                    [[s['asset'], s['as_of'], s['frequency'], str(s['limit']), str(s['age'])]
                     for s in expired])
    lines += [f'## 死资产候选（{dead_days} 天未被触碰，建议清理）', '']
    lines += _table(['资产', 'kind', '最近触碰(或入库)', '依据', '距今天数'],
                    [[d['asset'], str(d['kind']), d['seen'].date().isoformat(), d['basis'], str(d['age'])]
                     for d in dead])
    lines += ['## 触碰明细', '']
    lines += _table(['资产', '最近触碰', '+来源', f'在 {alive_days} 天内'],
                    [[a['name'], touches[a['name']]['ts'].astimezone().isoformat(timespec='seconds'),
                      '+'.join(sorted(touches[a['name']]['source'])),
                      '是' if a['name'] in alive else '否']
                     for a in entries if a['name'] in touches])
    lines += [
        '## 口径说明',
        '',
        f'- 触碰 = `usage.jsonl` 中 `asset` 字段命中的记录 + `pipeline-runs/*.jsonl` 中 `produced.asset` '
        f'**与 `inputs`**（`status=ok` 的行；消费上游也算触碰，R8-3。旧记录无 `inputs` 键则只计 '
        f'`produced`）；活物率分子 = {alive_days} 天内被触碰的**库内**资产数。',
        '- 触碰明细的「+来源」：`usage`=会话工具调用，`pipeline`=流水线产出，'
        '`pipeline-input`=作为流水线上游被消费。',
        f'- 从未被触碰的资产以最新版本的 `created` 作为"最近触碰(或入库)"参与死资产判定，'
        f'刚入库的资产不会因"还没被用过"被误列。',
        f'- 触碰记录里指向库外资产的条目：{len(unknown_touched)} 个'
        + (f'（{", ".join(unknown_touched[:5])}）' if unknown_touched else '') + '，不计入活物率。',
        '- 探活只覆盖 `kind=dataset`（读得动即活）；非 dataset 资产不探活、无 freshness 不判过期。',
        '',
    ]
    report = '\n'.join(lines)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding='utf-8')
    print(f'[healthcheck] 资产 {len(entries)} 个（dataset {len(datasets)}）；活物率 {len(alive)}/{len(entries)} '
          f'= {rate:.1%}；探活失败 {len(failed)}；过期 {len(expired)}；死资产候选 {len(dead)}')
    print(f'[healthcheck] 产物 -> {out}（{len(report.splitlines())} 行）')
    validation = (f'实测摘要：{len(entries)} 资产，活物率 {rate:.1%}，探活失败 {len(failed)} 个，'
                  f'过期 {len(expired)} 个，死资产候选 {len(dead)} 个')
    _emit_meta(validation, tags=['assets', 'healthcheck', 'report'])


if __name__ == '__main__':
    main()
