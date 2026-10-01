#!/usr/bin/env python
"""face.json 校验器：一个或多个 face.json 路径，逐一校验并聚合退出码。

分工（与 README.md 一致）：
  1. ``face.schema.json``（JSON Schema 2020-12）负责结构、枚举、必填、``additionalProperties``、
     ``embed.path`` 的 ``..`` 禁令、以及 ``param-form`` 中 ``type=select`` 必须有 ``options``。
  2. 本脚本在 schema 通过后追加少量程序化检查——这些规则用 JSON Schema 表达别扭或不可表达：
       - param-form 内 ``fields[].name`` 不得重复（渲染器按 name 收集参数）；
       - ``fields[].default`` 的运行时类型必须与声明的 ``type`` 匹配，select 的 default
         必须在 ``options`` 中。

用法::

    python validate_face.py <face.json> [more.json ...]
    python validate_face.py examples/valid/*.json

退出码：全部 PASS → 0；任一 FAIL → 1。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / 'face.schema.json'

try:
    import jsonschema
except ImportError:  # 缺依赖时给出可执行的修复命令，而不是裸 traceback
    print('缺少依赖 jsonschema；请先运行: '
          'finance/python/.venv/Scripts/pip.exe install jsonschema', file=sys.stderr)
    raise SystemExit(2)


def load_schema() -> dict:
    """读取同目录的 face.schema.json。"""
    return json.loads(SCHEMA_PATH.read_text(encoding='utf-8'))


def _where(err: jsonschema.ValidationError) -> str:
    """错误所在的 JSON 路径。"""
    return '/'.join(str(p) for p in err.absolute_path) or '<根>'


def _branch_map(schema: dict) -> dict[str, dict]:
    """block 的 ``type`` 字面量 -> 该 block 分支的 subschema。"""
    out: dict[str, dict] = {}
    for ref in schema['$defs']['block']['oneOf']:
        sub = schema['$defs'][ref['$ref'].rsplit('/', 1)[-1]]
        out[sub['properties']['type']['const']] = sub
    return out


def _format_block_error(err: jsonschema.ValidationError, schema: dict,
                        validator: jsonschema.Draft202012Validator) -> list[str]:
    """把一个 block 上的 ``oneOf`` 报错展开成该 ``type`` 分支的真实错误。

    ``oneOf`` 自带的文本只有 "is not valid under any of the given schemas"；按 block 的 ``type``
    选中唯一分支后重新校验，才能给出"缺 verb / path 不匹配 / 未知组件类型"这类可行动信息。
    """
    path = _where(err)
    block = err.instance
    if not isinstance(block, dict) or 'type' not in block:
        return [f'{path}: 缺少 type 字段（每个 block 必须以 type 判别）']
    kind = block['type']
    branches = _branch_map(schema)
    sub = branches.get(kind)
    if sub is None:
        known = ', '.join(sorted(branches))
        return [f'{path}: 未知组件类型 {kind!r}（v1 支持: {known}）']
    sub_validator = validator.evolve(schema=sub)
    out = []
    for e in sub_validator.iter_errors(block):
        out.append(f'{path}/{_where(e)}: {e.message}' if e.absolute_path else f'{path}: {e.message}')
    return out or [f'{path}: {err.message}']


def _format_error(err: jsonschema.ValidationError) -> str:
    """把 jsonschema 的 ValidationError 压成一行可读错误。"""
    return f'{_where(err)}: {err.message}'


def extra_checks(doc: dict) -> list[str]:
    """schema 通过后的程序化检查（见模块说明；无 schema 表达方式的部分）。"""
    errors: list[str] = []
    blocks = doc.get('blocks')
    if not isinstance(blocks, list):
        return errors
    for i, block in enumerate(blocks):
        if not isinstance(block, dict) or block.get('type') != 'param-form':
            continue
        fields = block.get('fields')
        if not isinstance(fields, list):
            continue
        seen: set[str] = set()
        for j, field in enumerate(fields):
            if not isinstance(field, dict):
                continue
            where = f'blocks/{i}/fields/{j}'
            name = field.get('name')
            if isinstance(name, str):
                if name in seen:
                    errors.append(f'{where}: 字段 name 重复: {name!r}')
                seen.add(name)
            errors.extend(_check_default(where, field))
    return errors


def _check_default(where: str, field: dict) -> list[str]:
    """校验字段默认值与声明类型一致（select 的默认值必须落在 options 内）。"""
    if 'default' not in field:
        return []
    value = field['default']
    kind = field.get('type')
    if kind == 'number':
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return [f'{where}: default 必须是 number，实际 {value!r}']
    elif kind == 'string':
        if not isinstance(value, str):
            return [f'{where}: default 必须是 string，实际 {value!r}']
    elif kind == 'boolean':
        if not isinstance(value, bool):
            return [f'{where}: default 必须是 boolean，实际 {value!r}']
    elif kind == 'select':
        options = field.get('options')
        if isinstance(options, list) and value not in options:
            return [f'{where}: default {value!r} 不在 options {options!r} 中']
    return []


def validate_document(doc: dict, schema: dict) -> list[str]:
    """先 schema 校验，再程序化检查；返回全部错误消息（空表示通过）。"""
    validator = jsonschema.Draft202012Validator(schema)
    errors: list[str] = []
    for err in validator.iter_errors(doc):
        if err.validator == 'oneOf' and _where(err).startswith('blocks/'):
            errors.extend(_format_block_error(err, schema, validator))
        else:
            errors.append(_format_error(err))
    if errors:
        return sorted(errors)
    return extra_checks(doc)


def validate_file(path: str | Path) -> list[str]:
    """校验单个 face.json 文件；返回错误消息列表（空表示 PASS）。"""
    p = Path(path)
    if not p.is_file():
        return [f'文件不存在: {p}']
    try:
        doc = json.loads(p.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        return [f'JSON 解析失败: {e}']
    return validate_document(doc, load_schema())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog='validate_face.py',
        description='校验 face.json（FinDeck Face Spec v1）。',
    )
    parser.add_argument('paths', nargs='+', metavar='face.json', help='一个或多个 face.json 路径')
    args = parser.parse_args(argv)

    failed = 0
    for raw in args.paths:
        errors = validate_file(raw)
        if errors:
            failed += 1
            print(f'FAIL  {raw}')
            for err in errors:
                print(f'      - {err}')
        else:
            print(f'PASS  {raw}')
    total = len(args.paths)
    print(f'\n共 {total} 个文件：{total - failed} PASS / {failed} FAIL')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
