# FinDeck 存量资产迁移（T0.5）：把 data/ 下真实 parquet 登记进全局资产库。
# 用法（仓库根目录为工作目录）:
#   finance/python/.venv/Scripts/python.exe finance/python/migrate-assets.py   (Windows)
#   finance/python/.venv/bin/python finance/python/migrate-assets.py           (Linux/macOS)
# 幂等：目标版本已存在时打印"已存在，跳过"并继续；可反复重跑。
# manifest 的 interface/validation/freshness.as_of 全部来自本脚本对 parquet 的实测，禁止手填。
from __future__ import annotations

import hashlib
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from findeck import assets  # noqa: E402  （需先补 sys.path，故置于其后）

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA = REPO_ROOT / "data"
SCRIPT_REL = "finance/python/migrate-assets.py"
SESSION = "migrate-assets.py"

# 疑似同内容快照：(ab_* 正式文件, snapshot_* 快照文件)。hash 相同 → 跳过；不同 → 停止登记并报告。
DUPLICATE_PAIRS = (
    ("ab_hs300_index_monthly.parquet",
     "snapshot_baostock_hs300_index_monthly_dd4286b7_20260904.parquet"),
    ("ab_hs300_monthly.parquet",
     "snapshot_baostock_hs300_monthly_panel_09e80cc6_20260904.parquet"),
)
TEST_FIXTURE_GLOB = "snapshot_test_toolbox_*.parquet"

# 登记清单（lead 定稿：资产名与说明口径照此执行）。date_column/entity_column 用于实测统计。
SPECS = (
    {
        "file": "ab_hs300_index_monthly.parquet",
        "name": "hs300-index-monthly",
        "description": "baostock 沪深300指数月线",
        "tags": ["hs300", "index", "monthly"],
        "update_frequency": "monthly",
        "date_column": "date",
        "entity_column": None,
    },
    {
        "file": "ab_hs300_monthly.parquet",
        "name": "hs300-monthly-panel",
        "description": "baostock 沪深300成分股月度面板",
        "tags": ["hs300", "constituents", "monthly", "panel"],
        "update_frequency": "monthly",
        "date_column": "date",
        "entity_column": "code",
    },
    {
        "file": "market_cn_600519_daily_bs.parquet",
        "name": "moutai-600519-daily",
        "description": "贵州茅台 600519 前复权日线",
        "tags": ["a-share", "daily", "600519", "qfq"],
        "update_frequency": "daily",
        "date_column": "date",
        "entity_column": None,
    },
    {
        "file": "snapshot_baostock_query_hs300_stocks_45df45d9_20260904.parquet",
        "name": "hs300-constituents",
        "description": "沪深300成分股名单快照",
        "tags": ["hs300", "constituents", "snapshot"],
        "update_frequency": "monthly",
        "date_column": "updateDate",
        "entity_column": "code",
    },
)


def sha256(path: Path) -> str:
    """文件内容的 SHA-256（十六进制），用于识别同内容快照。"""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure(spec: dict) -> dict:
    """读 parquet 实测结构：行数、列清单、日期区间、缺失情况、as_of。"""
    path = DATA / spec["file"]
    df = pd.read_parquet(path)
    rows, cols = len(df), list(df.columns)
    if spec["date_column"] not in cols:
        raise ValueError(f'{spec["file"]} 缺少日期列 {spec["date_column"]!r}；实测列: {cols}')
    dates = pd.to_datetime(df[spec["date_column"]], errors="raise")
    return {
        "path": path,
        "rows": rows,
        "cols": cols,
        "dmin": dates.min(),
        "dmax": dates.max(),
        "as_of": dates.max().strftime("%Y-%m-%d"),
        "null_counts": {c: int(n) for c, n in df.isna().sum().items() if n},
        "null_rows": df,
        "entities": int(df[spec["entity_column"]].nunique()) if spec["entity_column"] else None,
        "all_string": all(pd.api.types.is_string_dtype(d) for d in df.dtypes),
    }


def validation_text(spec: dict, m: dict) -> str:
    """由实测数拼 validation：行数 + 月份区间 + 列完整性 + 缺失/实体/ dtype 事实。"""
    span = f'{m["dmin"].strftime("%Y-%m")}..{m["dmax"].strftime("%Y-%m")}'
    text = f'实测 {m["rows"]} 行，{span}，列 {"/".join(m["cols"])} 齐全'
    if m["entities"] is not None:
        text += f'，{m["entities"]} 只代码'
    if not m["null_counts"]:
        text += "，无缺失值"
    else:
        per_col = "、".join(f"{c} {n}" for c, n in m["null_counts"].items())
        total = sum(m["null_counts"].values())
        where = sorted({str(d)[:10] for d in
                        m["null_rows"].loc[m["null_rows"].isna().any(axis=1), spec["date_column"]]})
        where_text = "、".join(where) if len(where) <= 3 else f"{len(where)} 个不同日期"
        text += f"，{total} 个缺失值（{per_col}，涉及 {where_text}）"
    if m["all_string"]:
        text += "，全部列为字符串 dtype"
    return text


def build_manifest(spec: dict, m: dict) -> dict:
    """构造 archive() 用的完整 manifest（13 必填字段 + freshness/lineage/tags）。"""
    rel = f'data/{spec["file"]}'
    return {
        "name": spec["name"],
        "kind": "dataset",
        "version": 1,
        "created": date.today().isoformat(),
        "source_session": SESSION,
        "description": spec["description"],
        "interface": (f"pd.read_parquet('{rel}') -> DataFrame[{m['rows']} 行, "
                      f"列: {', '.join(m['cols'])}]"),
        "dependencies": ["pandas", "pyarrow"],
        "depends_on": [],
        "supersedes": None,
        "validation": validation_text(spec, m),
        "origin": "imported",
        "verbs": ["preview"],
        "freshness": {"as_of": m["as_of"], "update_frequency": spec["update_frequency"]},
        "lineage": {
            "producer": {"script": SCRIPT_REL, "params": {"source": rel}, "session": SESSION},
            "inputs": [],
        },
        "tags": spec["tags"],
    }


def check_duplicate_pair(ab_name: str, snap_name: str) -> bool:
    """比对快照与正式文件的内容 hash。

    :returns: True = hash 相同（同内容快照，按 lead 规则跳过）；False = 实测不同（登记方须报告）。
    """
    h_ab, h_snap = sha256(DATA / ab_name), sha256(DATA / snap_name)
    if h_ab == h_snap:
        print(f"[skip] {snap_name}: 与 {ab_name} SHA-256 相同（{h_snap}），同内容快照，不入库")
        return True
    print(f"[!!] {snap_name}: 与 {ab_name} SHA-256 不同，实测差异如下，跳过登记该快照并报告")
    print(f"     {ab_name}  sha256={h_ab}  bytes={(DATA / ab_name).stat().st_size}")
    print(f"     {snap_name} sha256={h_snap}  bytes={(DATA / snap_name).stat().st_size}")
    return False


def main() -> int:
    """登记清单内全部资产；返回进程退出码（0 = 全部按预期处理）。"""
    problems: list[str] = []
    for ab_name, snap_name in DUPLICATE_PAIRS:
        if not check_duplicate_pair(ab_name, snap_name):
            problems.append(f"{snap_name} 与 {ab_name} 内容 hash 不同（未登记该快照）")

    fixtures = sorted(p.name for p in DATA.glob(TEST_FIXTURE_GLOB))
    if fixtures:
        print(f"[skip] 测试夹具 {len(fixtures)} 个，不入库: {', '.join(fixtures)}")

    stored = 0
    for spec in SPECS:
        if not (DATA / spec["file"]).is_file():
            problems.append(f'{spec["file"]} 不存在，未登记 {spec["name"]}')
            print(f'[!!] 缺文件 {spec["file"]}，跳过 {spec["name"]}')
            continue
        m = measure(spec)
        manifest = build_manifest(spec, m)
        try:
            assets.archive(m["path"], manifest)
        except FileExistsError as e:
            print(f'[skip] {spec["name"]}: 已存在，跳过（{e}）')
            continue
        stored += 1
        print(f'[ok] {spec["name"]}: {m["rows"]} 行，as_of={m["as_of"]}，'
              f'frequency={spec["update_frequency"]}')

    print(f"[done] 新入库 {stored} 个，清单 {len(SPECS)} 个，库根目录 {assets.asset_root()}")
    if problems:
        print("[!!] 需要人工确认的问题:")
        for p in problems:
            print(f"     - {p}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
