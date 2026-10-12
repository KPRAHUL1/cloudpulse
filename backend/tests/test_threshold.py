"""Module 4 - threshold alerting and cooldown.

Covers TESTING.md tests 8 and 9. `evaluate()` is a pure function with
injectable thresholds, so most of this needs no database at all; the cooldown
path reaches into `mongo`, which is monkeypatched.
"""
import inspect

import pytest

from alerts import threshold
from config import Config

LIMITS = {
    "cpu": {"warning": 70.0, "critical": 85.0},
    "memory": {"warning": 75.0, "critical": 90.0},
    "disk": {"warning": 80.0, "critical": 95.0},
}


def test_below_warning_raises_nothing():
    assert threshold.evaluate({"ts": 0, "cpu": 12.0}, LIMITS) == []


def test_crossing_warning_raises_warning():
    (alert,) = threshold.evaluate({"ts": 0, "cpu": 72.5}, LIMITS)
    assert alert["severity"] == "warning"
    assert alert["metric"] == "cpu"
    assert alert["value"] == 72.5
    assert alert["threshold"] == 70.0


def test_crossing_critical_wins_over_warning():
    """A value above both limits must report once, at the higher severity."""
    alerts = threshold.evaluate({"ts": 0, "cpu": 99.0}, LIMITS)
    assert len(alerts) == 1
    assert alerts[0]["severity"] == "critical"
    assert alerts[0]["threshold"] == 85.0


def test_threshold_is_inclusive_at_the_limit():
    (alert,) = threshold.evaluate({"ts": 0, "cpu": 70.0}, LIMITS)
    assert alert["severity"] == "warning"


def test_missing_metric_is_skipped_not_defaulted():
    """A metric the exporter did not report must not be treated as zero."""
    assert threshold.evaluate({"ts": 0, "cpu": None, "memory": 10.0}, LIMITS) == []


def test_each_breaching_metric_raises_its_own_alert():
    alerts = threshold.evaluate({"ts": 0, "cpu": 90.0, "memory": 95.0, "disk": 10.0}, LIMITS)
    assert sorted(a["metric"] for a in alerts) == ["cpu", "memory"]


def test_alert_message_cites_the_measured_value():
    (alert,) = threshold.evaluate({"ts": 0, "cpu": 88.0}, LIMITS)
    assert "88.0%" in alert["message"]
    assert alert["source"] == "threshold"


# --- cooldown -------------------------------------------------------------


class _FakeMongo:
    """Stands in for services.mongo, recording what would be persisted."""

    def __init__(self, last_ts=None):
        self.last_ts = last_ts
        self.inserted = []

    def get_thresholds(self):
        return LIMITS

    def last_alert_ts(self, metric, severity):
        return self.last_ts

    def insert_alerts(self, alerts):
        self.inserted.extend(alerts)


@pytest.fixture
def fake_mongo(monkeypatch):
    fake = _FakeMongo()
    monkeypatch.setattr(threshold, "mongo", fake)
    return fake


def test_first_alert_is_stored(fake_mongo):
    fresh = threshold.check_and_store({"ts": 1000.0, "cpu": 92.0})
    assert len(fresh) == 1
    assert len(fake_mongo.inserted) == 1


def test_repeat_within_cooldown_is_suppressed(fake_mongo):
    """A sustained spike must not flood the feed with identical alerts."""
    fake_mongo.last_ts = 1000.0
    just_inside = 1000.0 + Config.ALERT_COOLDOWN_SECONDS - 1

    fresh = threshold.check_and_store({"ts": just_inside, "cpu": 92.0})

    assert fresh == []
    assert fake_mongo.inserted == []


def test_repeat_after_cooldown_is_stored_again(fake_mongo):
    fake_mongo.last_ts = 1000.0
    just_outside = 1000.0 + Config.ALERT_COOLDOWN_SECONDS + 1

    fresh = threshold.check_and_store({"ts": just_outside, "cpu": 92.0})

    assert len(fresh) == 1
    assert len(fake_mongo.inserted) == 1


def test_cooldown_is_per_metric_and_severity(fake_mongo):
    """Memory going critical must not be muted by a recent CPU alert."""
    seen = []

    def last_alert_ts(metric, severity):
        seen.append((metric, severity))
        return 1000.0 if metric == "cpu" else None

    fake_mongo.last_alert_ts = last_alert_ts

    fresh = threshold.check_and_store({"ts": 1001.0, "cpu": 92.0, "memory": 99.0})

    assert [a["metric"] for a in fresh] == ["memory"]
    assert ("cpu", "critical") in seen and ("memory", "critical") in seen


# --- spec rule: alerting must not depend on ML ----------------------------


def test_threshold_module_does_not_import_ml():
    """TESTING.md test 9: an alert means a MEASURED breach, never a forecast."""
    source = inspect.getsource(threshold)
    assert "from ml" not in source
    assert "import ml" not in source


# --- threshold config validation ------------------------------------------


@pytest.mark.parametrize(
    "payload, fragment",
    [
        ({"gpu": {"warning": 10}}, "Unknown metric"),
        ({"cpu": {"warning": 0}}, "between 0 and 100"),
        ({"cpu": {"warning": 101}}, "between 0 and 100"),
        ({"cpu": {"warning": "abc"}}, "must be a number"),
        ({"cpu": {"warning": 90, "critical": 80}}, "lower than critical"),
    ],
)
def test_invalid_threshold_updates_are_rejected(monkeypatch, payload, fragment):
    monkeypatch.setattr(threshold, "mongo", _FakeMongo())
    clean, error = threshold.validate_thresholds(payload)
    assert clean is None
    assert fragment in error


def test_valid_threshold_update_merges_onto_current(monkeypatch):
    monkeypatch.setattr(threshold, "mongo", _FakeMongo())
    clean, error = threshold.validate_thresholds({"cpu": {"warning": 60.0}})
    assert error is None
    # The untouched critical limit and the other metrics must survive.
    assert clean["cpu"] == {"warning": 60.0, "critical": 85.0}
    assert clean["memory"] == LIMITS["memory"]
