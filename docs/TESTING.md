# CloudPulse - Testing & Verification

Each test below has an explicit pass condition. Work through them in order -
later tests depend on earlier ones.

---

## Test 1 - windows_exporter is publishing real metrics

```powershell
curl http://localhost:9182/metrics | Select-String "windows_cpu_time_total" | Select-Object -First 3
```

**Pass:** at least one `windows_cpu_time_total` line is printed.
**Fail:** nothing returned - the service is not installed or not running.

```powershell
Get-Service windows_exporter
```

**Pass:** `Status` is `Running`.

---

## Test 2 - Prometheus is scraping the host

Open <http://localhost:9090/targets>.

**Pass:** the `windows` job shows state **UP** with a recent scrape time.
**Fail:** state DOWN - read the `Error` column; usually means the exporter is
not reachable on port 9182.

Now run a query. Open <http://localhost:9090/graph> and paste:

```promql
100 - (avg without(cpu)(rate(windows_cpu_time_total{mode="idle"}[2m])) * 100)
```

**Pass:** a number between 0 and 100 appears, and it changes when you load the
CPU (open some browser tabs and re-run).

---

## Test 3 - Backend health

```powershell
curl http://localhost:5000/api/health
```

**Pass:** the response contains

```json
"status": "healthy"
"data_source": "real-time"
```

and under `prometheus.available_metrics`, every entry (`cpu`, `memory`,
`disk`, `net_rx`, `net_tx`) is `true`.

**Partial pass:** `"status": "degraded"` tells you exactly which dependency is
down - check the `prometheus` and `mongodb` sections of the same response.

---

## Test 4 - Live metrics endpoint

```powershell
curl http://localhost:5000/api/metrics/current
```

**Pass:** `cpu`, `memory` and `disk` are numbers between 0 and 100, and
`"source": "prometheus"`.

**Correctness check:** open Task Manager -> Performance. The CPU and memory
percentages should broadly match what the API reports (they will not be
identical - the API averages over a 2-minute window).

---

## Test 5 - Collection and storage

Wait 2 minutes after starting the backend, then:

```powershell
curl "http://localhost:5000/api/metrics/history?minutes=60"
```

**Pass:** `count` is greater than 0 and grows each time you re-run it.

Check MongoDB directly:

```powershell
docker exec cloudpulse-mongo mongosh --quiet --eval "db.getSiblingDB('cloudpulse').metrics_history.countDocuments()"
```

**Pass:** a non-zero count that increases over time.

---

## Test 6 - K-Means clustering

```powershell
curl http://localhost:5000/api/ml/clusters
```

**Pass:** `"status": "ok"` and the `clusters` array contains three entries
labelled `Low`, `Medium` and `High`, each with a `centroid`.

**Expected while warming up:** `"status": "insufficient_data"` with a message
saying how many samples are still needed. This is correct behaviour, not a bug.

**Correctness check:** the `High` cluster's centroid CPU value must be greater
than the `Low` cluster's. If the labels were assigned randomly this would not
hold.

---

## Test 7 - Linear Regression prediction

```powershell
curl "http://localhost:5000/api/ml/predict?metric=cpu&horizon=30"
```

**Pass:** `"status": "ok"`, with a `predictions` array of 6 points
(5, 10, 15, 20, 25, 30 minutes ahead) and an `r2_score`.

**Correctness checks:**

- Every `predicted` value is between 0 and 100 (the model clamps to a valid
  percentage range).
- `trend` is `rising` when `slope_per_hour > 1`, `falling` when
  `< -1`, otherwise `stable`.
- Run a CPU-heavy task for a few minutes, then re-run - `slope_per_hour` should
  increase.

Memory works the same way:

```powershell
curl "http://localhost:5000/api/ml/predict?metric=memory&horizon=60"
```

An unsupported metric must be rejected:

```powershell
curl "http://localhost:5000/api/ml/predict?metric=disk"
```

**Pass:** HTTP 400 with an explanatory message. (Disk forecasting is out of
scope - the spec asks for CPU and memory only.)

---

## Test 8 - Threshold alerts

Read the current configuration:

```powershell
curl http://localhost:5000/api/alerts/config
```

**Pass:** returns CPU 70/85, Memory 75/90, Disk 80/90.

Now force an alert by lowering the CPU threshold below your current usage:

```powershell
curl -X PUT http://localhost:5000/api/alerts/config -H "Content-Type: application/json" -d "{\"cpu\":{\"warning\":1,\"critical\":2}}"
```

Wait ~15 seconds (one or two collection cycles), then:

```powershell
curl "http://localhost:5000/api/alerts?limit=10"
```

**Pass:** at least one alert with `"severity": "critical"`, `"source": "threshold"`,
and a message naming the measured value and the limit.

**Cooldown check:** re-run the alerts call a few times over the next minute.
The count should **not** grow on every cycle - repeat alerts for the same
metric and severity are suppressed for 5 minutes.

Restore sane thresholds afterwards:

```powershell
curl -X PUT http://localhost:5000/api/alerts/config -H "Content-Type: application/json" -d "{\"cpu\":{\"warning\":70,\"critical\":85}}"
```

**Validation check:** this must be rejected with HTTP 400, because warning must
be below critical:

```powershell
curl -X PUT http://localhost:5000/api/alerts/config -H "Content-Type: application/json" -d "{\"cpu\":{\"warning\":90,\"critical\":50}}"
```

---

## Test 9 - Alerts are independent of ML

This verifies the spec requirement that threshold alerts stay separate from
predictions.

```powershell
Select-String -Path D:\cloudepluse\backend\alerts\threshold.py -Pattern "^from|^import"
```

**Pass:** there is **no** import from `ml`. An alert can only be produced by a
measured value crossing a configured limit, never by a model output.

---

## Test 10 - The app

With `npx expo start` running and the app open:

| Tab | Pass condition |
|---|---|
| Overview | Three gauges show live values; the banner reads **LIVE PROMETHEUS DATA**; values change as you load the machine |
| Charts | Lines are drawn for CPU/Memory/Disk; switching 15m / 1h / 6h / 24h changes the range; min/avg/max appear |
| Analysis | Three clusters listed with distribution bars; forecast charts show a solid observed line and a dashed predicted line |
| Alerts | Thresholds load into the form; editing and saving shows "Thresholds saved"; triggered alerts appear in the feed |

Pull down on any screen to force a refresh.

---

## Test 11 - Failure handling

Confirm the system degrades honestly rather than inventing data.

**Stop Prometheus:**

```powershell
docker stop cloudpulse-prometheus
```

**Pass:** `/api/health` reports `"status": "degraded"` and
`"data_source": "unavailable"`. The app shows **EXPORTER OFFLINE** and an error
box. It does **not** display fabricated metrics.

**Restart it:**

```powershell
docker start cloudpulse-prometheus
```

**Pass:** within ~30 seconds the app recovers on its own.

**Stop MongoDB:**

```powershell
docker stop cloudpulse-mongo
```

**Pass:** the backend keeps serving `/api/metrics/current` (which reads
Prometheus directly), while history and ML endpoints report the failure.
Restart with `docker start cloudpulse-mongo`.

---

## Automated coverage

Everything that does not need a running host stack is covered by pytest, so it
does not have to be re-checked by hand:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests -q     # 30 tests
```

## Summary checklist

Verified on the **zero-infrastructure** path (psutil + SQLite, Docker stopped):

- [x] `/api/health` -> healthy, data_source real-time
- [x] Live metrics match the OS - memory and disk matched Win32 WMI exactly
      (78.7% / 70.1%); CPU tracked a 12-core load test 6.6% -> 100.0% -> 33.9%
- [x] Samples accumulating in the store (SQLite; MongoDB on the full stack)
- [x] K-Means returns Low / Medium / High with ordered centroids
      (6.7 / 10.5 / 96.5% CPU, silhouette 0.52) - also asserted in tests
- [x] Linear Regression returns clamped predictions with R2 - asserted in tests
- [x] Threshold alert fires, and cooldown suppresses duplicates - a real
      98.3% CPU critical fired, and ~9 further breaching samples during a 90s
      load produced no duplicate
- [x] `threshold.py` imports nothing from `ml/` - asserted in tests
- [x] All four app tabs render live data
- [x] System degrades honestly when a dependency is stopped - with no exporter
      and no Prometheus, `/api/health` reported `data_source: unavailable`
      with the cause, and showed no numbers

Full-stack only, still to confirm on a machine with the exporter installed:

- [ ] windows_exporter service running, metrics on :9182
- [ ] Prometheus `windows` target UP
