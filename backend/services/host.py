"""Module 1 (direct) - reads real resource counters straight off the host.

The primary path for Module 1 is windows_exporter -> Prometheus. That needs a
Windows service installed with Administrator rights and a Prometheus container,
which is not always available. This module is a drop-in alternative that reads
the *same real counters* from the operating system through psutil.

It is NOT a simulator. Every number here comes from the live host, same as the
exporter path - what is lost is Prometheus' stored history (so there is nothing
to backfill) and its multi-host capability, not the authenticity of the data.

Interface-compatible with services.prom.PrometheusClient so the collector and
routes do not care which one they were handed.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

import psutil

from config import Config

log = logging.getLogger(__name__)

# Mirrors prom.METRIC_KEYS - order matters for the ML feature vector.
METRIC_KEYS = ["cpu", "memory", "disk", "net_rx", "net_tx"]

# Seconds of aggregate CPU time that must elapse before a new percentage is
# computed. Below this the sample window is too short to be meaningful.
MIN_CPU_WINDOW = 0.3


class HostClient:
    """Live host metrics via psutil."""

    source_name = "psutil"

    def __init__(self, volume: str | None = None) -> None:
        self.volume = self._normalise_volume(volume or Config.DISK_VOLUME)
        self._last_net: tuple[float, float, float] | None = None
        self._last_cpu: tuple[float, float] | None = None
        self._last_cpu_pct: float = 0.0
        self._prime_cpu()
        self._prime_net()

    @staticmethod
    def _normalise_volume(volume: str) -> str:
        """Turn the configured volume into a path psutil.disk_usage accepts.

        Config holds a Windows volume like 'C:' by default, but the same code
        runs on Linux when deployed, where that is meaningless - fall back to
        the root filesystem there.
        """
        v = (volume or "").strip().strip('"')
        if os.name != "nt":
            # 'C:' or 'C:' carries no meaning on Linux; use the mount root.
            if not v or (len(v) <= 3 and ":" in v):
                return "/"
            return v
        if not v:
            return "C:\\"
        if len(v) == 2 and v.endswith(":"):
            return v + "\\"
        return v

    def _prime_cpu(self) -> None:
        times = psutil.cpu_times()
        total = sum(times)
        self._last_cpu = (total, total - times.idle)

    def _cpu_percent(self) -> float:
        """Busy fraction of CPU time since the previous reading.

        psutil.cpu_percent(interval=None) measures from its own last call, which
        is process-global: an HTTP request landing just after a collector tick
        gets a near-zero window and reports 0%. Tracking cumulative cpu_times
        here keeps each caller's reading independent, and readings closer
        together than MIN_CPU_WINDOW reuse the last result rather than
        reporting a meaningless 0.
        """
        times = psutil.cpu_times()
        total = sum(times)
        busy = total - times.idle

        if self._last_cpu is None:
            self._last_cpu = (total, busy)
            return self._last_cpu_pct

        prev_total, prev_busy = self._last_cpu
        d_total = total - prev_total
        d_busy = busy - prev_busy

        if d_total < MIN_CPU_WINDOW:
            return self._last_cpu_pct

        self._last_cpu = (total, busy)
        self._last_cpu_pct = round(max(0.0, min(100.0, d_busy / d_total * 100.0)), 1)
        return self._last_cpu_pct

    def _prime_net(self) -> None:
        counters = psutil.net_io_counters()
        self._last_net = (time.time(), float(counters.bytes_recv), float(counters.bytes_sent))

    # ------------------------------------------------------------------ #
    # Interface parity with PrometheusClient
    # ------------------------------------------------------------------ #
    @property
    def queries(self) -> dict[str, str]:
        """No PromQL here - these are descriptive labels for /api/health."""
        return {
            "cpu": "psutil.cpu_percent",
            "memory": "psutil.virtual_memory().percent",
            "disk": f"psutil.disk_usage({self.volume!r}).percent",
            "net_rx": "psutil.net_io_counters().bytes_recv (rate)",
            "net_tx": "psutil.net_io_counters().bytes_sent (rate)",
        }

    def _net_rates(self) -> tuple[float | None, float | None]:
        """Bytes/sec since the previous reading."""
        counters = psutil.net_io_counters()
        now = time.time()
        rx, tx = float(counters.bytes_recv), float(counters.bytes_sent)

        if self._last_net is None:
            self._last_net = (now, rx, tx)
            return None, None

        prev_t, prev_rx, prev_tx = self._last_net
        elapsed = now - prev_t
        self._last_net = (now, rx, tx)

        if elapsed <= 0:
            return None, None
        # Counters reset when an interface restarts; report nothing rather
        # than a negative rate.
        d_rx, d_tx = rx - prev_rx, tx - prev_tx
        if d_rx < 0 or d_tx < 0:
            return None, None
        return d_rx / elapsed, d_tx / elapsed

    def snapshot(self) -> dict[str, float | None]:
        """One reading of every tracked metric."""
        rx, tx = self._net_rates()
        try:
            disk = float(psutil.disk_usage(self.volume).percent)
        except OSError as exc:
            log.warning("disk usage unavailable for %s: %s", self.volume, exc)
            disk = None

        return {
            "cpu": self._cpu_percent(),
            "memory": float(psutil.virtual_memory().percent),
            "disk": disk,
            "net_rx": rx,
            "net_tx": tx,
        }

    def instant(self, query: str) -> float | None:
        key = next((k for k, v in self.queries.items() if v == query), query)
        return self.snapshot().get(key)

    def range(self, query: str, minutes: int, step: str = "30s") -> list[tuple[float, float]]:
        """No stored history exists on this path, so there is nothing to backfill.

        Returning [] is deliberate: inventing back-dated points would be
        simulated data, which this project does not do.
        """
        return []

    def uptime_seconds(self) -> float | None:
        try:
            return max(0.0, time.time() - psutil.boot_time())
        except OSError:
            return None

    def target_up(self) -> bool:
        """The host is always reachable from inside this process."""
        return True

    def health(self) -> dict[str, Any]:
        snap = self.snapshot()
        return {
            "source": self.source_name,
            "reachable": True,
            "exporter_up": True,
            "prometheus_url": None,
            "disk_volume": self.volume,
            "available_metrics": {k: snap.get(k) is not None for k in METRIC_KEYS},
            "note": "Reading the host directly via psutil; Prometheus history unavailable.",
        }
