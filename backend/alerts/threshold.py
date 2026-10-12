"""Module 4: Alert & Notification Management.

Threshold-based alerting ONLY. The spec is explicit that these alerts must
stay separate from the ML predictions, so this module deliberately imports
nothing from `ml/` - an alert is raised purely because a measured value
crossed a configured limit, never because a model forecast something.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from config import Config
from services import mongo

log = logging.getLogger(__name__)

MONITORED = ("cpu", "memory", "disk")
UNITS = {"cpu": "%", "memory": "%", "disk": "%"}
LABELS = {"cpu": "CPU", "memory": "Memory", "disk": "Disk"}


def evaluate(sample: dict, thresholds: dict | None = None) -> list[dict]:
    """Return the alerts a single sample triggers. Pure function, no I/O."""
    thresholds = thresholds or mongo.get_thresholds()
    ts = sample.get("ts", time.time())
    raised: list[dict] = []

    for metric in MONITORED:
        value = sample.get(metric)
        if value is None:
            continue

        limits = thresholds.get(metric) or {}
        critical = limits.get("critical")
        warning = limits.get("warning")

        severity: str | None = None
        breached: float | None = None
        if critical is not None and value >= critical:
            severity, breached = "critical", critical
        elif warning is not None and value >= warning:
            severity, breached = "warning", warning

        if severity is None:
            continue

        raised.append({
            "ts": ts,
            "metric": metric,
            "severity": severity,
            "value": round(float(value), 2),
            "threshold": float(breached),
            "unit": UNITS[metric],
            "source": "threshold",
            "message": (
                f"{LABELS[metric]} usage {value:.1f}{UNITS[metric]} exceeded the "
                f"{severity} threshold of {breached:.0f}{UNITS[metric]}"
            ),
        })

    return raised


def _in_cooldown(metric: str, severity: str, now: float) -> bool:
    """Suppress repeat alerts so a sustained spike does not flood the feed."""
    last = mongo.last_alert_ts(metric, severity)
    return last is not None and (now - last) < Config.ALERT_COOLDOWN_SECONDS


def check_and_store(sample: dict) -> list[dict]:
    """Evaluate a sample, apply cooldown, persist surviving alerts."""
    candidates = evaluate(sample)
    if not candidates:
        return []

    now = sample.get("ts", time.time())
    fresh = [a for a in candidates if not _in_cooldown(a["metric"], a["severity"], now)]
    if fresh:
        mongo.insert_alerts(fresh)
        for alert in fresh:
            log.info("ALERT [%s] %s", alert["severity"].upper(), alert["message"])
    return fresh


def validate_thresholds(payload: dict) -> tuple[dict | None, str | None]:
    """Validate a threshold-config update. Returns (clean_values, error)."""
    if not isinstance(payload, dict):
        return None, "Body must be a JSON object"

    clean: dict[str, dict[str, float]] = {}
    current = mongo.get_thresholds()

    for metric, limits in payload.items():
        if metric not in MONITORED:
            return None, f"Unknown metric '{metric}'. Allowed: {list(MONITORED)}"
        if not isinstance(limits, dict):
            return None, f"'{metric}' must be an object with warning/critical"

        merged = dict(current.get(metric, {}))
        for level in ("warning", "critical"):
            if level not in limits:
                continue
            try:
                val = float(limits[level])
            except (TypeError, ValueError):
                return None, f"{metric}.{level} must be a number"
            if not 0 < val <= 100:
                return None, f"{metric}.{level} must be between 0 and 100"
            merged[level] = val

        if merged.get("warning") is not None and merged.get("critical") is not None:
            if merged["warning"] >= merged["critical"]:
                return None, f"{metric}: warning must be lower than critical"

        clean[metric] = merged

    if not clean:
        return None, "No valid metrics supplied"

    return {**current, **clean}, None
