"""Module 2: Data Collection & Preprocessing.

A background worker that samples Prometheus on a fixed interval, cleans the
readings, stores them in MongoDB and runs them past the threshold rules.

On first start it BACKFILLS real history from Prometheus range queries, so
the ML models have genuine data to work with immediately instead of waiting
minutes for samples to accumulate. Nothing here is simulated.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

from alerts import threshold
from config import Config
from services import mongo
from services.prom import PrometheusError, prom

log = logging.getLogger(__name__)

PERCENT_METRICS = ("cpu", "memory", "disk")

_thread: threading.Thread | None = None
_stop = threading.Event()

status: dict[str, Any] = {
    "running": False,
    "interval_seconds": Config.COLLECT_INTERVAL,
    "samples_collected": 0,
    "alerts_raised": 0,
    "last_collection_ts": None,
    "last_error": None,
    "backfilled_samples": 0,
}


# ---------------------------------------------------------------------- #
# Preprocessing
# ---------------------------------------------------------------------- #
def preprocess(raw: dict[str, float | None], ts: float | None = None) -> dict:
    """Clean one raw reading into a storable sample.

    - percentages are clamped to 0-100 (rate() can overshoot slightly)
    - negative throughput (counter reset) is floored at 0
    - values are rounded to keep documents small
    """
    sample: dict[str, Any] = {"ts": float(ts if ts is not None else time.time())}

    for key in PERCENT_METRICS:
        val = raw.get(key)
        if val is None:
            sample[key] = None
            continue
        sample[key] = round(min(max(float(val), 0.0), 100.0), 2)

    for key in ("net_rx", "net_tx"):
        val = raw.get(key)
        sample[key] = None if val is None else round(max(float(val), 0.0), 2)

    return sample


def _is_usable(sample: dict) -> bool:
    """Reject samples where the core metrics are all missing."""
    return any(sample.get(k) is not None for k in PERCENT_METRICS)


# ---------------------------------------------------------------------- #
# Backfill
# ---------------------------------------------------------------------- #
def backfill(minutes: int | None = None, step: str = "30s") -> int:
    """Pull real historical metrics from Prometheus into MongoDB."""
    minutes = minutes or Config.BACKFILL_MINUTES
    merged: dict[int, dict[str, float]] = {}

    for key, query in prom.queries.items():
        try:
            points = prom.range(query, minutes=minutes, step=step)
        except PrometheusError as exc:
            log.warning("backfill of %s failed: %s", key, exc)
            continue
        for ts, value in points:
            merged.setdefault(int(ts), {})[key] = value

    if not merged:
        log.warning("backfill produced no data - is windows_exporter running?")
        return 0

    existing = {
        int(doc["ts"])
        for doc in mongo.samples_since(min(merged.keys()))
    }

    samples = [
        preprocess(values, ts=ts)
        for ts, values in sorted(merged.items())
        if ts not in existing
    ]
    samples = [s for s in samples if _is_usable(s)]

    inserted = mongo.insert_samples(samples)
    log.info("backfilled %s real samples from the last %s minutes", inserted, minutes)
    return inserted


# ---------------------------------------------------------------------- #
# Collection loop
# ---------------------------------------------------------------------- #
def collect_once() -> dict | None:
    """Take one reading, store it, evaluate thresholds."""
    raw = prom.snapshot()
    sample = preprocess(raw)

    if not _is_usable(sample):
        status["last_error"] = (
            "Prometheus returned no usable metrics - check that "
            "windows_exporter is running on port 9182"
        )
        return None

    mongo.insert_samples([sample])
    status["samples_collected"] += 1
    status["last_collection_ts"] = sample["ts"]
    status["last_error"] = None

    raised = threshold.check_and_store(sample)
    status["alerts_raised"] += len(raised)
    return sample


def _loop() -> None:
    status["running"] = True
    log.info("collector started (every %ss)", Config.COLLECT_INTERVAL)

    # One-time backfill so K-Means / Linear Regression are usable at once.
    try:
        if mongo.sample_count() < Config.KMEANS_MIN_SAMPLES:
            status["backfilled_samples"] = backfill()
    except Exception as exc:  # noqa: BLE001 - never kill the worker
        log.warning("backfill skipped: %s", exc)

    while not _stop.is_set():
        started = time.time()
        try:
            collect_once()
        except PrometheusError as exc:
            status["last_error"] = str(exc)
            log.warning("collection failed: %s", exc)
        except Exception as exc:  # noqa: BLE001
            status["last_error"] = f"{type(exc).__name__}: {exc}"
            log.exception("unexpected collector error")

        elapsed = time.time() - started
        _stop.wait(max(0.5, Config.COLLECT_INTERVAL - elapsed))

    status["running"] = False
    log.info("collector stopped")


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="cloudpulse-collector", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
