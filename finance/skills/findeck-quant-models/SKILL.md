---
name: findeck-quant-models
description: >
  中文：量化模型选型与按需安装指南——线性/逻辑回归、随机森林、LightGBM/XGBoost、ARIMA、LSTM/Transformer、零样本模型（Chronos/TimesFM）；预装 sklearn/lightgbm/statsmodels（findeck 工具箱），其余按需装，含模板与防过拟合纪律。预测股价/收益率/涨跌时用本 Skill。
  English: Quant-model selection guide — linear/logistic regression, random forest, LightGBM, XGBoost, ARIMA, LSTM/Transformer, and zero-shot models (Chronos/TimesFM). sklearn/lightgbm/statsmodels ship preinstalled behind the findeck toolbox; the rest install on demand, with templates and overfitting discipline.
whenToUse: 当任务需要训练模型、预测、回归、分类、因子有效性检验时使用。装包与解释器路径见 findeck-python-env。
---

# 量化模型地图

**原则：先问数据，再选模型。** 数据量、特征类型、可解释性要求决定选型，不要上来就深度学习。
`<py>` 代指数据环境解释器（见 `findeck-python-env`）。

## 首选路径：内置工具箱 findeck（预装，无需安装）

经典模型已内置并有统一接口（sklearn/lightgbm/statsmodels 已预装），
**AI 可通过 `params` 直接调参**：

```python
from findeck import quickmodels, charts

quickmodels.list_models()   # linear/ridge/lasso/randomforest/lightgbm/arima
y = quickmodels.make_target(df, horizon=1, mode='direction')   # 未来涨跌，防穿越
r = quickmodels.fit_predict(df, y, model='lightgbm', features=feats,
                            params={'n_estimators': 300, 'num_leaves': 15,
                                    'learning_rate': 0.05})    # ← 调参入口
r['metrics']['mean']    # {'accuracy': …, 'auc': …}（回归则 mae/rmse/ic/r2）
r['predictions']        # 分类=正类概率（predict_proba，策略阈值作用在它上面）；回归=预测值
r['labels']             # 分类=0/1 硬标签（predict）；回归=None
r['importance']         # 特征重要度 Series
charts.feature_importance_chart(r['importance'])  # 出图（read_image 展示）
```

- 时序交叉验证内置（TimeSeriesSplit，绝不 shuffle），逐折+均值指标都返回。
- ridge/lasso 分类时 `alpha` 自动转 `C`（sklearn 惯例）；`lasso` 分类走真 L1 逻辑回归，系数稀疏可当特征筛选。
- arima 走滚动起点验证，`params={"order":[p,d,q]}`。

**何时不走工具箱**：需要定制流水线（自定交叉验证、多步预测、自定义损失）或
用下面地图里的神经网络/零样本模型时，直接用原生库写。

## 选型决策表（场景 → 模型）

| 场景 | 首选 | 安装 | 理由 |
|---|---|---|---|
| 基线/可解释要求高（估值 vs 因子的弹性） | 线性回归 / 岭回归 Ridge | `scikit-learn` | 系数即敏感性，小样本稳健 |
| 预测涨跌方向（分类） | 逻辑回归 → LightGBM | `scikit-learn` → `lightgbm` | 先跑逻辑回归当基线，再比 |
| 截面因子预测收益（表格特征，几百~几万样本） | **LightGBM** | `lightgbm` | 表格数据之王，快、抗过拟合、有特征重要度 |
| 同上但特征少样本多 | XGBoost | `xgboost` | 与 LightGBM 二选一，调参空间大 |
| 传统单序列预测（GDP/利率等宏观） | ARIMA/SARIMAX | `statsmodels` | 统计基线，几十个点也稳 |
| 长序列复杂模式、样本 ≥ 数千 | N-BEATS/N-HiTS | `neuralforecast`（自带 torch） | 神经网络入门首选，API 最简 |
| 多变量长序列、Transformer 系列（PatchTST/DLinear 等） | Time-Series-Library | 见下文 | thuml 维护，学术主流模型全家桶 |
| 没有训练数据/要快速基准 | 零样本时序基础模型 | `chronos-forecasting` 或 `timesfm` | 预训练大模型直接出预测，当强基线 |

## 按需安装命令（sklearn/lightgbm/statsmodels 已预装；以下是其余的）

```bash
<py> -m pip install xgboost
<py> -m pip install neuralforecast                               # N-BEATS/N-HiTS/NHITS，自动装 torch
<py> -m pip install torch --index-url https://download.pytorch.org/whl/cpu   # 只要 CPU 版，省几个GB
<py> -m pip install chronos-forecasting                          # 零样本：amazon/chronos-t5-small
<py> -m pip install timesfm                                      # 零样本：google/timesfm-2.0-500m-pytorch
```

网络慢加 `-i https://pypi.tuna.tsinghua.edu.cn/simple`（pytorch 官方源除外）。

## 开源仓库（要下代码时）

| 仓库 | 内容 | 地址 |
|---|---|---|
| Time-Series-Library | DLinear/PatchTST/iTransformer/Autoformer 等 30+ 时序模型统一框架 | github.com/thuml/Time-Series-Library |
| neuralforecast | Nixtla 的神经时序库（N-BEATS/N-HiTS/TFT） | github.com/Nixtla/neuralforecast |
| LTSF-DLinear | 长期预测经典论文代码（简单线性打爆Transformer的出处） | github.com/cure-lab/LTSF-DLinear |
| HuggingFace 时序模型 | Chronos/TimesFM/Moirai 权重直接下载 | huggingface.co/models?pipeline_tag=time-series-forecasting |

## 最小模板：LightGBM 预测次日涨跌

```python
import lightgbm as lgb
import numpy as np, pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import roc_auc_score

df = pd.read_parquet("data/market_cn_600519_daily.parquet").dropna()

# 特征：只用 T-1 及以前的信息（防特征穿越！）
for n in (5, 10, 20, 60):
    df[f"ret_{n}d"] = df["close"].pct_change(n)
    df[f"vol_{n}d"]  = df["pct_chg"].rolling(n).std()
df[f"vol_ratio"] = df["volume"] / df["volume"].rolling(20).mean()
feats = [c for c in df.columns if c.startswith(("ret_", "vol_"))]
df["target"] = (df["close"].shift(-1) > df["close"]).astype(int)   # 次日涨=1
d = df.dropna(subset=feats + ["target"])

# 时序交叉验证：绝不 shuffle
aucs = []
for tr_idx, te_idx in TimeSeriesSplit(n_splits=5).split(d):
    m = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05,
                           num_leaves=15, min_child_samples=40, verbose=-1)
    m.fit(d.iloc[tr_idx][feats], d.iloc[tr_idx]["target"])
    p = m.predict_proba(d.iloc[te_idx][feats])[:, 1]
    aucs.append(roc_auc_score(d.iloc[te_idx]["target"], p))
print("fold AUC:", np.round(aucs, 3), "mean:", np.mean(aucs).round(3))
# 判断：AUC 稳定 > 0.55 才有信号价值；贴近 0.5 就是没学到东西
# AUC 必须用 predict_proba 的概率算——硬标签（predict 的 0/1）没有排序信息，算出来只是 accuracy 的翻版
```

## 最小模板：零样本预测（Chronos，不训练直接出数）

```python
import numpy as np
import pandas as pd
import torch
from chronos import BaseChronosPipeline

df = pd.read_parquet("data/market_cn_600519_daily.parquet")
pipe = BaseChronosPipeline.from_pretrained(
    "amazon/chronos-t5-small",
    device_map="cpu", torch_dtype=torch.bfloat16)
fcst = pipe.predict(context=torch.tensor(df["close"].values, dtype=torch.float32),
                    prediction_length=20)      # 形状 (batch, num_quantiles, prediction_length)
q = fcst[0].float().numpy()                    # (num_quantiles, prediction_length)
levels = np.asarray(getattr(pipe, "quantiles", [0.1, 0.5, 0.9]), dtype=float)
pick = lambda target: int(np.argmin(np.abs(levels - target)))
lo, med, hi = q[pick(0.1)], q[pick(0.5)], q[pick(0.9)]   # 取模型自己的分位点，别对 axis=0 再求 quantile
print("中位预测:", med.round(2), "\n80%区间:", lo.round(2), hi.round(2))
```

## 评估纪律（金融场景特有的坑）

1. **时序切分**：`TimeSeriesSplit`/walk-forward，任何 shuffle 都是作弊。
   **`make_target(horizon=N)` 在 N>1 时标签跨折重叠**：训练折末尾的样本，其标签区间伸进了测试折，
   与测试集共享价格信息，不处理就是泄漏。必须 purge（从训练折末尾剔除 ≥N 行）+ embargo（再从测试折开头剔除几行）：
   `quickmodels.fit_predict(df, y, model='lightgbm', features=feats, purge=5, embargo=5)`；
   手写切分同理：`tr = tr[:-5]`、`te = te[embargo:]`（horizon=5 时 purge 至少 5）。
2. **特征穿越**：每个特征写下来"它在当日收盘后可知吗"。用次日数据造特征是最常见事故。
3. **评估指标对齐任务**：回归预测收益用 MAE/RMSE + **IC**（预测值与实际收益的 Spearman 相关，|IC|>0.03 在截面上已可用）；分类用 AUC；都要和朴素基线（昨日涨跌/均值）比。
4. **样本外**：留出最后 15%~20% 做最终测试，只看一次。
5. **多重检验**：调参轮数多了，最好成绩会虚假膨胀；报告样本外成绩，不报告调参最好成绩。
6. **类别不平衡**：涨跌接近 50/50 没问题；预测大涨/大跌时用 `scale_pos_weight` 或概率校准。
7. **迭代修正协议**：第一版模型跑完禁止直接下结论——残差诊断→信息缺口清单→补料→重跑，
   每轮记录指标对比，最多 5 轮。完整协议见 `findeck-research` 第 4.5 步（建模任务必须执行）。
8. **训练产物归档**：训练出的模型/下载的权重自动归档进全局资产库
   （`from findeck import assets`，manifest 必填、版本并存），见 `findeck-research` 第 8 步。
