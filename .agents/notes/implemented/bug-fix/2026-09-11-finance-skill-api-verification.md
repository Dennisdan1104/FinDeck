# Agent Note: Finance skills are verified against the installed environment

Status: implemented

English | [中文](2026-09-11-finance-skill-api-verification.zh.md)

## Problem

The ten `finance/skills/*/SKILL.md` manuals tell the model which library call to make and which metric to trust. An audit checked every claimed akshare function against the venv that `finance/python/setup-env.sh` actually builds and found the manuals had drifted from it:

- `ak.stock_a_indicator_lg` (`alphadeck-market-data-cn`) and `ak.index_stock_hist` (`alphadeck-backtesting`) do not exist in the installed akshare. Both were load-bearing: the first was one of the four pillars of single-stock valuation, the second was the only stated route to historical index membership.
- `quickmodels.fit_predict` derived classification `auc` and `accuracy` from `est.predict` — hard 0/1 labels — so `roc_auc_score` scored a quantized statistic (measured 0.6434 where the same folds' probability AUC was 0.6695). `alphadeck-quant-models` builds its "AUC above 0.55 is worth acting on" advice on that number.
- `lasso` promised L1 sparsity but mapped classification to a plain `LogisticRegression` (sklearn's default penalty is L2), so no coefficient was ever zeroed.
- Transaction costs were off by an order of magnitude: `commission=0.0003` was labelled 千三 (0.3 %) when it is 万三 (0.03 %), and the neighbouring advice put A-share round-trip cost at 0.1 %–0.3 % against a real retail 万1–万3 per side.
- `requirements-data.txt` pinned only floors with no upper bounds, so the resolved akshare version — the dependency the manuals are written against — was whatever PyPI served that day. That is how the two dead functions arose.

Two scripts that exist to prove the layer works could not run where it matters: `test-toolbox.py` read `data/market_cn_600519_daily_bs.parquet`, a file no script in the repository creates and `data/` is gitignored, so it failed on a fresh clone with `FileNotFoundError`; and nothing in `pytest.ini`, `package.json`, the CI configuration or `scripts/` referenced the finance layer at all, so no gate would ever have caught any of this.

## Decision

Every API name and every number a skill states is verified against the installed venv before it is written down, and the environment pins the versions that make those statements true.

- The dead valuation call is replaced by `stock_zh_valuation_baidu(symbol, indicator, period)` plus `stock_zh_valuation_comparison_em` for the peer table, both called live before being documented. The legulegu family (`stock_a_all_pb`, `stock_index_pe_lg`, `stock_index_pb_lg`) was rejected: it exists but returns `None` at runtime.
- Historical index membership is documented through `index_detail_hist_adjust_cni` (membership intervals plus an adjustment kind), which reconstructs a past constituent list; `index_stock_cons_csindex` and `index_component_sw` are documented as latest-only so the survivorship warning is actionable rather than decorative.
- `quickmodels.fit_predict` returns probabilities for classifiers and carries hard labels separately, so AUC is a probability AUC and a strategy threshold reads as a confidence.
- `lasso` classification uses a real L1 penalty, chosen by introspecting which parameter form the installed scikit-learn accepts.
- `fit_predict` gained `purge` and `embargo`, and `alphadeck-quant-models` warns that a `horizon > 1` target overlaps across `TimeSeriesSplit` folds.
- `requirements-data.txt` carries upper bounds, declares `scipy` explicitly, and states the pinning policy; `akshare` is capped by minor version because it is the dependency the manuals track.
- `test-toolbox.py` runs from the cache when present, fetches through the documented akshare path when it is not, and falls back to a deterministic synthetic frame offline, printing which path it took. The READMEs in both languages now describe that behaviour instead of claiming a fetch that never happened.

## Alternatives considered

**Verify the manuals by reading the installed package's signatures only.** Rejected: signature introspection would have kept `stock_a_all_pb`, whose failure is at call time rather than at import. The functions that survived verification were called.

**Pin akshare exactly and leave the manuals alone.** Rejected: an exact pin documents one day's environment, and the manuals are read by a model that cannot tell a stale name from a live one when it fails mid-task. Correct names plus a bounded range keep the two in step.

**Leave `test-toolbox.py` as a manual pre-requisite and document the missing file.** Rejected: a regression test that cannot run is not a regression test, and the README's claim that it needs real data was already false.

## Consequences

- A skill's stated call works against the environment `setup-env` builds, and the two commands that verify this are reproducible without a network.
- The finance layer still has no gate in `package.json`, `pytest.ini` or CI. These fixes are enforced by the pinning policy and by whoever next edits a skill, not by automation.
- `backtrader`, Chronos and the EastMoney board endpoints could not be exercised here; the snippets that touch them read either key casing, default through `getattr`, and state where a board name must come from, rather than asserting an unverified behaviour.
- A model reading a corrected manual gets a working call; a model reading a version outside the pinned range can still meet a moved API, which the manual cannot prevent.
