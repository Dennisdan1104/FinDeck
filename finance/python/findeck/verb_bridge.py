"""verb 执行桥：脸（或 P3 资产页面）的按钮点击 → 资产库内某个 verb 执行 → 结构化结果回流。

协议全文见 ``finance/face-spec/verb-bridge.md``；本模块是它的唯一实现。

请求::

    {"asset": "hs300-index-monthly", "version": 1, "verb": "preview", "params": {"n": 5}}

响应::

    {"status": "ok"|"error", "asset": ..., "version": ..., "verb": ...,
     "duration_s": 0.0123, "result": {...}?, "stdout": "..."?, "error": "..."?}

verb 解析四级（convention over configuration，manifest 不变）：

1. verb 声明检查——**只跑库内资产、只跑预声明动作**，未声明直接 error。
   **例外：``preview`` 豁免**（只读的内建检视动作，所有资产天然具备；未声明 ``preview`` 的资产
   也能被检视）。其他 verb 一律必须在 manifest ``verbs`` 里声明。
2. 版本目录内存在 ``<verb>.py`` → 作为子进程脚本运行：``FINDECK_VERB_PARAMS`` 传 params JSON，
   stdout 末尾一行 ``###FINDECK_VERB_RESULT### <json>`` 是 result。
3. 否则版本目录内任一 ``.py`` 含同名函数（``run-factor`` 亦可写作 ``run_factor``）→
   以 params 为 kwargs 调用，返回值即 result。
4. 否则内建兜底 ``preview``：
   - ``kind=dataset`` 且版本目录内有 parquet/csv → ``{source, columns, dtypes, rows, head, tail?}``
     （``params.n`` 控制 head 行数，默认 5；``params.tail`` 为正整数时额外返回末尾 n 行的 ``tail``）；
   - 其余情况（kind != dataset，或 dataset 无可读数据表）→ manifest 摘要
     ``{name, kind, version, created, description, validation, verbs, freshness, depends_on, tags,
     files}``，版本目录存在 ``.md``/``.txt`` 时附带 ``text``（首个该文件内容，UTF-8，超 20KB 截断）。
5. 都不满足 → error ``verb 无处理器``。

任何失败都返回**结构完整的响应**（``status='error'`` + ``error`` 消息），不抛异常给调用方。

CLI::

    python -m findeck.verb_bridge '{"asset": "...", "verb": "preview", "params": {"n": 5}}'
    echo '{...}' | python -m findeck.verb_bridge

退出码：``status='ok'`` → 0；``status='error'``（含请求 JSON 无法解析）→ 1。

后台执行：``--background '<json>'`` 立刻返回 ``{"run_id": ..., "status": "running"}``（exit 0），
真正的执行在分离子进程里跑，结果落 ``<asset_root>/runs/<run_id>.json``（见
:mod:`findeck.background`）；``--status <run_id>`` 打印该记录，退出码 ok→0 / error→1 /
running→2 / 不存在→4。后台子进程退不出终态的情形（进程被杀）见 background 模块说明。
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import yaml

from . import assets, background

__all__ = ['execute', 'main']

VERB_RESULT_MARKER = '###FINDECK_VERB_RESULT###'
DEFAULT_PREVIEW_ROWS = 5
PREVIEW_TEXT_MAX_BYTES = 20 * 1024
TEXT_TRUNCATED_MARKER = '\n\n[已截断：仅显示前 {limit} 字节，完整内容见 {name}]'
_DATA_SUFFIXES = ('.parquet', '.csv')
_TEXT_SUFFIXES = ('.md', '.txt')
_SCRIPT_TIMEOUT_S = float(os.environ.get('FINDECK_VERB_TIMEOUT') or 600)


# --------------------------------------------------------------------------- 公共入口

def execute(request: dict) -> dict:
    """执行一次 verb 调用，返回协议响应（永不抛异常）。

    :param request: ``{asset, version?, verb, params?}``，字段缺失/类型错误按 error 响应返回。
    """
    started = time.perf_counter()
    asset = request.get('asset') if isinstance(request, dict) else None
    verb = request.get('verb') if isinstance(request, dict) else None
    raw_version = request.get('version') if isinstance(request, dict) else None
    params = request.get('params') if isinstance(request, dict) else None

    if not isinstance(request, dict):
        return _response('error', None, None, None, started,
                         error=f'请求必须是 JSON 对象: {type(request).__name__}')
    if not isinstance(asset, str) or not asset.strip():
        return _response('error', asset, None, verb, started, error='请求缺少 asset（非空字符串）')
    if not isinstance(verb, str) or not verb.strip():
        return _response('error', asset, None, verb, started, error='请求缺少 verb（非空字符串）')
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return _response('error', asset, None, verb, started, error=f'params 必须是对象: {params!r}')
    try:
        version = int(raw_version) if raw_version is not None else 'latest'
    except (TypeError, ValueError):
        return _response('error', asset, None, verb, started, error=f'version 必须是整数: {raw_version!r}')

    # 1. 定位资产版本目录（只跑库内资产）
    try:
        vdir = assets.find(asset, version)
    except Exception as e:  # assets.find 对不存在资产抛 ValueError
        return _response('error', asset, None, verb, started, error=str(e))
    version = int(vdir.name[1:])

    # 2. 读 manifest 并检查 verb 已声明（只跑预声明动作）
    manifest_path = vdir / 'manifest.yaml'
    if not manifest_path.is_file():
        return _response('error', asset, version, verb, started, error=f'版本目录缺 manifest.yaml: {vdir}')
    try:
        manifest = yaml.safe_load(manifest_path.read_text(encoding='utf-8')) or {}
    except Exception as e:
        return _response('error', asset, version, verb, started, error=f'manifest.yaml 解析失败: {e}')
    # 2. verb 声明检查（preview 豁免：只读内建检视，所有资产天然具备，见 R11-1）
    declared = manifest.get('verbs') or []
    if verb != 'preview' and verb not in declared:
        return _response('error', asset, version, verb, started,
                         error=f'verb {verb!r} 未在 manifest.verbs 中声明: {declared}')

    # 3. <verb>.py 脚本
    script = vdir / f'{verb}.py'
    if script.is_file():
        result, stdout, error = _run_script(script, vdir, params)
        if error is not None:
            return _response('error', asset, version, verb, started, error=error, stdout=stdout)
        return _response('ok', asset, version, verb, started, result=result, stdout=stdout)

    # 4. 同名函数
    handled, result, error = _try_function(vdir, verb, params)
    if error is not None:
        return _response('error', asset, version, verb, started, error=error)
    if handled:
        return _response('ok', asset, version, verb, started, result=_jsonable(result))

    # 5. 内建兜底：preview（dataset 数据表 / manifest 摘要）
    if verb == 'preview':
        handled, result, error = _builtin_preview(vdir, manifest, params)
        if error is not None:
            return _response('error', asset, version, verb, started, error=error)
        if handled:
            return _response('ok', asset, version, verb, started, result=result)

    return _response('error', asset, version, verb, started,
                     error=f'verb 无处理器: {asset}@v{version} 内无 {verb}.py、无同名函数，'
                           f'且不适用内建兜底（verb={verb!r}, kind={manifest.get("kind")!r}）')


# --------------------------------------------------------------------------- 响应

def _response(status: str, asset, version, verb, started: float,
              result=None, stdout=None, error=None) -> dict:
    """组装协议响应：字段齐全，可选字段只在有值时出现。"""
    resp = {
        'status': status,
        'asset': asset,
        'version': version,
        'verb': verb,
        'duration_s': round(time.perf_counter() - started, 4),
    }
    if status == 'ok':
        resp['result'] = result if result is not None else {}
    if stdout is not None:
        resp['stdout'] = stdout
    if error is not None:
        resp['error'] = error
    return resp


# --------------------------------------------------------------------------- 二级：脚本

def _run_script(script: Path, vdir: Path, params: dict) -> tuple[object, str, str | None]:
    """运行 ``<verb>.py``；返回 (result, stdout, error)。

    stdout 末尾的 ``###FINDECK_VERB_RESULT### <json>`` 是 result；脚本 exit≠0 或 marker 缺失即 error。
    """
    env = dict(os.environ)
    env['FINDECK_VERB_PARAMS'] = json.dumps(params, ensure_ascii=False)
    # 固定子进程 stdout 编码，与本函数用 utf-8 解码对齐（Windows 控制台默认 GBK）
    env['PYTHONIOENCODING'] = 'utf-8'
    try:
        proc = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(vdir), env=env, capture_output=True, text=True,
            encoding='utf-8', errors='replace', timeout=_SCRIPT_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return None, '', f'{script.name} 执行超时（>{_SCRIPT_TIMEOUT_S:g}s）'
    except OSError as e:
        return None, '', f'{script.name} 无法执行: {e}'
    stdout = proc.stdout or ''
    if proc.returncode != 0:
        tail = (proc.stderr or '').strip().splitlines()[-5:]
        return None, stdout, f'{script.name} 退出码 {proc.returncode}' + (f'：{" / ".join(tail)}' if tail else '')
    payload, error = _extract_marker(stdout)
    if error is not None:
        return None, stdout, error
    return payload, stdout, None


def _extract_marker(stdout: str) -> tuple[object, str | None]:
    """从 stdout 中取最后一个 marker 行并解析其 JSON。"""
    for line in reversed(stdout.splitlines()):
        stripped = line.strip()
        if stripped.startswith(VERB_RESULT_MARKER):
            raw = stripped[len(VERB_RESULT_MARKER):].strip()
            if not raw:
                return None, f'{VERB_RESULT_MARKER} 后没有 JSON'
            try:
                return json.loads(raw), None
            except json.JSONDecodeError as e:
                return None, f'{VERB_RESULT_MARKER} 后的 JSON 解析失败: {e}'
    return None, f'脚本未输出结果 marker {VERB_RESULT_MARKER}'


# --------------------------------------------------------------------------- 三级：同名函数

def _try_function(vdir: Path, verb: str, params: dict) -> tuple[bool, object, str | None]:
    """在版本目录的 .py 里找同名函数并调用；返回 (handled, result, error)。"""
    names = [verb, verb.replace('-', '_')]
    pattern = re.compile(r'^[ \t]*def[ \t]+(' + '|'.join(re.escape(n) for n in names) + r')[ \t]*\(', re.M)
    for py in sorted(vdir.glob('*.py')):
        try:
            text = py.read_text(encoding='utf-8-sig', errors='replace')
        except OSError:
            continue
        if not pattern.search(text):
            continue
        try:
            module = _load_module(py)
        except Exception as e:
            return True, None, f'导入 {py.name} 失败: {type(e).__name__}: {e}'
        fn = next((getattr(module, n) for n in names if hasattr(module, n)), None)
        if fn is None or not callable(fn):
            continue
        try:
            return True, _jsonable(fn(**params)), None
        except Exception as e:
            return True, None, f'调用 {py.name}:{fn.__name__}() 失败: {type(e).__name__}: {e}'
    return False, None, None


def _load_module(path: Path):
    """按文件路径加载模块（版本目录内的 .py 不是包成员）。"""
    spec = importlib.util.spec_from_file_location(f'_findeck_verb_{path.stem}', path)
    if spec is None or spec.loader is None:
        raise ImportError(f'无法为 {path} 构造模块 spec')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --------------------------------------------------------------------------- 四级：内建兜底

def _builtin_preview(vdir: Path, manifest: dict, params: dict) -> tuple[bool, object, str | None]:
    """``preview`` 的内建实现，两种返回形态：

    - **dataset 且版本目录内有 parquet/csv**：读首个数据表，返回
      ``{source, columns, dtypes, rows, head, tail?}``。``params.n`` 控制 ``head``（前 n 行，默认 5）；
      ``params.tail`` 为正整数时**额外**带 ``tail`` 键（末尾 n 行，结构同 ``head``）。行为不变。
    - **其余情况**（kind != dataset，或 dataset 无可读数据表）：返回 manifest 摘要 + 文件清单
      （见 :func:`_manifest_summary`）。``n``/``tail`` 在这条路径上不适用，忽略。
    """
    if manifest.get('kind') == 'dataset':
        candidates = sorted(p for p in vdir.iterdir() if p.is_file() and p.suffix.lower() in _DATA_SUFFIXES)
        if candidates:
            return _preview_data(candidates[0], params)
    return _manifest_summary(vdir, manifest)


def _preview_data(source: Path, params: dict) -> tuple[bool, object, str | None]:
    """数据表路径：读 parquet/csv，返回列信息与 head（前 n 行）/ tail（末尾 n 行）。"""
    n = params.get('n', DEFAULT_PREVIEW_ROWS)
    if isinstance(n, bool) or not isinstance(n, int) or n < 0:
        return True, None, f'preview 的 params.n 必须是非负整数: {n!r}'
    tail = params.get('tail')
    if tail is not None and (isinstance(tail, bool) or not isinstance(tail, int) or tail < 1):
        return True, None, f'preview 的 params.tail 必须是正整数（缺省则结果不含 tail）: {tail!r}'
    try:
        import pandas as pd
        df = pd.read_parquet(source) if source.suffix.lower() == '.parquet' else pd.read_csv(source)
    except Exception as e:
        return True, None, f'读取 {source.name} 失败: {type(e).__name__}: {e}'
    result = {
        'source': source.name,
        'columns': [str(c) for c in df.columns],
        'dtypes': {str(c): str(df[c].dtype) for c in df.columns},
        'rows': int(len(df)),
        'head': _jsonable(df.head(n).to_dict('records')) if n else [],
    }
    if tail is not None:
        result['tail'] = _jsonable(df.tail(tail).to_dict('records'))
    return True, result, None


def _manifest_summary(vdir: Path, manifest: dict) -> tuple[bool, object, str | None]:
    """manifest 摘要路径：返回资产自述 + 版本目录文件清单，有 md/txt 时附带正文。

    ``text`` 取版本目录内**首个**（路径字典序）``.md`` / ``.txt`` 的内容（UTF-8，解码失败以
    U+FFFD 替代）；超过 :data:`PREVIEW_TEXT_MAX_BYTES` 时截断并在末尾加 :data:`TEXT_TRUNCATED_MARKER`。
    """
    result = {
        'name': manifest.get('name'),
        'kind': manifest.get('kind'),
        'version': manifest.get('version'),
        'created': manifest.get('created'),
        'description': manifest.get('description'),
        'validation': manifest.get('validation'),
        'verbs': manifest.get('verbs') or [],
        'freshness': manifest.get('freshness'),
        'depends_on': manifest.get('depends_on') or [],
        'tags': manifest.get('tags') or [],
        'files': sorted(p.relative_to(vdir).as_posix() for p in vdir.rglob('*') if p.is_file()),
    }
    text_file = next((p for p in sorted(vdir.rglob('*'))
                      if p.is_file() and p.suffix.lower() in _TEXT_SUFFIXES), None)
    if text_file is not None:
        raw = text_file.read_bytes()
        body = raw[:PREVIEW_TEXT_MAX_BYTES].decode('utf-8', errors='replace')
        if len(raw) > PREVIEW_TEXT_MAX_BYTES:
            body += TEXT_TRUNCATED_MARKER.format(
                limit=PREVIEW_TEXT_MAX_BYTES, name=text_file.relative_to(vdir).as_posix())
        result['text'] = body
    return True, _jsonable(result), None


# --------------------------------------------------------------------------- 序列化

def _jsonable(value):
    """把 pandas/numpy 返回值转成可 json.dumps 的纯 Python 结构。"""
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) else value
    if isinstance(value, int):
        return value
    if hasattr(value, 'isoformat'):  # datetime / date / pd.Timestamp
        try:
            return value.isoformat()
        except Exception:
            pass
    if hasattr(value, 'item'):  # numpy 标量
        try:
            return _jsonable(value.item())
        except Exception:
            pass
    return str(value)


# --------------------------------------------------------------------------- CLI

def _configure_stdout() -> None:
    """Windows 控制台默认 GBK，显式切 UTF-8，保证中文错误消息不炸。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')
        except (AttributeError, ValueError):
            pass


def _finish_background_run(status: str, response: dict, error: str | None = None) -> None:
    """后台子进程收尾：把完整响应写回 run 记录（无 ``FINDECK_RUN_ID`` 时什么都不做）。

    写记录失败只告警不中断——子进程仍按原语义打印响应与返回退出码，run 记录停在 running
    （与"进程被杀"同一类已知限制，见 findeck.background）。
    """
    run_id = os.environ.get('FINDECK_RUN_ID')
    if not run_id:
        return
    try:
        background.finish(run_id, status=status, response=response, error=error)
    except Exception as e:  # 记录写不进去不能带走这次调用的结果
        print(f'[verb_bridge] 写 run 记录失败（记录将停在 running）: {type(e).__name__}: {e}',
              file=sys.stderr)


def _start_background(raw: str, request) -> int:
    """``--background``：起分离子进程跑同一条命令行（去掉 --background），立刻打印 run_id。"""
    try:
        info = background.start('verb', request, ['-m', 'findeck.verb_bridge', raw])
    except (ValueError, OSError) as e:
        print(json.dumps({'status': 'error', 'error': f'后台启动失败: {e}'}, ensure_ascii=False))
        return 1
    print(json.dumps(info, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI 入口：打印响应 JSON，``status`` 映射退出码 0/1；``--background`` / ``--status`` 见模块说明。"""
    _configure_stdout()
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ['--status']:
        if len(args) != 2:
            print('用法: python -m findeck.verb_bridge --status <run_id>', file=sys.stderr)
            return 1
        return background.status_cli(args[1])
    background_run = args[:1] == ['--background']
    if background_run:
        args = args[1:]
    raw = ' '.join(args) if args else sys.stdin.read()
    try:
        request = json.loads(raw)
    except json.JSONDecodeError as e:
        resp = _response('error', None, None, None, time.perf_counter(),
                         error=f'请求 JSON 解析失败: {e}')
        print(json.dumps(resp, ensure_ascii=False))
        # 后台子进程里解析失败也必须落终态，否则记录停在 running（父进程已先校验过，正常到不了这里）
        _finish_background_run('error', resp, resp['error'])
        return 1
    if background_run:
        return _start_background(raw, request)
    resp = execute(request)
    print(json.dumps(resp, ensure_ascii=False))
    ok = resp.get('status') == 'ok'
    _finish_background_run('ok' if ok else 'error', resp, None if ok else resp.get('error'))
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
