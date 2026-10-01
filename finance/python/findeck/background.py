"""后台 run 机制：verb_bridge 与 pipeline 的异步执行。

长任务（跑脚本、刷面板、重训模型）不该占住调用方：``--background`` 立刻返回 ``run_id``，
真正的执行交给一个分离的子进程，结果落在 ``<asset_root>/runs/<run_id>.json``；
配套 ``--status <run_id>`` 查询终态。

run 记录::

    {"run_id": "20260916103000-9f3c1a2b", "kind": "verb",
     "request": {"asset": "hs300-index-monthly", "verb": "preview", "params": {"n": 3}},
     "status": "running", "ts_start": "2026-09-16T10:30:00.123+08:00",
     "session": "...", "ts_end": "...", "duration_s": 1.23,
     "response": {...}, "error": "..."}

- ``kind`` ∈ :data:`KINDS`；``request`` 是原始请求（verb 的请求 JSON，或 pipeline 的 ``{path, mode}``）。
- ``status`` ∈ ``running`` / ``ok`` / ``error``。**终态才有** ``ts_end`` / ``duration_s`` /
  ``response`` / ``error``，且**缺省键一律省略、不写显式 null**（与 :mod:`findeck.assets` 同一份
  R3 裁约）。``response`` 是 verb_bridge / pipeline 跑完的完整响应（pipeline 为
  ``{status, pipeline, steps}``）。
- ``session`` 取环境变量 ``DSH_SESSION_ID``（没有则省略键）——后续引擎按它过滤本桌 run。
- ``run_id`` = ``time.strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(4)``。

子进程语义：``start()`` 用**同一 venv 的解释器**跑 ``child_argv``（即不带 ``--background`` 的原
命令行，不含解释器本身），Windows 下带 ``CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`` 分离，
stdout/stderr 重定向到 ``<RUNS_DIR>/<run_id>.log``（排障用），并向子进程传 ``FINDECK_RUN_ID``
与 ``FINDECK_RUN_FILE``（子进程靠它知道改写哪份记录）。

**已知限制**：分离子进程的退出码不直接可得，终态由子进程自己在退出前调 :func:`finish` 写回；
进程被杀（机器重启、任务管理器结束、父进程被强杀）时记录**停留在 ``running``**——本模块不做超时
回收，读者按 ``ts_start`` 自行判断该 run 是否已成僵尸。

CLI 退出码约定（verb_bridge 与 pipeline 的 ``main()`` 共用，见 :data:`STATUS_EXIT_CODE` / 
:data:`MISSING_RUN_EXIT_CODE`)：

    python -m findeck.verb_bridge --background '<json>'   # 立刻打印 {"run_id", "status"}
    python -m findeck.pipeline run <path> --background
    python -m findeck.verb_bridge --status <run_id>       # ok→0 error→1 running→2 不存在→4
"""
from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import assets

__all__ = ['RUNS_DIR', 'KINDS', 'STATUS_EXIT_CODE', 'MISSING_RUN_EXIT_CODE',
           'start', 'read', 'finish', 'list_runs', 'status_cli']

RUNS_DIR = assets.asset_root() / 'runs'
KINDS = ('verb', 'pipeline')
#: run 状态 → ``--status`` 的退出码；不在表内的状态按 error(1) 处理
STATUS_EXIT_CODE = {'ok': 0, 'error': 1, 'running': 2}
#: ``--status`` 查不到该 run 时的退出码
MISSING_RUN_EXIT_CODE = 4
#: run_id 形态：``YYYYmmddHHMMSS-<8 位 hex>``；同时挡掉路径穿越
_RUN_ID_RE = re.compile(r'^[0-9]{14}-[0-9a-f]{8}$')


# --------------------------------------------------------------------------- 路径与时间

def _now() -> str:
    """带本地时区偏移的 ISO8601 时间戳（毫秒精度，同偏移下可直接按字符串排序）。"""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='milliseconds')


def _parse_ts(text) -> float | None:
    """ISO8601 时间戳 → epoch 秒；无法解析返回 None。"""
    if not isinstance(text, str):
        return None
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def _run_file(run_id: str) -> Path:
    """run 记录的路径。

    后台子进程里 ``FINDECK_RUN_ID`` 与本文件 ``run_id`` 一致时以 ``FINDECK_RUN_FILE`` 为准
    （父进程显式指定的那一份），其余情况按 :data:`RUNS_DIR` 推导。
    """
    env_file = os.environ.get('FINDECK_RUN_FILE')
    if env_file and os.environ.get('FINDECK_RUN_ID') == run_id:
        return Path(env_file)
    return RUNS_DIR / f'{run_id}.json'


def _atomic_write(path: Path, text: str) -> None:
    """先写 ``<name>.tmp`` 再 ``os.replace``，读者不会看到半截记录。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


def _dump(record: dict, path: Path) -> None:
    _atomic_write(path, json.dumps(record, ensure_ascii=False, indent=2) + '\n')


def _load(path: Path) -> dict | None:
    """读一份 run 记录；文件不存在或内容不是 JSON 对象时返回 None。"""
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


# --------------------------------------------------------------------------- 生命周期

def start(kind: str, request, child_argv: list[str]) -> dict:
    """起一个分离子进程执行 ``child_argv``，写初始 run 记录后立即返回。

    :param kind: ``'verb'`` 或 ``'pipeline'``。
    :param request: 原始请求（verb 的请求 dict，或 pipeline 的 ``{path, mode}``），原样写进记录。
    :param child_argv: 不含解释器的子进程命令行（如 ``['-m', 'findeck.verb_bridge', '<json>']``）。
    :returns: ``{'run_id': ..., 'status': 'running'}``。
    :raises ValueError: kind 非法或 child_argv 不是非空字符串列表。
    :raises OSError: 子进程无法启动（venv 解释器丢失、runs 目录不可写等）。
    """
    if kind not in KINDS:
        raise ValueError(f'kind 必须是 {KINDS} 之一: {kind!r}')
    if not isinstance(child_argv, (list, tuple)) or not child_argv \
            or any(not isinstance(a, str) for a in child_argv):
        raise ValueError(f'child_argv 必须是非空字符串列表: {child_argv!r}')

    run_id = time.strftime('%Y%m%d%H%M%S') + '-' + secrets.token_hex(4)
    run_file = _run_file(run_id).resolve()
    log_file = run_file.with_suffix('.log')
    record = {'run_id': run_id, 'kind': kind, 'request': request, 'status': 'running',
              'ts_start': _now()}
    session = os.environ.get('DSH_SESSION_ID')
    if session:
        record['session'] = session
    _dump(record, run_file)

    env = dict(os.environ)
    env['FINDECK_RUN_ID'] = run_id
    env['FINDECK_RUN_FILE'] = str(run_file)
    env['PYTHONIOENCODING'] = 'utf-8'  # 子进程中文输出统一 UTF-8，写进 .log 不乱码
    env['PYTHONUNBUFFERED'] = '1'      # 输出直接落 .log，长 run 跑到一半也能看进度
    spawn: dict = {}
    if os.name == 'nt':
        spawn['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        spawn['start_new_session'] = True
    with log_file.open('w', encoding='utf-8') as log:
        try:
            subprocess.Popen([sys.executable, *child_argv], env=env, stdin=subprocess.DEVNULL,
                             stdout=log, stderr=subprocess.STDOUT, **spawn)
        except OSError as e:  # 起不来就把刚写的记录改成终态，不留一个永远 running 的僵尸
            finish(run_id, status='error', error=f'子进程启动失败: {e}')
            raise
    return {'run_id': run_id, 'status': 'running'}


def read(run_id: str) -> dict | None:
    """读一份 run 记录；不存在（或 run_id 形态非法）返回 None。"""
    if not isinstance(run_id, str) or not _RUN_ID_RE.match(run_id):
        return None
    return _load(_run_file(run_id))


def finish(run_id: str, *, status: str, response: dict | None = None,
           error: str | None = None) -> None:
    """子进程收尾：把记录改写成终态（status='ok'|'error'，补 ts_end/duration_s/response/error）。

    由后台子进程在退出前调用；临时文件 + ``os.replace`` 原子落盘。``response`` / ``error`` 为
    None 时省略对应键（不写显式 null）。记录不存在时按最小字段重建，保证终态一定可读。

    :raises ValueError: status 不是 ``'ok'`` / ``'error'``。
    """
    if status not in ('ok', 'error'):
        raise ValueError(f"status 必须是 'ok' 或 'error': {status!r}")
    run_file = _run_file(run_id)
    previous = _load(run_file) or {}
    started = _parse_ts(previous.get('ts_start')) or time.time()
    record: dict = {'run_id': previous.get('run_id') or run_id}
    if previous.get('kind'):
        record['kind'] = previous['kind']
    if 'request' in previous:
        record['request'] = previous['request']
    record['status'] = status
    record['ts_start'] = previous.get('ts_start') or _now()
    if previous.get('session'):
        record['session'] = previous['session']
    record['ts_end'] = _now()
    record['duration_s'] = round(time.time() - started, 2)
    if response is not None:
        record['response'] = response
    if error is not None:
        record['error'] = error
    _dump(record, run_file)


def list_runs(limit: int = 100) -> list[dict]:
    """按 ``ts_start`` 倒序列出 run 记录摘要，供后续引擎扫描。

    摘要键为 run_id / kind / status / ts_start / duration_s / session（缺省的键省略，
    例如 running 的 run 没有 duration_s、无会话的 run 没有 session）。

    :param limit: 最多返回多少条；``<= 0`` 返回空列表。
    """
    if not isinstance(limit, int) or limit <= 0 or not RUNS_DIR.is_dir():
        return []
    summaries = []
    for path in RUNS_DIR.glob('*.json'):
        record = _load(path)
        if record is None:
            continue
        summary = {k: record[k] for k in
                   ('run_id', 'kind', 'status', 'ts_start', 'duration_s', 'session')
                   if record.get(k) is not None}
        summary.setdefault('run_id', path.stem)
        summaries.append(summary)
    summaries.sort(key=lambda r: (r.get('ts_start') or '', r['run_id']), reverse=True)
    return summaries[:limit]


# --------------------------------------------------------------------------- CLI 共用

def status_cli(run_id: str) -> int:
    """``--status <run_id>`` 的实现（verb_bridge 与 pipeline 共用）：打印 run 记录并返回退出码。

    退出码：``ok`` → 0，``error`` → 1，``running`` → 2，run 不存在 → 4
    （见 :data:`STATUS_EXIT_CODE` / :data:`MISSING_RUN_EXIT_CODE`）。
    """
    record = read(run_id)
    if record is None:
        print(json.dumps({'run_id': run_id, 'status': 'missing',
                          'error': f'run 不存在: {run_id}'}, ensure_ascii=False))
        return MISSING_RUN_EXIT_CODE
    print(json.dumps(record, ensure_ascii=False))
    return STATUS_EXIT_CODE.get(record.get('status'), STATUS_EXIT_CODE['error'])
