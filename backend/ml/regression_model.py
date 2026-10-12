"""Module 3b: Linear Regression forecasting.

Fits a least-squares trend line over recent real monitoring history and
extrapolates it to predict future CPU and memory utilisation.

These are PREDICTIONS. They are reported separately from threshold alerts
and never trigger one, per the spec.
"""
from __future__ import annotations

import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

from config import Config
from services import mongo

SUPPORTED = ("cpu", "memory")


def _trend(slope_per_hour: float) -> str:
    if slope_per_hour > 1.0:
        return "rising"
    if slope_per_hour < -1.0:
        return "falling"
    return "stable"


def run(metric: str = "cpu", horizon_minutes: int = 30,
        window: int | None = None) -> dict[str, Any]:
    """Predict `metric` up to `horizon_minutes` into the future."""
    metric = metric.lower()
    if metric not in SUPPORTED:
        return {
            "status": "error",
            "message": f"Unsupported metric '{metric}'. Supported: {list(SUPPORTED)}",
        }

    window = window or Config.REGRESSION_WINDOW
    samples = mongo.recent_samples(window)
    df = pd.DataFrame(samples)

    if not df.empty and metric in df.columns:
        df = df.dropna(subset=["ts", metric])
    else:
        df = pd.DataFrame()

    if len(df) < Config.REGRESSION_MIN_SAMPLES:
        return {
            "status": "insufficient_data",
            "metric": metric,
            "message": (
                f"Linear Regression needs at least "
                f"{Config.REGRESSION_MIN_SAMPLES} samples; {len(df)} collected."
            ),
            "samples_available": int(len(df)),
            "samples_required": Config.REGRESSION_MIN_SAMPLES,
        }

    # X = minutes elapsed since the first sample in the window.
    t0 = float(df["ts"].iloc[0])
    X = ((df["ts"].to_numpy(dtype=float) - t0) / 60.0).reshape(-1, 1)
    y = df[metric].to_numpy(dtype=float)

    model = LinearRegression().fit(X, y)
    fitted = model.predict(X)

    slope_per_min = float(model.coef_[0])
    slope_per_hour = slope_per_min * 60.0
    r2 = round(float(r2_score(y, fitted)), 4)

    # Forecast at 5-minute steps out to the horizon.
    last_minute = float(X[-1][0])
    last_ts = float(df["ts"].iloc[-1])
    step = 5
    future_minutes = np.arange(step, horizon_minutes + step, step, dtype=float)
    future_X = (last_minute + future_minutes).reshape(-1, 1)
    predicted = model.predict(future_X)
    # Utilisation is a percentage - clamp the extrapolation to a valid range.
    predicted = np.clip(predicted, 0.0, 100.0)

    predictions = [
        {
            "ts": last_ts + float(m) * 60.0,
            "minutes_ahead": int(m),
            "predicted": round(float(v), 2),
        }
        for m, v in zip(future_minutes, predicted)
    ]

    history = [
        {"ts": float(r.ts), "value": round(float(getattr(r, metric)), 2)}
        for r in df.tail(120).itertuples()
    ]

    result = {
        "status": "ok",
        "algorithm": "Linear Regression",
        "metric": metric,
        "generated_at": time.time(),
        "samples_analysed": int(len(df)),
        "horizon_minutes": horizon_minutes,
        "current_value": round(float(y[-1]), 2),
        "predicted_at_horizon": round(float(predicted[-1]), 2),
        "slope_per_hour": round(slope_per_hour, 4),
        "intercept": round(float(model.intercept_), 4),
        "r2_score": r2,
        "trend": _trend(slope_per_hour),
        "history": history,
        "predictions": predictions,
    }

    mongo.save_ml_result("regression", {
        "ts": result["generated_at"],
        "metric": metric,
        "predicted_at_horizon": result["predicted_at_horizon"],
        "horizon_minutes": horizon_minutes,
        "slope_per_hour": result["slope_per_hour"],
        "r2_score": r2,
        "trend": result["trend"],
    })
    return result


def run_all(horizon_minutes: int = 30) -> dict[str, Any]:
    """Forecast every supported metric - used by the dashboard overview."""
    return {m: run(m, horizon_minutes) for m in SUPPORTED}
