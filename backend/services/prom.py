"""Module 1: Real-Time Resource Monitoring.

Thin PromQL layer over the Prometheus HTTP API. Every value CloudPulse
displays originates here - these are real counters scraped from
windows_exporter on the host, not generated numbers.

Metric names differ between windows_exporter releases, so the memory and
uptime queries use PromQL's `or` operator to fall back to the older metric
names. This keeps the project working across exporter versions.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import requests

from config import Config

log = logging.getLogger(__name__)

# Metrics CloudPulse tracks. Order matters for the ML feature vector.
METRIC_KEYS = ["cpu", "memory", "disk", "net_rx", "net_tx"]


class PrometheusError(RuntimeError):
    """Raised when Prometheus is unreachable or rejects a query."""


class PrometheusClient:
    def __init__(self, base_url: str | None = None, job: str | None = None,
                 volume: str | None = None) -> None:
        self.base_url = (base_url or Config.PROMETHEUS_URL).rstrip("/")
        self.job = job or Config.PROM_JOB
        self.volume = volume or Config.DISK_VOLUME

    # ------------------------------------------------------------------ #
    # Query definitions
    # ------------------------------------------------------------------ #
    @property
    def queries(self) -> dict[str, str]:
        j = f'job="{self.job}"'
        vol = self.volume
        return {
            # Percentage of CPU time NOT spent idle, averaged across cores.
            "cpu": (
                f'100 - (avg without(cpu) '
                f'(rate(windows_cpu_time_total{{{j},mode="idle"}}[2m])) * 100)'
            ),
            # Used memory as a percentage of total physical memory.
            # First form = newer exporters, second form = older exporters.
            "memory": (
                f'(100 - (windows_memory_available_bytes{{{j}}} '
                f'/ windows_memory_physical_total_bytes{{{j}}} * 100))'
                f' or '
                f'(100 - (windows_os_physical_memory_free_bytes{{{j}}} '
                f'/ windows_cs_physical_memory_bytes{{{j}}} * 100))'
            ),
            # Used space on the monitored volume, as a percentage.
            "disk": (
                f'100 - (windows_logical_disk_free_bytes{{{j},volume="{vol}"}} '
                f'/ windows_logical_disk_size_bytes{{{j},volume="{vol}"}} * 100)'
            ),
            # Network throughput in bytes/second, summed across interfaces.
            "net_rx": f'sum(rate(windows_net_bytes_received_total{{{j}}}[2m]))',
            "net_tx": f'sum(rate(windows_net_bytes_sent_total{{{j}}}[2m]))',
        }

    @property
    def _uptime_query(self) -> str:
        j = f'job="{self.job}"'
        return (
            f'time() - (windows_system_boot_time_timestamp_seconds{{{j}}} '
            f'or windows_system_system_up_time{{{j}}})'
        )

    # ------------------------------------------------------------------ #
    # HTTP plumbing
    # ------------------------------------------------------------------ #
    def _get(self, path: str, params: dict[str, Any], timeout: int = 10) -> dict:
        url = f"{self.base_url}{path}"
        try:
            resp = requests.get(url, params=params, timeout=timeout)
        except requests.RequestException as exc:
            raise PrometheusError(
                f"Cannot reach Prometheus at {self.base_url}. "
                f"Is the container running? ({exc})"
            ) from exc

        if resp.status_code != 200:
            raise PrometheusError(
                f"Prometheus returned HTTP {resp.status_code}: {resp.text[:200]}"
            )

        payload = resp.json()
        if payload.get("status") != "success":
            raise PrometheusError(f"Query rejected: {payload.get('error')}")
        return payload["data"]

    @staticmethod
    def _first_value(data: dict) -> float | None:
        """Extract the single scalar from an instant-query response."""
        result = data.get("result") or []
        if not result:
            return None
        try:
            return float(result[0]["value"][1])
        except (KeyError, IndexError, TypeError, ValueError):
            return None

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def instant(self, query: str) -> float | None:
        """Run an instant query and return a single float (or None)."""
        data = self._get("/api/v1/query", {"query": query})
        value = self._first_value(data)
        # Prometheus can return NaN as the string 'NaN'
        if value is not None and value != value:  # NaN check
            return None
        return value

    def range(self, query: str, minutes: int, step: str = "30s") -> list[tuple[float, float]]:
        """Run a range query. Returns [(unix_ts, value), ...] sorted by time."""
        end = time.time()
        start = end - minutes * 60
        data = self._get(
            "/api/v1/query_range",
            {"query": query, "start": start, "end": end, "step": step},
            timeout=30,
        )
        result = data.get("result") or []
        if not result:
            return []
        points: list[tuple[float, float]] = []
        for ts, raw in result[0].get("values", []):
            try:
                val = float(raw)
            except (TypeError, ValueError):
                continue
            if val != val:  # skip NaN
                continue
            points.append((float(ts), val))
        return points

    def snapshot(self) -> dict[str, float | None]:
        """One reading of every tracked metric. Used by the collector."""
        out: dict[str, float | None] = {}
        for key, query in self.queries.items():
            try:
                out[key] = self.instant(query)
            except PrometheusError as exc:
                log.warning("metric %s failed: %s", key, exc)
                out[key] = None
        return out

    def uptime_seconds(self) -> float | None:
        try:
            return self.instant(self._uptime_query)
        except PrometheusError:
            return None

    def target_up(self) -> bool:
        """True when Prometheus is successfully scraping windows_exporter."""
        try:
            return (self.instant(f'up{{job="{self.job}"}}') or 0) >= 1
        except PrometheusError:
            return False

    def health(self) -> dict[str, Any]:
        """Diagnostics for /api/health - proves the data path is real."""
        info: dict[str, Any] = {
            "prometheus_url": self.base_url,
            "reachable": False,
            "exporter_up": False,
            "available_metrics": {},
        }
        try:
            self._get("/api/v1/query", {"query": "1"})
            info["reachable"] = True
        except PrometheusError as exc:
            info["error"] = str(exc)
            return info

        info["exporter_up"] = self.target_up()
        for key, query in self.queries.items():
            try:
                info["available_metrics"][key] = self.instant(query) is not None
            except PrometheusError:
                info["available_metrics"][key] = False
        return info


# Shared instance
prom = PrometheusClient()
