"""Local file-backed store, used when MongoDB is unreachable.

Implements exactly the function surface of services.mongo, so the collector,
ML models, alerting and routes work unchanged against either backend.

Documents are kept as JSON blobs with the ordering/filtering fields promoted
to real columns. That preserves MongoDB's schemaless behaviour - a sample or
alert dict round-trips with whatever keys it had - while still allowing the
indexed `ts`, `metric` and `severity` lookups the alert cooldown relies on.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

from config import Config

log = logging.getLogger(__name__)

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def db_path() -> Path:
    return Path(getattr(Config, "SQLITE_PATH", "")
                or Path(__file__).resolve().parents[1] / "cloudpulse.db")


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        path = db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        # The collector writes from its own thread while Flask reads from the
        # request threads; a module-level lock serialises them.
        _conn = sqlite3.connect(str(path), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


def init() -> None:
    """Create tables and seed default thresholds. Idempotent."""
    with _lock:
        c = _connect()
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS metrics_history (
                ts   REAL NOT NULL,
                doc  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_metrics_ts ON metrics_history(ts DESC);

            CREATE TABLE IF NOT EXISTS alerts (
                ts       REAL NOT NULL,
                metric   TEXT,
                severity TEXT,
                doc      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_alerts_ts ON alerts(ts DESC);
            CREATE INDEX IF NOT EXISTS ix_alerts_lookup
                ON alerts(metric, severity, ts DESC);

            CREATE TABLE IF NOT EXISTS alert_config (
                key  TEXT PRIMARY KEY,
                doc  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ml_results (
                kind TEXT NOT NULL,
                ts   REAL NOT NULL,
                doc  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_ml_kind_ts ON ml_results(kind, ts DESC);
            """
        )
        row = c.execute("SELECT 1 FROM alert_config WHERE key='thresholds'").fetchone()
        if row is None:
            c.execute(
                "INSERT INTO alert_config(key, doc) VALUES ('thresholds', ?)",
                (json.dumps(Config.DEFAULT_THRESHOLDS),),
            )
            log.info("seeded default alert thresholds")
        c.commit()
    log.info("sqlite store ready at %s", db_path())


def ping() -> dict[str, Any]:
    """Diagnostics for /api/health, shaped like mongo.ping()."""
    info: dict[str, Any] = {
        "backend": "sqlite",
        "uri": f"sqlite:///{db_path()}",
        "connected": False,
    }
    try:
        with _lock:
            c = _connect()
            info["database"] = db_path().name
            info["samples_stored"] = c.execute(
                "SELECT COUNT(*) FROM metrics_history").fetchone()[0]
            info["alerts_stored"] = c.execute(
                "SELECT COUNT(*) FROM alerts").fetchone()[0]
            info["connected"] = True
    except sqlite3.Error as exc:
        info["error"] = str(exc)
    return info


# ---------------------------------------------------------------------- #
# Metrics history
# ---------------------------------------------------------------------- #
def insert_samples(samples: list[dict]) -> int:
    if not samples:
        return 0
    with _lock:
        c = _connect()
        c.executemany(
            "INSERT INTO metrics_history(ts, doc) VALUES (?, ?)",
            [(float(s.get("ts", 0.0)), json.dumps(s)) for s in samples],
        )
        c.commit()
    return len(samples)


def recent_samples(limit: int, projection: dict | None = None) -> list[dict]:
    """Most recent N samples, returned oldest-first (chronological)."""
    with _lock:
        rows = _connect().execute(
            "SELECT doc FROM metrics_history ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
    return [json.loads(r["doc"]) for r in rows][::-1]


def samples_since(ts_epoch: float) -> list[dict]:
    with _lock:
        rows = _connect().execute(
            "SELECT doc FROM metrics_history WHERE ts >= ? ORDER BY ts ASC",
            (float(ts_epoch),),
        ).fetchall()
    return [json.loads(r["doc"]) for r in rows]


def sample_count() -> int:
    with _lock:
        return _connect().execute("SELECT COUNT(*) FROM metrics_history").fetchone()[0]


def latest_sample() -> dict | None:
    with _lock:
        row = _connect().execute(
            "SELECT doc FROM metrics_history ORDER BY ts DESC LIMIT 1"
        ).fetchone()
    return json.loads(row["doc"]) if row else None


# ---------------------------------------------------------------------- #
# Alerts + thresholds
# ---------------------------------------------------------------------- #
def get_thresholds() -> dict:
    with _lock:
        row = _connect().execute(
            "SELECT doc FROM alert_config WHERE key='thresholds'"
        ).fetchone()
    return json.loads(row["doc"]) if row else Config.DEFAULT_THRESHOLDS


def save_thresholds(values: dict) -> None:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT INTO alert_config(key, doc) VALUES ('thresholds', ?) "
            "ON CONFLICT(key) DO UPDATE SET doc=excluded.doc",
            (json.dumps(values),),
        )
        c.commit()


def insert_alerts(alerts: list[dict]) -> int:
    if not alerts:
        return 0
    with _lock:
        c = _connect()
        c.executemany(
            "INSERT INTO alerts(ts, metric, severity, doc) VALUES (?, ?, ?, ?)",
            [
                (float(a.get("ts", 0.0)), a.get("metric"), a.get("severity"), json.dumps(a))
                for a in alerts
            ],
        )
        c.commit()
    return len(alerts)


def recent_alerts(limit: int = 50, severity: str | None = None) -> list[dict]:
    sql = "SELECT doc FROM alerts"
    params: list[Any] = []
    if severity:
        sql += " WHERE severity = ?"
        params.append(severity)
    sql += " ORDER BY ts DESC LIMIT ?"
    params.append(limit)
    with _lock:
        rows = _connect().execute(sql, params).fetchall()
    return [json.loads(r["doc"]) for r in rows]


def last_alert_ts(metric: str, severity: str) -> float | None:
    with _lock:
        row = _connect().execute(
            "SELECT ts FROM alerts WHERE metric = ? AND severity = ? "
            "ORDER BY ts DESC LIMIT 1",
            (metric, severity),
        ).fetchone()
    return float(row["ts"]) if row else None


# ---------------------------------------------------------------------- #
# ML result snapshots
# ---------------------------------------------------------------------- #
def save_ml_result(kind: str, payload: dict) -> None:
    with _lock:
        c = _connect()
        c.execute(
            "INSERT INTO ml_results(kind, ts, doc) VALUES (?, ?, ?)",
            (kind, float(payload.get("ts", 0.0)), json.dumps({"kind": kind, **payload})),
        )
        c.commit()
