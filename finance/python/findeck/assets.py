"""全局资产工作区：AI 研究产出的可复用资产按版本沉淀，跨会话可发现、可调用。

资产库目录（根目录由 ``FINDECK_ASSET_DIR`` 指定，默认 ``~/.findeck/asset-library/``）::

    asset-library/
    ├── index.md                  # 人类可读总索引，archive() 自动重建
    ├── index.json                # 机器可读总索引（version 2），与 index.md 同一次重建输出
    └── <asset-name>/             # kebab-case
        ├── v1/
        │   ├── manifest.yaml     # 必填字段缺一不入库
        │   ├── <模型/代码文件>
        │   └── charts/           # 验证图表（可选）
        └── v2/ ...               # 同名更新版本并存，永不覆盖

manifest 必填字段：name, kind(model|code|weights|dataset|chart|report), version, created,
source_session, description, interface, dependencies, depends_on, supersedes, validation,
origin(agent|user|imported), verbs(kebab-case 非空列表)。
可选字段：freshness({as_of, update_frequency}，dataset 类必填 as_of)、
lineage({producer{script,params,session}, inputs})、tags(kebab-case 列表)、
face(版本目录内的 ``*.json`` 相对路径，不含 ``..``；声明后 archive() 必须能在版本目录里找到该文件，
找不到则删除刚拷贝的版本目录并报错)。
读取路径容忍旧 manifest（缺新字段时按 origin=None, verbs=[], freshness=None, lineage=None,
tags=[], face=None 汇总），校验只发生在 archive() 时。
R3 契约：Python 写入侧不写显式 null 的嵌套键（``lineage.producer``、``producer.*``、
``freshness.update_frequency`` 缺省时省略键）；校验器同样拒绝这些键的显式 None。
手工修复过版本目录（例如补 face.json 并同步改 manifest.yaml）后用 :func:`reindex` 刷新索引。
归档纪律（写入 skill）：模型/权重类自动归档；代码类入库前询问用户；
validation 必须来自实际跑出的数。
"""
from __future__ import annotations

import json
import os
import re
import shutil
from datetime import date
from pathlib import Path

import yaml

__all__ = ['asset_root', 'archive', 'find', 'list_all', 'reindex']

REQUIRED_FIELDS = (
    'name', 'kind', 'version', 'created', 'source_session', 'description',
    'interface', 'dependencies', 'depends_on', 'supersedes', 'validation',
    'origin', 'verbs',
)
KINDS = ('model', 'code', 'weights', 'dataset', 'chart', 'report')
ORIGINS = ('agent', 'user', 'imported')
_KEBAB_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')  # name / verbs 元素 / tags 元素共用
_ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_COPY_IGNORE = shutil.ignore_patterns('__pycache__', '.ipynb_checkpoints', '*.pyc')


def asset_root() -> Path:
    """资产库根目录（``FINDECK_ASSET_DIR`` 覆盖，默认 ``~/.findeck/asset-library/``）。"""
    return Path(os.environ.get('FINDECK_ASSET_DIR') or Path.home() / '.findeck' / 'asset-library')


def _validate_freshness(manifest: dict) -> None:
    """freshness 可选（顶层 None 合法）；kind=dataset 时必填。

    as_of 为 ISO 日期；update_frequency 为非空字符串。按 R3 契约，``update_frequency``
    键出现但值为 None 属于非法写法（缺省应省略键），直接拒绝。
    """
    freshness = manifest.get('freshness')
    if freshness is None:
        if manifest['kind'] == 'dataset':
            raise ValueError('kind=dataset 的资产必须提供 freshness（含 as_of）')
        return
    if not isinstance(freshness, dict):
        raise ValueError(f'freshness 必须是对象: {freshness!r}')
    as_of = freshness.get('as_of')
    text = str(as_of)
    if not _ISO_DATE_RE.match(text):
        raise ValueError(f'freshness.as_of 必须是 ISO 日期（YYYY-MM-DD）: {as_of!r}')
    try:
        date.fromisoformat(text)
    except ValueError as e:
        raise ValueError(f'freshness.as_of 必须是 ISO 日期（YYYY-MM-DD）: {as_of!r}') from e
    freq = freshness.get('update_frequency')
    if 'update_frequency' in freshness and not (isinstance(freq, str) and freq.strip()):
        raise ValueError(
            f'freshness.update_frequency 必须是非空字符串；缺省时请省略该键而非写 null: {freq!r}')


def _validate_lineage(manifest: dict) -> None:
    """lineage 可选（顶层 None 合法）；inputs 若出现必须与 depends_on 同集合。

    depends_on 为空 list 且 inputs 非空是唯一的例外：archive() 会把 depends_on 回填为 inputs，
    校验因此放行而不报错。
    按 R3 契约，``producer`` 与 ``producer.script`` / ``producer.params`` / ``producer.session``
    键出现但值为 None 属于非法写法（缺省应省略键），直接拒绝。
    """
    lineage = manifest.get('lineage')
    if lineage is None:
        return
    if not isinstance(lineage, dict):
        raise ValueError(f'lineage 必须是对象: {lineage!r}')
    if 'producer' in lineage:
        producer = lineage['producer']
        if not isinstance(producer, dict):
            raise ValueError(f'lineage.producer 必须是对象；缺省时请省略该键而非写 null: {producer!r}')
        for k in ('script', 'session'):
            if k in producer and not isinstance(producer[k], str):
                raise ValueError(
                    f'lineage.producer.{k} 必须是字符串；缺省时请省略该键而非写 null: {producer[k]!r}')
        if 'params' in producer and not isinstance(producer['params'], dict):
            raise ValueError(
                f'lineage.producer.params 必须是对象；缺省时请省略该键而非写 null: {producer["params"]!r}')
    inputs = lineage.get('inputs')
    if inputs is None:
        return
    if not isinstance(inputs, list) or any(not isinstance(i, str) for i in inputs):
        raise ValueError(f'lineage.inputs 必须是资产名列表（字符串）: {inputs!r}')
    depends_on = manifest['depends_on']
    if set(inputs) == set(depends_on):
        return
    if not depends_on and inputs:
        return
    raise ValueError(f'lineage.inputs 必须与 depends_on 同集合（忽略顺序）: {inputs!r} vs {depends_on!r}')


def _validate_face(manifest: dict) -> None:
    """face 可选（缺省或 None = 未声明）；声明时必须是版本目录内的 ``*.json`` 相对路径。

    拒绝绝对路径（含 Windows 盘符）与含 ``..`` 的路径——face 描述只允许落在版本目录内部，
    与 T2.1 的 face.json 位置约定一致。
    """
    face = manifest.get('face')
    if face is None:
        return
    if not isinstance(face, str) or not face.strip():
        raise ValueError(f'face 必须是版本目录内的相对路径字符串: {face!r}')
    p = Path(face)
    # Windows 下 '/abs/x.json' 既非 is_absolute() 也能拼出盘符外路径，故同时看 drive 与 root
    if p.is_absolute() or p.drive or p.root or any(part == '..' for part in p.parts):
        raise ValueError(f'face 必须是版本目录内的相对路径（禁止绝对路径与 ..）: {face!r}')
    if not face.endswith('.json'):
        raise ValueError(f'face 必须指向 .json 文件: {face!r}')


def _validate_tags(manifest: dict) -> None:
    """tags 可选；出现时必须是 kebab-case 字符串列表。"""
    tags = manifest.get('tags')
    if tags is None:
        return
    if not isinstance(tags, list) or any(not isinstance(t, str) or not _KEBAB_RE.match(t) for t in tags):
        raise ValueError(f'tags 必须是 kebab-case 字符串列表: {tags!r}')


def _backfill_depends_on(manifest: dict) -> None:
    """depends_on 为空而 lineage.inputs 非空时回填 depends_on := inputs（写盘前，使两者一致）。"""
    lineage = manifest.get('lineage')
    if isinstance(lineage, dict) and manifest['depends_on'] == [] and lineage.get('inputs'):
        manifest['depends_on'] = list(lineage['inputs'])


def _validate(manifest: dict) -> None:
    """入库校验：必填字段缺一不入库；类型与取值非法即报错。"""
    missing = [k for k in REQUIRED_FIELDS if k not in manifest]
    if missing:
        raise ValueError(f'manifest 缺少必填字段: {missing}（全部字段见 findeck.assets 模块说明）')
    name, kind = manifest['name'], manifest['kind']
    if not _KEBAB_RE.match(str(name)):
        raise ValueError(f'name 必须是 kebab-case（小写字母数字与连字符）: {name!r}')
    if kind not in KINDS:
        raise ValueError(f'kind 必须是 {KINDS} 之一: {kind!r}')
    v = manifest['version']
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise ValueError(f'version 必须是正整数: {v!r}')
    try:
        date.fromisoformat(str(manifest['created']))
    except ValueError as e:
        raise ValueError(f'created 必须是 ISO 日期（YYYY-MM-DD）: {manifest["created"]!r}') from e
    for k in ('source_session', 'description', 'interface', 'validation'):
        if not str(manifest[k] or '').strip():
            raise ValueError(f'{k} 不能为空')
    for k in ('dependencies', 'depends_on'):
        if not isinstance(manifest[k], list):
            raise ValueError(f'{k} 必须是列表（可为空）: {manifest[k]!r}')
    sup = manifest['supersedes']
    if sup is not None and not (isinstance(sup, str) and re.match(r'^[a-z0-9-]+@v\d+$', sup)):
        raise ValueError(f'supersedes 须为 null 或 "<asset>@v<N>" 格式: {sup!r}')
    if manifest['origin'] not in ORIGINS:
        raise ValueError(f'origin 必须是 {ORIGINS} 之一: {manifest["origin"]!r}')
    verbs = manifest['verbs']
    if not isinstance(verbs, list) or not verbs:
        raise ValueError(f'verbs 必须是非空列表: {verbs!r}')
    for verb in verbs:
        if not isinstance(verb, str) or not _KEBAB_RE.match(verb):
            raise ValueError(f'verbs 元素必须是 kebab-case 字符串: {verb!r}')
    _validate_freshness(manifest)
    _validate_lineage(manifest)
    _validate_tags(manifest)
    _validate_face(manifest)


def _versions(root: Path, name: str) -> list[int]:
    """某资产已存在的版本号列表（目录形如 v1/v2 且含 manifest）。"""
    base = root / name
    if not base.is_dir():
        return []
    return sorted(int(p.name[1:]) for p in base.iterdir()
                  if re.match(r'^v\d+$', p.name) and (p / 'manifest.yaml').is_file())


def archive(path: str | Path, manifest: dict) -> str:
    """把一个文件或目录归档为资产版本，返回该版本目录路径。

    :param path: 待归档的模型文件/权重/代码文件，或包含它们的目录（整体拷入版本目录）。
    :param manifest: 完整 manifest 字段（见模块说明），校验失败抛 ValueError。
    :raises ValueError: manifest 校验失败；或声明了 ``face`` 而版本目录内没有该文件——
        此时已删除刚拷贝的版本目录再报错。
    :raises FileExistsError: 目标版本已存在——版本并存、永不覆盖，请递增 version 并填 supersedes。
    """
    _validate(manifest)
    _backfill_depends_on(manifest)
    src = Path(path)
    if not src.exists():
        raise FileNotFoundError(f'待归档路径不存在: {src}')
    root = asset_root()
    dest = root / str(manifest['name']) / f'v{manifest["version"]}'
    if dest.exists():
        raise FileExistsError(f'资产版本已存在（永不覆盖）: {dest}；请递增 version 并在 supersedes 记录演进')
    dest.mkdir(parents=True)
    if src.is_dir():
        shutil.copytree(src, dest, dirs_exist_ok=True, ignore=_COPY_IGNORE)
    else:
        shutil.copy2(src, dest / src.name)
    face = manifest.get('face')
    if face and not (dest / face).is_file():
        shutil.rmtree(dest)  # 文件拷贝已完成，face 缺文件则整版回滚，不留半截版本目录
        raise ValueError(f'manifest 声明了 face={face!r}，但版本目录内不存在该文件: {dest / face}')
    with (dest / 'manifest.yaml').open('w', encoding='utf-8') as f:
        yaml.safe_dump(manifest, f, sort_keys=False, allow_unicode=True)

    known = {p.name for p in root.iterdir() if p.is_dir()} if root.is_dir() else set()
    unresolved = [d for d in manifest['depends_on'] if d not in known]
    if unresolved:
        print(f'[assets] 警告: depends_on 指向尚不存在的资产 {unresolved}（依赖图将出现悬空节点）')
    _write_index(root)
    print(f'[assets] 已入库 {manifest["name"]}@v{manifest["version"]} -> {dest}')
    return str(dest)


def find(name: str, version: int | str = 'latest') -> Path:
    """返回某资产版本的目录。

    :param version: ``'latest'``（默认）取最大版本号；或指定整数版本。
    :raises ValueError: 资产不存在或指定版本不存在。
    """
    versions = _versions(asset_root(), name)
    if not versions:
        available = sorted({p.name for p in asset_root().iterdir() if p.is_dir()}) if asset_root().is_dir() else []
        raise ValueError(f'资产不存在: {name!r}；库中现有: {available}')
    if version == 'latest':
        v = versions[-1]
    else:
        v = int(version)
        if v not in versions:
            raise ValueError(f'{name} 无版本 v{v}；现有: {["v" + str(i) for i in versions]}')
    return asset_root() / name / f'v{v}'


def list_all() -> list[dict]:
    """列出库中全部资产摘要（每资产取最新版本的 manifest 信息）。

    库内旧 manifest 可能没有 origin/verbs/freshness/lineage/tags/face，读取时按缺省值汇总
    （origin=None, verbs=[], freshness=None, lineage=None, tags=[], face=None），不报错。
    """
    root = asset_root()
    out = []
    if not root.is_dir():
        return out
    for base in sorted(root.iterdir()):
        versions = _versions(root, base.name)
        if not versions:
            continue
        m = yaml.safe_load((root / base.name / f'v{versions[-1]}' / 'manifest.yaml').read_text(encoding='utf-8'))
        out.append({
            'name': base.name,
            'kind': m['kind'],
            'latest_version': versions[-1],
            'versions': versions,
            'description': m['description'],
            'validation': m['validation'],
            'depends_on': m['depends_on'],
            'origin': m.get('origin'),
            'verbs': m.get('verbs') or [],
            'freshness': m.get('freshness'),
            'lineage': m.get('lineage'),
            'tags': m.get('tags') or [],
            'face': m.get('face'),
        })
    return out


def _atomic_write(path: Path, text: str) -> None:
    """先写 ``<name>.tmp`` 再 ``os.replace`` 到正式名，重建中断不会留下半截索引。"""
    tmp = path.with_name(f'{path.name}.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)


def _write_index(root: Path) -> None:
    """每次入库后重建两份索引：index.md（人类可读）与 index.json（机器可读，version 2）。

    两份文件都原子落盘（临时文件 + os.replace）。读取库内旧 manifest（缺 origin/verbs/
    freshness/lineage/tags/face）时按缺省值汇总，不报错。
    """
    entries = list_all()
    lines = [
        '# FinDeck 资产库索引',
        '',
        '> 由 `findeck.assets.archive` 自动重建，不要手工编辑。',
        f'> 重建时间: {date.today().isoformat()}，根目录: `{root}`',
        '',
        '| 资产 | 类型 | 最新版 | 用途 | 验证指标 | 依赖资产 | 来源(origin) | 动作(verbs) |',
        '|---|---|---|---|---|---|---|---|',
    ]
    for a in entries:
        deps = ', '.join(a['depends_on']) or '—'
        verbs = ', '.join(a['verbs']) or '—'
        one = str(a['validation']).replace('\n', ' ')
        lines.append(f"| {a['name']} | {a['kind']} | v{a['latest_version']} | "
                     f"{a['description']} | {one} | {deps} | {a['origin'] or '—'} | {verbs} |")
    lines += ['', '## 版本历史', '']
    manifests: dict[str, list[dict]] = {}
    if root.is_dir():
        for base in sorted(root.iterdir()):
            for v in _versions(root, base.name):
                m = yaml.safe_load((base / f'v{v}' / 'manifest.yaml').read_text(encoding='utf-8'))
                manifests.setdefault(base.name, []).append({'version': v, 'manifest': m})
                sup = m['supersedes'] or '—'
                lines.append(f"- {base.name} v{v}（{m['created']}，supersedes {sup}）：{m['description']}")
    lines.append('')
    root.mkdir(parents=True, exist_ok=True)
    _atomic_write(root / 'index.md', '\n'.join(lines))
    _atomic_write(root / 'index.json', json.dumps(
        {'version': 2, 'updated': date.today().isoformat(), 'assets': [
            {k: a[k] for k in ('name', 'kind', 'latest_version', 'description', 'validation',
                               'depends_on', 'origin', 'verbs', 'freshness', 'lineage', 'tags', 'face')}
            | {'versions': manifests.get(a['name'], [])}
            for a in entries
        ]},
        ensure_ascii=False, indent=2,
    ))


def reindex() -> None:
    """按库内现有 manifest 重建 index.md 与 index.json（复用 ``archive()`` 的同一条索引路径）。

    用途：手工修复版本目录后刷新索引。典型场景是补 face.json——把文件放进
    ``<asset>/vN/`` 并在该版本 manifest.yaml 里声明 ``face``，再调本函数让索引摘要跟上；
    archive() 之外的任何目录改动都不会自动改索引。
    """
    root = asset_root()
    root.mkdir(parents=True, exist_ok=True)
    _write_index(root)
    print(f'[assets] 已重建索引 -> {root / "index.md"} 与 {root / "index.json"}')
