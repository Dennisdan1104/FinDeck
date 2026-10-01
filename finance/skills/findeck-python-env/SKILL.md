---
name: findeck-python-env
description: >
  中文：FinDeck 的 Python 数据环境使用手册——venv 位置、解释器路径、预装清单（数据 + sklearn/lightgbm/statsmodels 经典模型 + findeck 工具包）、如何按需安装新包（含镜像源）、数据缓存目录约定、常见网络问题排查。任何要写 Python 代码拉取或处理金融数据的任务，先读本 Skill。
  English: FinDeck Python environment manual — venv and interpreter paths, the bundled inventory (data sources, sklearn/lightgbm/statsmodels, the findeck toolbox), installing extra packages from mirrors, cache directories, and network troubleshooting. Read it before writing any data script.
whenToUse: 当你需要运行 Python、安装 pip 包、遇到 akshare/yfinance/ccxt 报错或网络超时、或想知道数据缓存在哪里时使用。
---

# FinDeck Python 数据环境

FinDeck 预置了一个专用 Python 虚拟环境（下称"数据环境"），开箱即用地装好了金融
**数据获取**库与**经典模型**（sklearn/lightgbm/statsmodels，经 `findeck` 工具包统一接口提供）。
**重型模型库（PyTorch 系、零样本大模型）不预装**——按需安装，见 `findeck-quant-models`。

## 解释器路径

数据环境位于仓库的 `finance/python/.venv`。永远用它，不要用系统 Python：

| 平台 | 解释器（相对仓库根目录） |
|---|---|
| Windows | `finance/python/.venv/Scripts/python.exe` |
| Linux/macOS | `finance/python/.venv/bin/python` |

首次使用（或环境损坏时）先初始化：

```bash
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File finance/python/setup-env.ps1
# Linux/macOS/Git-Bash
bash finance/python/setup-env.sh
```

脚本幂等，可重复运行。

## 预装库（开箱即用）

数据处理：`pandas` `numpy` `scipy` `matplotlib` `pyarrow` `openpyxl` `tqdm` `requests`
**内置经典模型（AI 可直接调参）**：`scikit-learn` `lightgbm` `statsmodels`，
统一入口 `from findeck import quickmodels, charts`（见 `findeck-quant-models` / `findeck-visualization`）
中国市场：`akshare`（行情/财报/宏观/新闻）、`baostock`（A股K线备选）
全球市场：`yfinance`（美股/全球/外汇/商品）、`ccxt`（加密货币交易所）

**findeck 工具包**（quickmodels 统一建模接口 + charts 图表工厂）位于
`finance/python/findeck/`，由 setup 脚本通过 `.pth` 注册进 venv——
任何机器跑完 setup 后 `import findeck` 直接可用。
神经网络/零样本大模型（PyTorch、Chronos、TimesFM 等）**不预装**，按 skill 地图自己装。

## 安装新包（按需）

```bash
# 常规
finance/python/.venv/Scripts/python.exe -m pip install lightgbm
# 国内网络慢/超时，走清华镜像
finance/python/.venv/Scripts/python.exe -m pip install lightgbm -i https://pypi.tuna.tsinghua.edu.cn/simple
# PyTorch 只要 CPU 版（体积小很多）
finance/python/.venv/Scripts/python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
```

判断装什么：先查 `findeck-quant-models` / `findeck-backtesting` 的选型表，再装。

## 数据缓存与快照约定（重要）

**缓存**（本会话不重复拉数）：拉取的数据统一缓存在**当前工作区**的 `data/` 目录，
Parquet 格式，命名 `<市场>_<标的>_<频率>.parquet`：

```python
import akshare as ak
import pandas as pd
from pathlib import Path

def cache(df: pd.DataFrame, name: str) -> pd.DataFrame:
    """写入/读取工作区 data/ 缓存，重复任务不要重复拉数据。"""
    p = Path("data") / f"{name}.parquet"
    p.parent.mkdir(exist_ok=True)
    df.to_parquet(p)
    return df

# 用前先查缓存
p = Path("data/market_cn_600519_daily.parquet")
df = pd.read_parquet(p) if p.exists() else cache(ak.stock_zh_a_hist(...), "market_cn_600519_daily")
```

**快照**（数字可复现）：每次真正调接口取到的原始数据，默认再落一份
`data/snapshot_<接口名>_<参数摘要>_<日期>.parquet`。报告里的关键数字注明快照路径，
任何人（任何会话）都能用快照重算。统一入口（预装）：

```python
from findeck import snapshot as snap

# 取数：同参数同日已有快照直接复用（打印"复用快照"），否则执行 fetch 并落快照
df = snap.load_or_fetch(lambda: ak.stock_zh_a_hist(symbol="600519", period="daily",
                                                   start_date="20240101", end_date="20241231",
                                                   adjust="qfq"),
                        "stock_zh_a_hist", symbol="600519", period="daily",
                        start_date="20240101", end_date="20241231", adjust="qfq")

# 或：已经拿到 df，只补一份归档（参数与取数参数一致）
snap.snapshot(df, "stock_zh_a_hist", symbol="600519", period="daily",
              start_date="20240101", end_date="20241231", adjust="qfq")
```

- 开关：环境变量 `FINDECK_SNAPSHOT`，`0` 关闭，默认开（设置 UI 见「研究纪律」区）。
- 快照存**接口原始返回**（中文列名原样），清洗/重命名在快照之后做。
- 快照与缓存并存不冲突：缓存是加工后的干净数据，快照是原始证据。

## 跑脚本的标准姿势

把脚本写到工作区（如 `scripts/xxx.py`），用数据环境的解释器执行，结果落盘（图存 `output/`，数据存 `data/`）：

```bash
finance/python/.venv/Scripts/python.exe scripts/fetch_maotai.py
```

脚本结尾打印关键结论（`df.tail()`、指标数值），不要只打印"完成"。

## 故障排查

- **akshare/yfinance 超时或报错**：先重试一次；仍失败则确认网络（需要外网访问的库：yfinance/ccxt；国内可给进程设代理 `HTTPS_PROXY=http://127.0.0.1:7890`）。
- **akshare 接口返回空/列名变了**：akshare 迭代快，`print(ak.__version__)` 并去 akshare.akfamily.xyz 查该接口的最新参数；换备用接口（如 A股K线可用 baostock，见 `findeck-market-data-cn`）。
- **环境彻底坏了**：删除 `finance/python/.venv` 目录，重跑 setup-env 脚本。
- **装了包但 import 报 ModuleNotFoundError**：确认用的是 venv 里的 python，而不是系统 python。
