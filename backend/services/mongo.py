"""MongoDB access layer.

Stores application data, alert records, configuration and the selected
monitoring history - exactly the four things the spec asks MongoDB to hold.
Prometheus remains the source of truth for raw time-series; MongoDB holds
the preprocessed samples CloudPulse actually analyses.
"""
from __future__ import annotations

import logging
from typing import Any

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError

from config import Config

log = logging.getLogger(__name__)

_client: MongoClient | None = None

# Collection names
METRICS = "metrics_history"
ALERTS = "alerts"
ALERT_CONFIG = "alert_config"
ML_RESULTS = "ml_results"


def get_client() -> MongoClient:
    global _client
    if _client is None:
        _client = MongoClient(Config.MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client


def get_db():
    return get_client()[Config.MONGO_DB]


def init() -> None:
    """Create indexes and seed default alert thresholds. Idempotent."""
    db = get_db()
    db[METRICS].create_index([("ts", DESCENDING)])
    db[ALERTS].create_index([("ts", DESCENDING)])
    db[ALERTS].create_index([("metric", ASCENDING), ("severity", ASCENDING),
                             ("ts", DESCENDING)])
    db[ML_RESULTS].create_index([("kind", ASCENDING), ("ts", DESCENDING)])

    if db[ALERT_CONFIG].count_documents({"_id": "thresholds"}) == 0:
        db[ALERT_CONFIG].insert_one({
            "_id": "thresholds",
            "values": Config.DEFAULT_THRESHOLDS,
        })
        log.info("seeded default alert thresholds")


def ping() -> dict[str, Any]:
    """Diagnostics for /api/health."""
    info: dict[str, Any] = {"uri": Config.MONGO_URI, "connected": False}
    try:
        get_client().admin.command("ping")
        info["connected"] = True
        db = get_db()
        info["database"] = Config.MONGO_DB
        info["samples_stored"] = db[METRICS].count_documents({})
        info["alerts_stored"] = db[ALERTS].count_documents({})
    except PyMongoError as exc:
        info["error"] = str(exc)
    return info


# ---------------------------------------------------------------------- #
# Metrics history
# ---------------------------------------------------------------------- #
def insert_samples(samples: list[dict]) -> int:
    if not samples:
        return 0
    res = get_db()[METRICS].insert_many(samples, ordered=False)
    return len(res.inserted_ids)


def recent_samples(limit: int, projection: dict | None = None) -> list[dict]:
    """Most recent N samples, returned oldest-first (chronological)."""
    cursor = (get_db()[METRICS]
              .find({}, projection or {"_id": 0})
              .sort("ts", DESCENDING)
              .limit(limit))
    return list(cursor)[::-1]


def samples_since(ts_epoch: float) -> list[dict]:
    cursor = (get_db()[METRICS]
              .find({"ts": {"$gte": ts_epoch}}, {"_id": 0})
              .sort("ts", ASCENDING))
    return list(cursor)


def sample_count() -> int:
    return get_db()[METRICS].count_documents({})


def latest_sample() -> dict | None:
    return get_db()[METRICS].find_one({}, {"_id": 0}, sort=[("ts", DESCENDING)])


# ---------------------------------------------------------------------- #
# Alerts + thresholds
# ---------------------------------------------------------------------- #
def get_thresholds() -> dict:
    doc = get_db()[ALERT_CONFIG].find_one({"_id": "thresholds"})
    return (doc or {}).get("values", Config.DEFAULT_THRESHOLDS)


def save_thresholds(values: dict) -> None:
    get_db()[ALERT_CONFIG].update_one(
        {"_id": "thresholds"}, {"$set": {"values": values}}, upsert=True
    )


def insert_alerts(alerts: list[dict]) -> int:
    if not alerts:
        return 0
    res = get_db()[ALERTS].insert_many(alerts, ordered=False)
    return len(res.inserted_ids)


def recent_alerts(limit: int = 50, severity: str | None = None) -> list[dict]:
    query = {"severity": severity} if severity else {}
    cursor = (get_db()[ALERTS]
              .find(query, {"_id": 0})
              .sort("ts", DESCENDING)
              .limit(limit))
    return list(cursor)


def last_alert_ts(metric: str, severity: str) -> float | None:
    doc = get_db()[ALERTS].find_one(
        {"metric": metric, "severity": severity},
        {"_id": 0, "ts": 1},
        sort=[("ts", DESCENDING)],
    )
    return doc["ts"] if doc else None


# ---------------------------------------------------------------------- #
# ML result snapshots
# ---------------------------------------------------------------------- #
def save_ml_result(kind: str, payload: dict) -> None:
    doc = {"kind": kind, **payload}
    get_db()[ML_RESULTS].insert_one(doc)
