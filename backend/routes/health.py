"""Health + diagnostics. Proves the whole data path is live and real."""
from flask import Blueprint, jsonify

from services import collector, mongo
from services.prom import prom

bp = Blueprint("health", __name__, url_prefix="/api")


@bp.get("/health")
def health():
    prom_info = prom.health()
    mongo_info = mongo.ping()

    exporter_up = bool(prom_info.get("exporter_up"))
    healthy = prom_info.get("reachable") and exporter_up and mongo_info.get("connected")

    return jsonify({
        "status": "healthy" if healthy else "degraded",
        # Explicitly tells the dashboard whether it is showing real metrics.
        "data_source": "real-time" if exporter_up else "unavailable",
        "prometheus": prom_info,
        "mongodb": mongo_info,
        "collector": collector.status,
        "monitored_host_uptime_seconds": prom.uptime_seconds(),
    })
