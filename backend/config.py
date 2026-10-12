"""CloudPulse backend configuration (environment driven)."""
import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


class Config:
    # --- Infrastructure ---------------------------------------------------
    PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://localhost:9090")
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB = os.getenv("MONGO_DB", "cloudpulse")

    # --- API --------------------------------------------------------------
    API_HOST = os.getenv("API_HOST", "0.0.0.0")
    API_PORT = _int("API_PORT", 5000)

    # --- Prometheus target ------------------------------------------------
    PROM_JOB = os.getenv("PROM_JOB", "windows")
    DISK_VOLUME = os.getenv("DISK_VOLUME", "C:")

    # --- Module 2: collection --------------------------------------------
    COLLECT_INTERVAL = _int("COLLECT_INTERVAL_SECONDS", 10)
    BACKFILL_MINUTES = _int("BACKFILL_MINUTES", 120)
    HISTORY_RETENTION_DAYS = _int("HISTORY_RETENTION_DAYS", 7)

    # --- Module 3: machine learning --------------------------------------
    KMEANS_K = 3                 # spec: Low / Medium / High
    KMEANS_MIN_SAMPLES = 30      # below this, clustering is not meaningful
    KMEANS_WINDOW = 500          # most recent N samples fed to K-Means
    REGRESSION_MIN_SAMPLES = 20
    REGRESSION_WINDOW = 360      # most recent N samples fed to Linear Regression
    RANDOM_STATE = 42

    # --- Module 4: threshold alerts (NOT ML - kept deliberately separate) --
    DEFAULT_THRESHOLDS = {
        "cpu": {"warning": 70.0, "critical": 85.0},
        "memory": {"warning": 75.0, "critical": 90.0},
        "disk": {"warning": 80.0, "critical": 90.0},
    }
    # Suppress repeat alerts for the same metric+severity within this window
    ALERT_COOLDOWN_SECONDS = _int("ALERT_COOLDOWN_SECONDS", 300)
