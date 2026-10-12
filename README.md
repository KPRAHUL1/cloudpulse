# CloudPulse

**Real-Time Cloud Resource & Health Monitoring System**

CloudPulse monitors CPU, memory, disk, network and server health in real time,
analyses resource utilisation patterns with K-Means clustering, predicts future
utilisation with Linear Regression, and raises threshold-based alerts - all
surfaced through a React Native dashboard.

---

## Architecture

```
  Windows Host
       |
       |  real CPU / memory / disk / network counters
       v
  windows_exporter  (native service, :9182)
       |
       |  scraped every 10s
       v
  Prometheus  (Docker, :9090)
       |
       |  PromQL
       v
  Flask backend  (:5000) ----------------> MongoDB (Docker, :27017)
       |  - collector + preprocessing          samples, alerts,
       |  - K-Means clustering                 config, ML results
       |  - Linear Regression
       |  - threshold alerting
       |
       |  REST / JSON
       v
  React Native app  (Expo)
```

---

## Module map

The five modules required by the specification:

| # | Module | Implementation |
|---|---|---|
| 1 | Real-Time Resource Monitoring | `backend/services/prom.py` + windows_exporter |
| 2 | Data Collection & Preprocessing | `backend/services/collector.py` |
| 3 | ML Analysis & Prediction | `backend/ml/kmeans_model.py`, `backend/ml/regression_model.py` |
| 4 | Alert & Notification Management | `backend/alerts/threshold.py` |
| 5 | Dashboard & Visualization | `mobile/` |

### Machine Learning

Exactly two algorithms, as specified:

- **K-Means Clustering** (`k=3`) groups resource-utilisation patterns and labels
  the clusters **Low / Medium / High** by ranking the centroids. Features are
  standardised before clustering so no single metric dominates. Cluster quality
  is reported as a silhouette score.
- **Linear Regression** fits a least-squares trend over recent history and
  extrapolates future CPU and memory utilisation, reporting slope, R² and a
  trend classification. Extrapolations are clamped to a valid 0-100% range.

### Alerting is independent of ML

`alerts/threshold.py` imports nothing from `ml/`. An alert is raised only when a
**measured** value crosses a configured limit - never because a model predicted
something. Thresholds are stored in MongoDB and editable from the app. Repeat
alerts for the same metric and severity are suppressed for 5 minutes.

---

## Data is real, not simulated

Every value shown in the dashboard originates from `windows_exporter` reading
the actual host. There is no sample-data generator anywhere in the codebase.

- On first start the collector **backfills real history** from Prometheus range
  queries, so the ML models have genuine data immediately instead of waiting for
  samples to accumulate.
- When the exporter or Prometheus is unavailable, the API reports
  `"data_source": "unavailable"` and the app displays **EXPORTER OFFLINE**. It
  shows no numbers rather than fabricated ones.

---

## Tech stack

| Layer | Technology |
|---|---|
| Mobile app | React Native (Expo SDK 57), TypeScript, react-native-svg |
| Backend | Python 3.13, Flask 3.1, flask-cors |
| Monitoring | Prometheus 3.1, windows_exporter |
| Database | MongoDB 7.0 |
| ML / data | scikit-learn 1.6, pandas 2.2, NumPy 2.2 |
| Containers | Docker Compose |

---

## Quick start

```powershell
# 1. Install the metrics exporter (Administrator PowerShell, one time)
cd D:\cloudepluse\monitoring
powershell -ExecutionPolicy Bypass -File .\install-windows-exporter.ps1

# 2. Start Prometheus + MongoDB
docker compose up -d

# 3. Start the backend
cd D:\cloudepluse\backend
.\.venv\Scripts\Activate.ps1
python app.py

# 4. Start the app (new terminal)
cd D:\cloudepluse\mobile
npx expo start --dev-client
```

The app is an **EAS development build** (project `@kprahul143/cloudpulse`).
Install it on your phone once with
`npx eas-cli build --profile development --platform android`; after that the
command above is all you need day to day, since JavaScript changes reload
without a rebuild.

Full instructions: [docs/INSTALL.md](docs/INSTALL.md)
Verification steps: [docs/TESTING.md](docs/TESTING.md)

---

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Dependency status + whether data is real |
| GET | `/api/metrics/current` | Live CPU / memory / disk / network |
| GET | `/api/metrics/history?minutes=60` | Stored history for charts |
| GET | `/api/metrics/summary?minutes=60` | Min / avg / max per metric |
| GET | `/api/ml/clusters` | K-Means Low / Medium / High result |
| GET | `/api/ml/predict?metric=cpu&horizon=30` | Linear Regression forecast |
| GET | `/api/ml/analysis` | Both algorithms in one response |
| GET | `/api/alerts?limit=50` | Threshold alert feed |
| GET | `/api/alerts/summary` | Alert counts by severity |
| GET | `/api/alerts/config` | Current thresholds |
| PUT | `/api/alerts/config` | Update thresholds |

---

## App screens

| Tab | Shows |
|---|---|
| **Overview** | Live gauges, network throughput, host uptime, current K-Means pattern, alert counts |
| **Charts** | CPU / memory / disk / network over 15m, 1h, 6h or 24h with min-avg-max |
| **Analysis** | Cluster distribution with centroids, forecast charts with dashed prediction lines, slope and R² |
| **Alerts** | Editable thresholds and the alert feed |

The app discovers the backend automatically from the Expo dev-server host, so
there is no IP address to configure. Phone and laptop must share a Wi-Fi
network. To point at a deployed backend instead, set `MANUAL_API_BASE` in
`mobile/src/api/client.ts`.

---

## Repository layout

```
cloudepluse/
├── backend/           Flask API, ML models, alerting, collector
│   ├── ml/            K-Means + Linear Regression
│   ├── alerts/        Threshold rules (no ML dependency)
│   ├── routes/        REST blueprints
│   └── services/      Prometheus client, MongoDB, collector
├── mobile/            React Native (Expo) dashboard
│   └── src/
│       ├── api/       Backend client with host auto-discovery
│       ├── components/  Gauge, line chart, cards
│       ├── hooks/     Polling hook
│       └── screens/   Overview, Charts, Analysis, Alerts
├── monitoring/        Prometheus config, Docker Compose, exporter installer
└── docs/              INSTALL.md, TESTING.md
```
