#!/usr/bin/env python
"""face-spec 自测：用 examples/ 全量驱动 validate_face.py 并断言结果。

valid/*.json 必须全部 PASS，invalid/*.json 必须全部 FAIL（且至少报出一条错误）。
任一断言不成立即退出码 1。

用法::

    finance/python/.venv/Scripts/python.exe finance/face-spec/test-face-spec.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import validate_face  # noqa: E402  （同目录模块，需先补 sys.path）


def main() -> int:
    failures: list[str] = []
    passed = 0

    valid_dir = HERE / 'examples' / 'valid'
    invalid_dir = HERE / 'examples' / 'invalid'
    valid_files = sorted(valid_dir.glob('*.json'))
    invalid_files = sorted(invalid_dir.glob('*.json'))

    if len(valid_files) < 3 or len(invalid_files) < 3:
        print(f'FAIL  用例数量不足：valid={len(valid_files)} invalid={len(invalid_files)}（各需 >=3）')
        return 1

    for path in valid_files:
        errors = validate_face.validate_file(path)
        if errors:
            failures.append(f'valid 用例被拒: {path.name}\n      - ' + '\n      - '.join(errors))
            print(f'  FAIL  valid/   {path.name}')
        else:
            passed += 1
            print(f'  ok    valid/   {path.name}')

    for path in invalid_files:
        errors = validate_face.validate_file(path)
        if not errors:
            failures.append(f'invalid 用例被误收: {path.name}')
            print(f'  FAIL  invalid/ {path.name}')
        else:
            passed += 1
            print(f'  ok    invalid/ {path.name}  -> ' + errors[0])

    total = len(valid_files) + len(invalid_files)
    print(f'\nface-spec 自测：{len(valid_files)} valid（全 PASS）+ {len(invalid_files)} invalid（全 FAIL）'
          f'，共 {total} 例，{passed} 通过')
    if failures:
        print('\n失败明细:')
        for f in failures:
            print(f'  - {f}')
        print('\n结果: FAIL')
        return 1
    print('结果: PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
