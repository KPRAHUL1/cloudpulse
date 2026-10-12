"""Module 3 - K-Means clustering and Linear Regression.

Covers TESTING.md tests 6 and 7. Both models read through `mongo.recent_samples`
and write through `mongo.save_ml_result`; both are monkeypatched so the real
algorithms run against fixture data with no database involved.
"""
import pytest

from config import Config
from ml import kmeans_model, regression_model


@pytest.fixture
def stub_store(monkeypatch):
    """Feed fixture samples to both models and capture what they persist."""

    saved = {}

    def install(samples):
        for module in (kmeans_model, regression_model):
            monkeypatch.setattr(module.mongo, "recent_samples", lambda *_a, **_k: samples)
            monkeypatch.setattr(
                module.mongo,
                "save_ml_result",
                lambda kind, payload: saved.__setitem__(kind, payload),
            )
        return saved

    return install


def _sample(ts, cpu, memory, disk, net=0.0):
    return {"ts": float(ts), "cpu": cpu, "memory": memory, "disk": disk,
            "net_rx": net, "net_tx": net}


# --- K-Means --------------------------------------------------------------


def _three_regimes():
    """15 idle + 15 moderate + 15 heavy samples - three separable groups."""
    out = []
    ts = 1_000.0
    for cpu, mem, disk in [(6, 30, 40), (48, 58, 62), (93, 88, 91)]:
        for i in range(15):
            jitter = (i % 5) * 0.4
            out.append(_sample(ts, cpu + jitter, mem + jitter, disk + jitter))
            ts += 10
    return out


def test_kmeans_labels_are_ordered_low_medium_high(stub_store):
    """The spec's core claim: labels must track real load, not cluster index."""
    stub_store(_three_regimes())

    result = kmeans_model.run()

    assert result["status"] == "ok"
    assert result["k"] == 3

    by_level = {c["usage_level"]: c["centroid"] for c in result["clusters"]}
    assert set(by_level) == {"Low", "Medium", "High"}

    load = lambda c: (c["cpu"] + c["memory"] + c["disk"]) / 3
    assert load(by_level["Low"]) < load(by_level["Medium"]) < load(by_level["High"])


def test_kmeans_centroids_are_in_real_units(stub_store):
    """Centroids are inverse-transformed, so they must read as percentages."""
    stub_store(_three_regimes())

    clusters = kmeans_model.run()["clusters"]

    high = next(c for c in clusters if c["usage_level"] == "High")
    assert 85 <= high["centroid"]["cpu"] <= 100
    low = next(c for c in clusters if c["usage_level"] == "Low")
    assert 0 <= low["centroid"]["cpu"] <= 15


def test_kmeans_classifies_the_latest_sample(stub_store):
    stub_store(_three_regimes())
    result = kmeans_model.run()
    # The fixture ends in the heavy regime.
    assert result["current"]["usage_level"] == "High"


def test_kmeans_reports_insufficient_data_rather_than_guessing(stub_store):
    stub_store([_sample(1000 + i * 10, 20, 30, 40) for i in range(5)])

    result = kmeans_model.run()

    assert result["status"] == "insufficient_data"
    assert result["samples_required"] == Config.KMEANS_MIN_SAMPLES
    assert "clusters" not in result


def test_kmeans_is_deterministic(stub_store):
    """Fixed random_state - the dashboard must not reshuffle on every poll."""
    stub_store(_three_regimes())
    first = kmeans_model.run()["clusters"]
    second = kmeans_model.run()["clusters"]
    assert [c["usage_level"] for c in first] == [c["usage_level"] for c in second]
    assert [c["count"] for c in first] == [c["count"] for c in second]


# --- Linear Regression ----------------------------------------------------


def _ramp(start, per_sample, n=40):
    return [_sample(1_000 + i * 60, start + i * per_sample, 50, 50) for i in range(n)]


def test_regression_detects_a_rising_trend(stub_store):
    stub_store(_ramp(20.0, 0.5))

    result = regression_model.run("cpu", horizon_minutes=30)

    assert result["status"] == "ok"
    assert result["trend"] == "rising"
    assert result["slope_per_hour"] > 1.0
    assert result["r2_score"] == pytest.approx(1.0, abs=1e-6)


def test_regression_detects_a_flat_trend(stub_store):
    stub_store([_sample(1_000 + i * 60, 42.0, 50, 50) for i in range(40)])
    assert regression_model.run("cpu")["trend"] == "stable"


def test_prediction_is_clamped_to_100(stub_store):
    """A steep ramp extrapolates past 100% - utilisation cannot exceed it."""
    stub_store(_ramp(60.0, 3.0))

    result = regression_model.run("cpu", horizon_minutes=120)

    assert result["predicted_at_horizon"] <= 100.0
    assert all(p["predicted"] <= 100.0 for p in result["predictions"])


def test_prediction_is_clamped_to_0(stub_store):
    """...and a steep decline cannot go negative."""
    stub_store(_ramp(40.0, -3.0))

    result = regression_model.run("cpu", horizon_minutes=120)

    assert result["predicted_at_horizon"] >= 0.0
    assert all(p["predicted"] >= 0.0 for p in result["predictions"])
    assert result["trend"] == "falling"


def test_forecast_steps_run_out_to_the_horizon(stub_store):
    stub_store(_ramp(30.0, 0.2))

    result = regression_model.run("cpu", horizon_minutes=30)

    assert [p["minutes_ahead"] for p in result["predictions"]] == [5, 10, 15, 20, 25, 30]


def test_regression_rejects_an_unsupported_metric(stub_store):
    stub_store(_ramp(30.0, 0.2))
    result = regression_model.run("gpu")
    assert result["status"] == "error"
    assert "gpu" in result["message"]


def test_regression_reports_insufficient_data(stub_store):
    stub_store(_ramp(30.0, 0.2, n=3))
    result = regression_model.run("cpu")
    assert result["status"] == "insufficient_data"
    assert "predictions" not in result
