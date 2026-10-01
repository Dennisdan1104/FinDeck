# findeck 工具箱实测：特征构造 → 模型对比 → 图表输出 → 数据快照 → 资产库
import os
import sys
import tempfile
import time
from datetime import date, timedelta
from pathlib import Path
import numpy as np
import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from findeck import assets, charts, quickmodels, snapshot as snap

CACHE = Path("data/market_cn_600519_daily_bs.parquet")


def call_ak(fn, *args, retries: int = 3, **kwargs):
    """东财接口首次连接常被直接断开（RemoteDisconnected），必须带重试。"""
    for i in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1.5)


def synthetic_daily(n: int = 900, seed: int = 20260904) -> pd.DataFrame:
    """离线兜底：确定性合成 OHLCV（几何随机游走 + 日内振幅），无网络也能回归工具箱链路。"""
    rng = np.random.default_rng(seed)
    close = 1000 * np.exp(np.cumsum(rng.normal(0.0004, 0.018, n)))
    rng_amp = np.abs(rng.normal(0, 0.008, n)) * close
    return pd.DataFrame({
        "date": pd.bdate_range("2020-01-02", periods=n),
        "open": close * (1 + rng.normal(0, 0.004, n)),
        "high": close + rng_amp,
        "low": close - rng_amp,
        "close": close,
        "volume": rng.integers(1_000_000, 8_000_000, n).astype(float),
    })


def load_daily() -> pd.DataFrame:
    """缓存优先；缺失时按文档路径用 akshare 拉一次并落缓存，离线则退到确定性合成数据。"""
    if not CACHE.exists():
        try:
            import akshare as ak
            end = date.today()
            raw = call_ak(ak.stock_zh_a_hist, symbol="600519", period="daily",
                          start_date=(end - timedelta(days=365 * 6)).strftime("%Y%m%d"),
                          end_date=end.strftime("%Y%m%d"), adjust="qfq")
            df = raw.rename(columns={"日期": "date", "开盘": "open", "收盘": "close",
                                     "最高": "high", "最低": "low", "成交量": "volume"})
            df = df[["date", "open", "high", "low", "close", "volume"]]
            CACHE.parent.mkdir(exist_ok=True)
            df.to_parquet(CACHE)
            print(f"[data] akshare 拉取 600519 前复权日线 {len(df)} 行 → 缓存 {CACHE}")
        except Exception as e:
            print(f"[data] akshare 不可用（{type(e).__name__}: {str(e)[:60]}）→ 改用确定性合成数据"
                  "（仅回归工具箱链路，非真实行情）")
            return synthetic_daily()
    else:
        print(f"[data] 复用缓存 {CACHE}")

    df = pd.read_parquet(CACHE)
    # 统一到 ns：akshare/baostock 的日期列可能是 date 对象或字符串，pandas 3 会推断出 [s]/[ms]，
    # 与快照 parquet 往返后的 dtype 不一致。
    df["date"] = pd.to_datetime(df["date"]).dt.as_unit("ns")
    for c in ["open", "high", "low", "close", "volume"]:
        df[c] = df[c].astype(float)
    return df.set_index("date").sort_index()


df = load_daily()

# ── 特征：动量/波动/量比（全部只用 T-1 及以前信息）──
for n in (5, 10, 20, 60):
    df[f"ret_{n}"] = df["close"].pct_change(n)
    df[f"vol_{n}"] = df["close"].pct_change().rolling(n).std()
df["vol_ratio"] = df["volume"] / df["volume"].rolling(20).mean()
df["hl_range"] = (df["high"] - df["low"]) / df["close"]

y = quickmodels.make_target(df, horizon=1, mode="direction")  # 次日涨跌
feats = [c for c in df.columns if c.startswith(("ret_", "vol_", "vol_ratio", "hl_range"))]

print("== list_models ==")
print(quickmodels.list_models().to_string(index=False))

results = {}
for name, params in [("ridge", {"alpha": 1.0}), ("lightgbm", {"n_estimators": 300, "num_leaves": 15, "learning_rate": 0.05, "verbose": -1})]:
    r = quickmodels.fit_predict(df, y, model=name, features=feats, params=params)
    results[name] = r
    m = r["metrics"]["mean"]
    print(f"\n== {name} ({r['task']}) ==")
    print("  mean:", {k: round(v, 4) for k, v in m.items()})

# 分类的 predictions 必须是概率（AUC 与策略阈值都建立在概率上，硬标签没有排序信息）
for name, r in results.items():
    p = r["predictions"]
    assert r["task"] == "classification" and p.between(0.0, 1.0).all(), f"{name} 未返回概率"
    assert r["labels"] is not None and set(r["labels"].unique()) <= {0.0, 1.0}, f"{name} 缺硬标签"
print("\n[check] 分类 predictions 概率范围 OK，labels 为 0/1 硬标签")

# lasso 分类必须真走 L1 稀疏路径（回归防线：分类分支不得静默退回 sklearn 默认 L2）
r_lasso = quickmodels.fit_predict(df, y, model="lasso", features=feats, params={"alpha": 1.0})
lp = r_lasso["fitted"].get_params()
assert lp.get("penalty") == "l1" or lp.get("l1_ratio") == 1.0, f"lasso 分类未使用 L1: {lp}"
nz = int((r_lasso["importance"].values != 0).sum())
print(f"[check] lasso(L1) 分类非零系数 {nz}/{len(r_lasso['importance'])}，mean AUC "
      f"{r_lasso['metrics']['mean']['auc']:.3f}")

# ARIMA（单序列）
r_ar = quickmodels.fit_predict(df, df["close"].pct_change(), model="arima", params={"order": (1, 0, 1)})
print("\n== arima (1,0,1) on daily return ==")
print("  mean:", {k: round(v, 6) for k, v in r_ar["metrics"]["mean"].items()})

# ── 图表 ──
p1 = charts.price_chart(df, title="贵州茅台 600519（前复权）")
print("\nchart:", p1, Path(p1).stat().st_size, "bytes")

# 用 lightgbm 的预测概率构造一个简单策略净值（P(次日涨) > 0.55 才持有）并画净值曲线
pred = results["lightgbm"]["predictions"].reindex(df.index).shift(1)  # T-1 收盘的概率信号，T 日执行
daily_ret = df["close"].pct_change()
hold = pred > 0.55          # 阈值作用在预测概率 P(次日涨) 上，而非 predict 的 0/1 硬标签
strat = (daily_ret * hold).fillna(0)
nav = (1 + strat.loc[pred.dropna().index[0]:]).cumprod()
bench = (1 + daily_ret.loc[nav.index[0]:]).cumprod()
sig = pred.dropna()         # 只有样本外折有预测值
print(f"P(次日涨)>0.55 持有天数占比 {float((sig > 0.55).mean()):.1%}；"
      f"P>0.5（模型判涨）占比 {float((sig > 0.5).mean()):.1%}")
p2 = charts.equity_curve(nav, benchmark=bench, title="LightGBM P(次日涨)>0.55 置信持有 vs 买入持有")
print("chart:", p2, Path(p2).stat().st_size, "bytes")

p3 = charts.feature_importance_chart(results["lightgbm"]["importance"], title="LightGBM 特征重要度")
print("chart:", p3, Path(p3).stat().st_size, "bytes")

# ── 数据快照纪律（R8）──
raw = df.tail(60)[["close", "volume"]].reset_index()  # 模拟一份接口原始返回
sp = snap.snapshot(raw, "test_toolbox_source", symbol="600519", span=60)
assert sp.exists() and sp.stat().st_size > 0, f"快照未落盘: {sp}"
assert snap.snapshot_path("test_toolbox_source", symbol="600519", span=60) == sp
# 参数顺序不影响命中同一个快照
assert snap.snapshot_path("test_toolbox_source", span=60, symbol="600519") == sp

calls = {"n": 0}
def fake_fetch() -> pd.DataFrame:
    calls["n"] += 1
    return raw

# 清掉本测试此前运行留下的同日快照，保证断言从"无快照"起步
for probe in ("test_toolbox_reuse", "test_toolbox_disabled"):
    for old in Path("data").glob(f"snapshot_{probe}_*.parquet"):
        old.unlink()

got1 = snap.load_or_fetch(fake_fetch, "test_toolbox_reuse", symbol="600519")
got2 = snap.load_or_fetch(fake_fetch, "test_toolbox_reuse", symbol="600519")
assert calls["n"] == 1, "同参数同日第二次取数应复用快照，不再调接口"
pd.testing.assert_frame_equal(got1.reset_index(drop=True), raw.reset_index(drop=True))
pd.testing.assert_frame_equal(got2.reset_index(drop=True), raw.reset_index(drop=True))

# 开关关闭时不读快照、不落盘，直接执行取数
os.environ["FINDECK_SNAPSHOT"] = "0"
try:
    calls["n"] = 0
    snap.load_or_fetch(fake_fetch, "test_toolbox_disabled", symbol="x")
    assert calls["n"] == 1
    assert not snap.snapshot_path("test_toolbox_disabled", symbol="x").exists()
finally:
    del os.environ["FINDECK_SNAPSHOT"]
assert snap.enabled()

# ── 资产库（R2）：入库校验 / 版本并存 / 索引 / 发现 ──
with tempfile.TemporaryDirectory() as td:
    os.environ["FINDECK_ASSET_DIR"] = str(Path(td) / "asset-library")
    try:
        model_file = Path(td) / "m.txt"
        model_file.write_text("fake-model", encoding="utf-8")
        manifest = {
            "name": "test-asset", "kind": "model", "version": 1,
            "created": "2026-09-04", "source_session": "sess-test",
            "description": "工具箱冒烟测试资产", "interface": "predict(x) -> y",
            "dependencies": ["lightgbm"], "depends_on": [], "supersedes": None,
            "validation": "AUC=0.55，区间 2024，样本外",
            "origin": "agent", "verbs": ["predict"],
        }
        dest = assets.archive(model_file, manifest)
        assert Path(dest, "manifest.yaml").exists() and Path(dest, "m.txt").exists()
        assert (assets.asset_root() / "index.md").exists()
        import json as _json
        idx = _json.loads((assets.asset_root() / "index.json").read_text(encoding="utf-8"))
        assert idx["assets"][0]["name"] == "test-asset" and idx["assets"][0]["latest_version"] == 1

        # 字段缺失拒入库；同版本不可覆盖
        import copy
        bad = copy.deepcopy(manifest); bad.pop("validation")
        try:
            assets.archive(model_file, bad); raise AssertionError("缺字段应报错")
        except ValueError:
            pass
        try:
            assets.archive(model_file, manifest); raise AssertionError("同版本覆盖应报错")
        except FileExistsError:
            pass

        # 版本演进：v2 并存，find 默认最新、可指定旧版
        v2 = copy.deepcopy(manifest); v2.update(version=2, supersedes="test-asset@v1")
        assets.archive(model_file, v2)
        assert assets.find("test-asset").name == "v2"
        assert assets.find("test-asset", 1).name == "v1"
        listing = assets.list_all()
        assert listing[0]["name"] == "test-asset" and listing[0]["latest_version"] == 2
        try:
            assets.find("no-such-asset"); raise AssertionError("未知资产应报错")
        except ValueError:
            pass

        # ── T0.1 manifest 六字段升级：origin / verbs / freshness / lineage / tags 校验 ──
        def expect_rejected(m: dict, why: str) -> None:
            try:
                assets.archive(model_file, m)
            except ValueError:
                return
            raise AssertionError(f"{why} 应被拒绝")

        no_origin = copy.deepcopy(manifest); no_origin.pop("origin")
        expect_rejected(no_origin, "缺 origin")
        expect_rejected({**manifest, "origin": "robot"}, "origin 非法取值")
        expect_rejected({**manifest, "verbs": []}, "verbs 空列表")
        expect_rejected({**manifest, "verbs": ["Predict"]}, "verbs 元素非 kebab-case")
        expect_rejected({**manifest, "tags": ["NotKebab"]}, "tags 元素非 kebab-case")
        expect_rejected({**manifest, "kind": "dataset"}, "kind=dataset 缺 freshness")
        expect_rejected({**manifest, "freshness": {"as_of": "2026/09/01"}}, "freshness.as_of 非 ISO 日期")
        expect_rejected({**manifest, "depends_on": ["test-asset"], "lineage": {"inputs": ["other-asset"]}},
                        "lineage.inputs 与 depends_on 集合不一致")
        print("[check] T0.1 非法 origin/verbs/freshness/lineage/tags 均被拒")

        # dataset 必带 freshness.as_of，合法即入库
        ds_file = Path(td) / "d.csv"
        ds_file.write_text("date,close\n", encoding="utf-8")
        ds_manifest = {
            "name": "test-dataset", "kind": "dataset", "version": 1,
            "created": "2026-09-04", "source_session": "sess-test",
            "description": "工具箱测试数据集", "interface": "parquet: date,close",
            "dependencies": ["pandas"], "depends_on": [], "supersedes": None,
            "validation": "覆盖 2024-01-01~2024-12-31，250 行",
            "origin": "imported", "verbs": ["update", "preview"],
            "freshness": {"as_of": "2026-09-01", "update_frequency": "daily"},
        }
        ds_dest = assets.archive(ds_file, ds_manifest)
        assert Path(ds_dest, "manifest.yaml").exists()

        # depends_on 为空而 lineage.inputs 非空：archive() 回填 depends_on := inputs
        lineage_manifest = {
            "name": "test-lineage", "kind": "code", "version": 1,
            "created": "2026-09-04", "source_session": "sess-test",
            "description": "血缘回填测试资产", "interface": "run()",
            "dependencies": [], "depends_on": [], "supersedes": None,
            "validation": "回填后与上游一致",
            "origin": "agent", "verbs": ["run"],
            "lineage": {"inputs": ["test-asset"], "producer": {"script": "gen.py"}},
        }
        lineage_dest = assets.archive(model_file, lineage_manifest)
        written = yaml.safe_load(Path(lineage_dest, "manifest.yaml").read_text(encoding="utf-8"))
        assert written["depends_on"] == ["test-asset"], f"depends_on 未回填: {written['depends_on']}"
        print("[check] dataset 带 freshness 入库 OK，lineage 回填 depends_on OK")

        # ── R3 契约：嵌套键显式 null 一律拒绝（写入侧省略键，不写 null）──
        expect_rejected({**manifest, "lineage": {"producer": None}}, "lineage.producer 显式 null")
        expect_rejected({**manifest, "lineage": {"producer": {"script": None}}},
                        "lineage.producer.script 显式 null")
        expect_rejected({**manifest, "lineage": {"producer": {"params": None}}},
                        "lineage.producer.params 显式 null")
        expect_rejected({**manifest, "lineage": {"producer": {"session": None}}},
                        "lineage.producer.session 显式 null")
        expect_rejected({**ds_manifest, "freshness": {"as_of": "2026-09-01", "update_frequency": None}},
                        "freshness.update_frequency 显式 null")
        # 顶层 lineage/freshness 的 None 仍合法（可选字段缺省写法）
        assets.archive(model_file, {**manifest, "name": "test-null-toplevel",
                                    "lineage": None, "freshness": None})
        assert assets.find("test-null-toplevel").name == "v1"
        print("[check] R3 嵌套 null 均被拒，顶层 lineage/freshness 的 null 仍合法")

        # ── P1 加固：manifest 可选 face 字段（版本目录内 *.json，缺文件回滚）──
        for bad_face in ("/abs/face.json", "../face.json", "face.txt", "charts/../../x.json"):
            expect_rejected({**manifest, "face": bad_face}, f"非法 face 路径 {bad_face}")

        face_src = Path(td) / "face-src"
        face_src.mkdir()
        (face_src / "payload.txt").write_text("payload", encoding="utf-8")
        missing_face_dest = assets.asset_root() / "test-face-missing" / "v1"
        try:
            assets.archive(face_src, {**manifest, "name": "test-face-missing", "face": "face.json"})
            raise AssertionError("声明 face 但文件不存在应报错")
        except ValueError:
            pass
        assert not missing_face_dest.exists(), "face 缺文件时必须回滚已拷贝的版本目录"

        (face_src / "face.json").write_text('{"version": 1, "title": "测试脸", "blocks": []}',
                                            encoding="utf-8")
        face_dest = assets.archive(face_src, {**manifest, "name": "test-face-asset", "face": "face.json"})
        assert Path(face_dest, "face.json").is_file()
        idx = _json.loads((assets.asset_root() / "index.json").read_text(encoding="utf-8"))
        face_entry = next(a for a in idx["assets"] if a["name"] == "test-face-asset")
        assert face_entry["face"] == "face.json", face_entry
        no_face_entry = next(a for a in idx["assets"] if a["name"] == "test-asset")
        assert no_face_entry["face"] is None, no_face_entry
        # 手工修复版本目录（外部落地一个版本目录 + face.json）后 reindex() 刷新索引
        manual_dir = assets.asset_root() / "test-manual-asset" / "v1"
        manual_dir.mkdir(parents=True)
        (manual_dir / "face.json").write_text('{"version": 1, "title": "手工修复", "blocks": []}',
                                              encoding="utf-8")
        (manual_dir / "manifest.yaml").write_text(
            yaml.safe_dump({**manifest, "name": "test-manual-asset", "face": "face.json"},
                           sort_keys=False, allow_unicode=True), encoding="utf-8")
        before = _json.loads((assets.asset_root() / "index.json").read_text(encoding="utf-8"))
        assert all(a["name"] != "test-manual-asset" for a in before["assets"]), "手工落地前不应被索引"
        assets.reindex()
        after = _json.loads((assets.asset_root() / "index.json").read_text(encoding="utf-8"))
        manual_entry = next(a for a in after["assets"] if a["name"] == "test-manual-asset")
        assert manual_entry["face"] == "face.json", manual_entry
        print("[check] face 非法路径被拒、缺文件回滚、入库后 index.json face 键正确、reindex() 刷新索引")

        # ── 新旧兼容：手工写一份不含新字段的旧格式 manifest，再 archive 触发索引重建 ──
        legacy_dir = assets.asset_root() / "legacy-asset" / "v1"
        legacy_dir.mkdir(parents=True)
        legacy_manifest = {
            "name": "legacy-asset", "kind": "code", "version": 1,
            "created": "2026-08-01", "source_session": "sess-old",
            "description": "旧格式 manifest（无 origin/verbs/freshness/lineage/tags）",
            "interface": "legacy()", "dependencies": [], "depends_on": [],
            "supersedes": None, "validation": "历史遗留，未重跑",
        }
        (legacy_dir / "manifest.yaml").write_text(
            yaml.safe_dump(legacy_manifest, sort_keys=False, allow_unicode=True), encoding="utf-8")
        assets.archive(model_file, {**manifest, "name": "test-trigger", "version": 1})
        assert not list(assets.asset_root().glob("*.tmp")), "原子重建不应留下 .tmp 文件"

        idx = _json.loads((assets.asset_root() / "index.json").read_text(encoding="utf-8"))
        assert idx["version"] == 2, f"index.json version 应为 2: {idx['version']}"
        for a in idx["assets"]:
            for k in ("origin", "verbs", "freshness", "lineage", "tags"):
                assert k in a, f"{a['name']} 条目缺 {k}"
        legacy = next(a for a in idx["assets"] if a["name"] == "legacy-asset")
        assert legacy["origin"] is None and legacy["verbs"] == [], legacy
        assert assets.list_all(), "旧 manifest 不应阻断 list_all"
        print("[check] index.json version=2、六字段齐全，旧 manifest 兼容读取 OK")

        # index.json 每资产每版本与库内 manifest.yaml 的 name/kind/origin/verbs 一致
        for a in idx["assets"]:
            for ventry in a["versions"]:
                disk = yaml.safe_load(
                    (assets.find(a["name"], ventry["version"]) / "manifest.yaml").read_text(encoding="utf-8"))
                for k in ("name", "kind", "origin", "verbs"):
                    assert ventry["manifest"].get(k) == disk.get(k), (a["name"], ventry["version"], k)
            latest = a["versions"][-1]["manifest"]
            assert a["name"] == latest["name"] and a["kind"] == latest["kind"], a["name"]
            assert a["origin"] == latest.get("origin"), a["name"]
            assert a["verbs"] == (latest.get("verbs") or []), a["name"]
        print("[check] index.json 与库内 manifest 逐版本一致")
    finally:
        del os.environ["FINDECK_ASSET_DIR"]

print("\nALL TOOLBOX TESTS PASSED")
