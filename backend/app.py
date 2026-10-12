"""CloudPulse backend entry point.

Wires together all five modules and serves the REST API consumed by the
React Native dashboard.

    Module 1  Real-Time Resource Monitoring    services/prom.py
    Module 2  Data Collection & Preprocessing  services/collector.py
    Module 3  ML Analysis & Prediction         ml/kmeans_model.py,
                                               ml/regression_model.py
    Module 4  Alert & Notification Management  alerts/threshold.py
    Module 5  Dashboard & Visualization        ../mobile (React Native)
"""
from __future__ import annotations

import logging

from flask import Flask, jsonify
from flask_cors import CORS

from config import Config
from routes.alerts import bp as alerts_bp
from routes.health import bp as health_bp
from routes.metrics import bp as metrics_bp
from routes.ml import bp as ml_bp
from services import collector, mongo

log = logging.getLogger("cloudpulse")


def create_app() -> Flask:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    app = Flask(__name__)
    # The React Native app runs on a different origin (phone / emulator).
    CORS(app)

    # Prepare MongoDB. If it is down we still start, so that /api/health can
    # report exactly what is wrong instead of the process dying silently.
    try:
        mongo.init()
        log.info("MongoDB ready at %s", Config.MONGO_URI)
    except Exception as exc:  # noqa: BLE001
        log.warning("MongoDB unavailable at %s: %s", Config.MONGO_URI, exc)

    for blueprint in (health_bp, metrics_bp, ml_bp, alerts_bp):
        app.register_blueprint(blueprint)

    @app.get("/")
    def index():
        return jsonify({
            "name": "CloudPulse API",
            "description": "Real-Time Cloud Resource & Health Monitoring System",
            "data_source": "Prometheus + windows_exporter (real host metrics)",
            "endpoints": {
                "health": "/api/health",
                "current_metrics": "/api/metrics/current",
                "history": "/api/metrics/history?minutes=60",
                "summary": "/api/metrics/summary?minutes=60",
                "kmeans_clusters": "/api/ml/clusters",
                "regression_predict": "/api/ml/predict?metric=cpu&horizon=30",
                "combined_analysis": "/api/ml/analysis",
                "alerts": "/api/alerts?limit=50",
                "alert_summary": "/api/alerts/summary",
                "alert_config": "/api/alerts/config",
            },
        })

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"status": "error", "message": "Endpoint not found"}), 404

    @app.errorhandler(500)
    def server_error(exc):
        log.exception("unhandled error")
        return jsonify({"status": "error", "message": str(exc)}), 500

    # Module 2 starts sampling Prometheus in the background.
    collector.start()

    return app


app = create_app()


if __name__ == "__main__":
    log.info("CloudPulse API listening on %s:%s", Config.API_HOST, Config.API_PORT)
    # debug=False keeps the reloader from starting a second collector thread.
    app.run(host=Config.API_HOST, port=Config.API_PORT, debug=False, threaded=True)
