"""Module 4 endpoints: threshold alerts and their configuration."""
from flask import Blueprint, jsonify, request

from alerts import threshold
from services import mongo

bp = Blueprint("alerts", __name__, url_prefix="/api/alerts")


@bp.get("")
@bp.get("/")
def list_alerts():
    limit = request.args.get("limit", default=50, type=int)
    limit = max(1, min(limit, 500))
    severity = request.args.get("severity")
    if severity and severity not in ("warning", "critical"):
        return jsonify({
            "status": "error",
            "message": "severity must be 'warning' or 'critical'",
        }), 400

    records = mongo.recent_alerts(limit=limit, severity=severity)
    return jsonify({
        "status": "ok",
        "count": len(records),
        "source": "threshold",
        "alerts": records,
    })


@bp.get("/summary")
def summary():
    records = mongo.recent_alerts(limit=500)
    counts = {"critical": 0, "warning": 0}
    for alert in records:
        sev = alert.get("severity")
        if sev in counts:
            counts[sev] += 1

    return jsonify({
        "status": "ok",
        "counts": counts,
        "total": len(records),
        "latest": records[0] if records else None,
    })


@bp.get("/config")
def get_config():
    return jsonify({
        "status": "ok",
        "thresholds": mongo.get_thresholds(),
        "monitored_metrics": list(threshold.MONITORED),
    })


@bp.put("/config")
def update_config():
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"status": "error", "message": "Expected a JSON body"}), 400

    clean, error = threshold.validate_thresholds(payload)
    if error:
        return jsonify({"status": "error", "message": error}), 400

    mongo.save_thresholds(clean)
    return jsonify({"status": "ok", "thresholds": clean})
