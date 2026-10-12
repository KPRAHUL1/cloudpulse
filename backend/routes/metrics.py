"""Module 1 + 2 endpoints: live metrics and stored history."""
import time

from flask import Blueprint, jsonify, request

from services import mongo
from services.prom import PrometheusError, prom
from services.collector import preprocess

bp = Blueprint("metrics", __name__, url_prefix="/api/metrics")

VALID_METRICS = ("cpu", "memory", "disk", "net_rx", "net_tx")


@bp.get("/current")
def current():
    """Live reading, queried straight from Prometheus for freshness."""
    try:
        sample = preprocess(prom.snapshot())
        source = "prometheus"
    except PrometheusError as exc:
        fallback = mongo.latest_sample()
        if not fallback:
            return jsonify({"status": "error", "message": str(exc)}), 503
        sample, source = fallback, "mongodb-cache"

    net_rx = sample.get("net_rx") or 0
    net_tx = sample.get("net_tx") or 0

    return jsonify({
        "status": "ok",
        "source": source,
        "ts": sample["ts"],
        "cpu": sample.get("cpu"),
        "memory": sample.get("memory"),
        "disk": sample.get("disk"),
        "network": {
            "rx_bytes_per_sec": net_rx,
            "tx_bytes_per_sec": net_tx,
            "total_mbps": round((net_rx + net_tx) * 8 / 1_000_000, 3),
        },
        "host_uptime_seconds": prom.uptime_seconds(),
        "exporter_up": prom.target_up(),
    })


@bp.get("/history")
def history():
    """Stored history for the charts screen."""
    minutes = request.args.get("minutes", default=60, type=int)
    minutes = max(1, min(minutes, 24 * 60))

    since = time.time() - minutes * 60
    samples = mongo.samples_since(since)

    return jsonify({
        "status": "ok",
        "minutes": minutes,
        "count": len(samples),
        "samples": samples,
    })


@bp.get("/summary")
def summary():
    """Min / max / average per metric over a window - for the stats cards."""
    minutes = request.args.get("minutes", default=60, type=int)
    minutes = max(1, min(minutes, 24 * 60))
    samples = mongo.samples_since(time.time() - minutes * 60)

    if not samples:
        return jsonify({"status": "no_data", "minutes": minutes, "metrics": {}})

    out = {}
    for metric in VALID_METRICS:
        values = [s[metric] for s in samples if s.get(metric) is not None]
        if not values:
            continue
        out[metric] = {
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "avg": round(sum(values) / len(values), 2),
            "samples": len(values),
        }

    return jsonify({
        "status": "ok",
        "minutes": minutes,
        "metrics": out,
    })
