"""Module 3a: K-Means Clustering.

Groups similar resource-utilisation patterns and labels the resulting
clusters Low / Medium / High based on the cluster centroids.

This is UNSUPERVISED pattern analysis only. It never raises alerts -
threshold alerting lives separately in alerts/threshold.py, as the spec
requires.
"""
from __future__ import annotations

import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from config import Config
from services import mongo

FEATURES = ["cpu", "memory", "disk", "net_total"]
LABEL_NAMES = ["Low", "Medium", "High"]


def _build_frame(samples: list[dict]) -> pd.DataFrame:
    """Preprocess raw samples into a clean numeric feature matrix."""
    df = pd.DataFrame(samples)
    if df.empty:
        return df

    # Network throughput is two counters; combine into one feature and
    # convert bytes/s -> megabytes/s so it is on a comparable scale.
    df["net_total"] = (
        df.get("net_rx", pd.Series(0, index=df.index)).fillna(0)
        + df.get("net_tx", pd.Series(0, index=df.index)).fillna(0)
    ) / (1024 * 1024)

    for col in ("cpu", "memory", "disk"):
        if col not in df.columns:
            df[col] = np.nan

    df = df.dropna(subset=["cpu", "memory", "disk"])
    return df


def run(window: int | None = None, k: int | None = None) -> dict[str, Any]:
    """Cluster the most recent samples. Returns a JSON-serialisable result."""
    window = window or Config.KMEANS_WINDOW
    k = k or Config.KMEANS_K

    samples = mongo.recent_samples(window)
    df = _build_frame(samples)

    if len(df) < Config.KMEANS_MIN_SAMPLES:
        return {
            "status": "insufficient_data",
            "message": (
                f"K-Means needs at least {Config.KMEANS_MIN_SAMPLES} samples; "
                f"{len(df)} collected so far."
            ),
            "samples_available": len(df),
            "samples_required": Config.KMEANS_MIN_SAMPLES,
        }

    X = df[FEATURES].to_numpy(dtype=float)

    # Standardise so no single feature dominates the distance metric.
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    k_eff = min(k, len(df))
    model = KMeans(n_clusters=k_eff, n_init=10, random_state=Config.RANDOM_STATE)
    raw_labels = model.fit_predict(X_scaled)

    # Centroids back in real units (%, MB/s) so they are interpretable.
    centroids = scaler.inverse_transform(model.cluster_centers_)

    # Rank clusters by overall load (mean of CPU/memory/disk) and map the
    # ranked order onto Low -> Medium -> High.
    load_score = centroids[:, :3].mean(axis=1)
    order = np.argsort(load_score)
    names = LABEL_NAMES if k_eff == 3 else [f"Cluster {i + 1}" for i in range(k_eff)]
    cluster_to_name = {int(cid): names[rank] for rank, cid in enumerate(order)}

    df = df.assign(cluster=raw_labels)
    df["usage_level"] = df["cluster"].map(cluster_to_name)

    # Cluster quality - reported on the analysis screen.
    silhouette: float | None = None
    if 1 < k_eff < len(df):
        try:
            silhouette = round(float(silhouette_score(X_scaled, raw_labels)), 4)
        except ValueError:
            silhouette = None

    cluster_summary = []
    for cid in range(k_eff):
        member_mask = df["cluster"] == cid
        cluster_summary.append({
            "cluster_id": int(cid),
            "usage_level": cluster_to_name[cid],
            "count": int(member_mask.sum()),
            "percentage": round(float(member_mask.mean() * 100), 2),
            "centroid": {
                "cpu": round(float(centroids[cid][0]), 2),
                "memory": round(float(centroids[cid][1]), 2),
                "disk": round(float(centroids[cid][2]), 2),
                "net_mbps": round(float(centroids[cid][3]), 4),
            },
        })
    cluster_summary.sort(key=lambda c: LABEL_NAMES.index(c["usage_level"])
                         if c["usage_level"] in LABEL_NAMES else c["cluster_id"])

    latest = df.iloc[-1]
    points = [
        {
            "ts": float(row.ts),
            "cpu": round(float(row.cpu), 2),
            "memory": round(float(row.memory), 2),
            "usage_level": row.usage_level,
        }
        for row in df.tail(200).itertuples()
    ]

    result = {
        "status": "ok",
        "algorithm": "K-Means Clustering",
        "generated_at": time.time(),
        "k": k_eff,
        "features": FEATURES,
        "samples_analysed": int(len(df)),
        "silhouette_score": silhouette,
        "clusters": cluster_summary,
        "current": {
            "ts": float(latest.ts),
            "usage_level": latest.usage_level,
            "cpu": round(float(latest.cpu), 2),
            "memory": round(float(latest.memory), 2),
            "disk": round(float(latest.disk), 2),
        },
        "points": points,
    }

    mongo.save_ml_result("kmeans", {
        "ts": result["generated_at"],
        "clusters": cluster_summary,
        "current_level": latest.usage_level,
        "silhouette_score": silhouette,
        "samples_analysed": int(len(df)),
    })
    return result
