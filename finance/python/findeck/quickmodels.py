"""统一调参建模接口：一个 fit_predict 覆盖内置经典模型。

设计约定
--------
- 输入是已经清洗好的 DataFrame（行=时间，按时间升序；时序任务绝不 shuffle）。
- 目标变量由 :func:`make_target` 构造（未来收益/方向），从源头防特征穿越。
- ``params`` 字典原样传给底层估计器——这就是 AI 的调参入口，没有隐藏默认值魔法。
- 分类任务下 ``predictions`` 是**正类概率**（``predict_proba`` 若可用，否则退化为硬标签），
  ``labels`` 是 ``predict`` 的 0/1 硬标签；策略阈值（如 ``pred > 0.55``）作用在概率上，
  ``auc`` 也由概率算出（硬标签的 AUC 只反映 accuracy，无排序信息）。
- 返回 plain dict：``metrics``（逐折+均值）、``predictions``、``labels``、
  ``importance``（若模型支持）、``fitted``（最后一个估计器对象）。
"""
from __future__ import annotations

import inspect

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import (
    Lasso,
    LinearRegression,
    LogisticRegression,
    Ridge,
)
from sklearn.metrics import (
    accuracy_score,
    mean_absolute_error,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import TimeSeriesSplit

__all__ = ['list_models', 'make_target', 'fit_predict']

# sklearn 1.8 起 LogisticRegression 的 penalty 参数弃用、改由 l1_ratio 选择正则，
# 更晚的版本会直接删掉该参数；旧版只认 penalty。按签名默认值判断当前版本认哪种写法。
_PENALTY_PARAM = inspect.signature(LogisticRegression.__init__).parameters.get('penalty')
_L1_VIA_L1_RATIO = _PENALTY_PARAM is None or _PENALTY_PARAM.default == 'deprecated'

# 内置模型注册表：名字 → (回归类, 分类类, 中文说明)
_MODEL_REGISTRY: dict[str, tuple[type, type, str]] = {
    'linear': (LinearRegression, LogisticRegression, '线性回归/逻辑回归：可解释基线'),
    'ridge': (Ridge, LogisticRegression, '岭回归：带 L2 的线性，小样本稳健'),
    'lasso': (Lasso, LogisticRegression, 'Lasso：带 L1 的线性，自动稀疏选特征（分类走 L1 逻辑回归）'),
    'randomforest': (RandomForestRegressor, RandomForestClassifier, '随机森林：bagging 树，抗过拟合'),
    'lightgbm': (None, None, '梯度提升树：表格数据首选（回归=LGBMRegressor，分类=LGBMClassifier）'),
    'arima': (None, None, 'ARIMA：单序列统计基线，只用目标自身历史，忽略 features'),
}


def list_models() -> pd.DataFrame:
    """列出内置模型与一句话选型提示。"""
    return pd.DataFrame(
        [(k, v[2]) for k, v in _MODEL_REGISTRY.items()],
        columns=['model', 'note'],
    )


def make_target(
    df: pd.DataFrame,
    horizon: int = 1,
    mode: str = 'direction',
    price: str = 'close',
) -> pd.Series:
    """构造**未来**目标变量（防穿越：T 日的目标只依赖 T+horizon 及以后的价格）。

    :param df: 按时间升序的行情表。
    :param horizon: 向前看的天数。
    :param mode: ``'return'`` 未来收益率（回归）或 ``'direction'`` 涨跌方向（分类，0/1）。
    :param price: 价格列名。
    :returns: 与 df 等长的 Series，最后 horizon 行为 NaN（调用方 dropna）。
    """
    fwd = df[price].shift(-horizon) / df[price] - 1
    if mode == 'return':
        return fwd
    if mode == 'direction':
        return (fwd > 0).astype(float).mask(fwd.isna())
    raise ValueError(f"mode must be 'return' or 'direction', got {mode!r}")


def _alpha_to_c(params: dict) -> dict:
    """sklearn 线性族惯例：回归用正则强度 alpha，分类用其倒数 C。"""
    return {
        ('C' if k == 'alpha' else k): (1.0 / v if k == 'alpha' and v else v)
        for k, v in params.items()
    }


def _l1_logistic(**params) -> LogisticRegression:
    """Lasso 的分类对应物：L1 正则逻辑回归，系数稀疏。"""
    p = {'C': 1.0, 'solver': 'liblinear', **params}
    if _L1_VIA_L1_RATIO:
        p.setdefault('l1_ratio', 1.0)
    else:
        p.setdefault('penalty', 'l1')
    return LogisticRegression(**p)


def _build_estimator(model: str, task: str, params: dict | None):
    p = _alpha_to_c(params or {}) if task == 'classification' else dict(params or {})
    if model == 'lightgbm':
        import lightgbm as lgb

        p.setdefault('verbose', -1)
        return lgb.LGBMRegressor(**p) if task == 'regression' else lgb.LGBMClassifier(**p)
    if model == 'lasso' and task == 'classification':
        return _l1_logistic(**p)
    reg_cls, clf_cls, _ = _MODEL_REGISTRY[model]
    return reg_cls(**p) if task == 'regression' else clf_cls(**p)


def fit_predict(
    df: pd.DataFrame,
    target: pd.Series,
    model: str = 'lightgbm',
    features: list[str] | None = None,
    params: dict | None = None,
    n_splits: int = 5,
    purge: int = 0,
    embargo: int = 0,
) -> dict:
    """时序交叉验证训练+评估一个内置模型。

    :param df: 特征表（DatetimeIndex 升序）。ARIMA 时忽略。
    :param target: 与 df 对齐的目标（建议来自 make_target）；已 dropna 的行参与训练。
    :param model: ``list_models()`` 中的名字。
    :param features: 用哪些列；None=全部数值列。
    :param params: 原样传给底层估计器（AI 的调参入口）。
    :param n_splits: TimeSeriesSplit 折数。
    :param purge: 每折从训练段末尾丢弃的行数；``make_target(horizon=N)`` 时传 N 可消除
        标签重叠导致的训练/测试泄漏。arima 走滚动起点验证，不使用本参数。
    :param embargo: 每折从测试段开头丢弃的行数，进一步拉开训练与测试的间隔。
    :returns: ``{'model', 'task', 'metrics', 'predictions', 'labels', 'importance', 'fitted'}``；
        分类时 ``predictions`` 是正类概率、``labels`` 是硬标签，回归时 ``labels`` 为 None。
    """
    if model not in _MODEL_REGISTRY:
        raise ValueError(f'unknown model {model!r}; call list_models() to see options')
    data = df.copy()
    y_all = target.reindex(data.index)
    valid = y_all.notna()
    data, y_all = data[valid], y_all[valid].astype(float)
    task = 'classification' if set(np.unique(y_all.to_numpy())) <= {0.0, 1.0} else 'regression'

    if model == 'arima':
        return _fit_arima(y_all, params, n_splits)

    feats = features or [c for c in data.columns if pd.api.types.is_numeric_dtype(data[c])]
    X = data[feats].astype(float)
    # LightGBM 原生接受 NaN，sklearn 线性族不接受：这里统一按行清洗。
    mask = X.notna().all(axis=1) & y_all.notna()
    X, y_all = X[mask], y_all[mask]

    def metrics_of(y_true: np.ndarray, score: np.ndarray, label: np.ndarray) -> dict:
        if task == 'classification':
            out = {'accuracy': float(accuracy_score(y_true, label))}
            if len(np.unique(y_true)) == 2:
                out['auc'] = float(roc_auc_score(y_true, score))
            return out
        ic = spearmanr(y_true, score).statistic
        return {
            'mae': float(mean_absolute_error(y_true, score)),
            'rmse': float(np.sqrt(np.mean((y_true - score) ** 2))),
            'ic': float(ic) if np.isfinite(ic) else 0.0,
            'r2': float(r2_score(y_true, score)) if len(y_true) > 2 else float('nan'),
        }

    folds: list[dict] = []
    preds: list[pd.Series] = []
    labels: list[pd.Series] = []
    fitted = None
    splitter = TimeSeriesSplit(n_splits=n_splits)
    for k, (tr, te) in enumerate(splitter.split(X)):
        tr = tr[:max(len(tr) - purge, 0)] if purge else tr
        te = te[embargo:] if embargo else te
        if len(tr) == 0 or len(te) == 0:
            continue
        est = _build_estimator(model, task, params)
        est.fit(X.iloc[tr], y_all.iloc[tr])
        y_te = y_all.iloc[te].to_numpy()
        label = None
        if task == 'classification' and hasattr(est, 'predict_proba'):
            score = np.asarray(est.predict_proba(X.iloc[te]))[:, 1]
            label = np.asarray(est.predict(X.iloc[te]), dtype=float)
        else:
            score = np.asarray(est.predict(X.iloc[te]), dtype=float)
        folds.append({
            **metrics_of(y_te, score, label if label is not None else score),
            'train_n': int(len(tr)),
            'test_n': int(len(te)),
        })
        preds.append(pd.Series(score, index=X.index[te], name=f'fold{k}'))
        if label is not None:
            labels.append(pd.Series(label, index=X.index[te], name=f'fold{k}'))
        fitted = est

    if not folds:
        raise ValueError(
            f'没有可用折：样本 {len(X)} 行，n_splits={n_splits}，purge={purge}，embargo={embargo}'
        )
    mean = {k: float(np.mean([f[k] for f in folds])) for k in folds[0] if k not in ('train_n', 'test_n')}
    importance = None
    if fitted is not None and hasattr(fitted, 'feature_importances_'):
        importance = pd.Series(fitted.feature_importances_, index=feats).sort_values(ascending=False)
    elif fitted is not None and hasattr(fitted, 'coef_'):
        importance = pd.Series(np.ravel(fitted.coef_), index=feats).sort_values(key=abs, ascending=False)
    return {
        'model': model,
        'task': task,
        'metrics': {'folds': folds, 'mean': mean},
        'predictions': pd.concat(preds) if preds else pd.Series(dtype=float),
        'labels': pd.concat(labels) if labels else None,
        'importance': importance,
        'fitted': fitted,
    }


def _fit_arima(y: pd.Series, params: dict | None, n_splits: int) -> dict:
    """ARIMA 走滚动起点验证：逐折用前缀拟合、预测随后一段。"""
    order = tuple((params or {}).get('order', (1, 1, 1)))
    from statsmodels.tsa.arima.model import ARIMA

    folds, preds = [], []
    n = len(y)
    step = max(n // (n_splits + 1), 5)
    for k in range(1, n_splits + 1):
        cut = step * k
        if cut >= n - 2:
            break
        # 位置索引训练：statsmodels 对无频率的 DatetimeIndex 推断未来索引会失败。
        est = ARIMA(y.iloc[:cut].reset_index(drop=True), order=order).fit()
        p = np.asarray(est.forecast(steps=min(step, n - cut)), dtype=float)
        yt = y.iloc[cut:cut + len(p)].to_numpy()
        if len(yt) != len(p):
            break
        mae = float(np.mean(np.abs(yt - p)))
        folds.append({'mae': mae, 'rmse': float(np.sqrt(np.mean((yt - p) ** 2))), 'train_n': cut, 'test_n': len(p)})
        preds.append(pd.Series(p, index=y.index[cut:cut + len(p)], name=f'fold{k}'))
    mean = {k: float(np.mean([f[k] for f in folds])) for k in folds[0] if k not in ('train_n', 'test_n')} if folds else {}
    return {
        'model': 'arima',
        'task': 'regression',
        'metrics': {'folds': folds, 'mean': mean},
        'predictions': pd.concat(preds) if preds else pd.Series(dtype=float),
        'labels': None,
        'importance': None,
        'fitted': None,
    }
