# CloudPulse - Installation Guide

Complete setup instructions for the CloudPulse real-time cloud monitoring system.

---

## 1. What you are installing

| Component | Runs where | Port | Purpose |
|---|---|---|---|
| windows_exporter | Natively on Windows | 9182 | Exposes **real** host metrics |
| Prometheus | Docker container | 9090 | Scrapes and stores the metrics |
| MongoDB | Docker container | 27017 | Stores samples, alerts, config |
| Flask API | Python venv | 5000 | REST APIs + ML + alerting |
| Expo app | Your phone / emulator | 8081 | The dashboard |

> **Why windows_exporter is not in Docker:** a container cannot read the host
> machine's real CPU, disk and network counters. Installing it natively is what
> makes CloudPulse genuinely real-time rather than a simulation.

---

## 2. Prerequisites

Already verified on this machine:

- Node.js 22.x and npm 11.x
- Python 3.13
- Docker Desktop
- Git

---

## 3. Install windows_exporter (one-time, needs Administrator)

This is the only step that requires elevated privileges.

1. Press **Start**, type `PowerShell`
2. Right-click **Windows PowerShell** and choose **Run as Administrator**
3. Run:

```powershell
cd D:\cloudepluse\monitoring
powershell -ExecutionPolicy Bypass -File .\install-windows-exporter.ps1
```

The script downloads the latest release, installs it as a Windows service on
port 9182, and verifies it is exposing metrics.

**Verify:** open <http://localhost:9182/metrics> in a browser. You should see
hundreds of lines starting with `windows_`.

---

## 4. Start Prometheus and MongoDB

```powershell
cd D:\cloudepluse\monitoring
docker compose up -d
```

**Verify:**

- Prometheus UI: <http://localhost:9090>
- Targets page: <http://localhost:9090/targets> - the `windows` job must show
  **UP** (green). If it shows DOWN, windows_exporter is not running; go back to
  step 3.

To stop later: `docker compose down` (keeps data) or `docker compose down -v`
(wipes stored metrics and the database).

---

## 5. Start the Flask backend

```powershell
cd D:\cloudepluse\backend
.\.venv\Scripts\Activate.ps1
python app.py
```

The virtual environment and dependencies are already installed. If you ever
need to recreate them:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Verify:** open <http://localhost:5000/api/health>. Look for:

```json
{
  "status": "healthy",
  "data_source": "real-time"
}
```

Leave this terminal running. The background collector samples Prometheus every
10 seconds and stores the results in MongoDB.

---

## 6. Start the React Native app

CloudPulse uses an **EAS development build** - a custom Android app installed on
your phone once, which then connects to the Metro dev server for live reloading.

### 6a. One-time: install the development build

The build is produced in Expo's cloud and linked to the EAS project
`@kprahul143/cloudpulse`.

```powershell
cd D:\cloudepluse\mobile
npx eas-cli build --profile development --platform android
```

When it finishes, EAS prints a QR code and a download link. On your Android
phone, open the link and install the APK. You only repeat this when you add a
new native dependency - ordinary JavaScript changes do not need a rebuild.

Check build status any time:

```powershell
npx eas-cli build:list --limit 5
```

### 6b. Every time: start the dev server

```powershell
cd D:\cloudepluse\mobile
npx expo start --dev-client
```

Open the **CloudPulse** app on your phone and it will connect automatically.
Phone and laptop must be on the **same Wi-Fi network**.

Alternatives while developing:

- **Android emulator** - press `a` in the Expo terminal.
- **Web preview** - press `w` (fastest sanity check, no phone needed).

### Build profiles

`eas.json` defines three profiles:

| Profile | Output | Backend URL | Use for |
|---|---|---|---|
| `development` | APK with dev client | auto-detected from Metro | daily development |
| `preview` | standalone APK | `EXPO_PUBLIC_API_URL` in `eas.json` | demo without a dev server |
| `production` | AAB for Play Store | `EXPO_PUBLIC_API_URL` in `eas.json` | release |

> **Important:** the `preview` and `production` profiles have your laptop's LAN
> IP hardcoded in `eas.json` (currently `http://10.105.108.114:5000/api`),
> because a standalone APK has no dev server to discover it from. **If your
> Wi-Fi IP changes, edit `eas.json` and rebuild**, otherwise the standalone APK
> will not reach the backend. Find your current IP with `ipconfig`.
>
> The `development` profile is unaffected - it discovers the address from Metro.

### Important: Wi-Fi requirement

The app finds your backend automatically by reading the Expo dev-server host,
so there is no IP address to type in. But this only works when the phone and the
laptop are on the same network.

If your laptop has **no Wi-Fi connection**, its IP will be a `169.254.x.x`
address and the phone will not be able to reach it. Fix it by either:

- Connecting both devices to the same Wi-Fi, **or**
- Running `npx expo start --tunnel` (slower, but works across networks), **or**
- Using the Android emulator on the laptop itself.

---

## 7. Daily startup order

```powershell
# 1. Infrastructure (windows_exporter runs automatically as a service)
cd D:\cloudepluse\monitoring; docker compose up -d

# 2. Backend
cd D:\cloudepluse\backend; .\.venv\Scripts\Activate.ps1; python app.py

# 3. App (new terminal) - then open CloudPulse on your phone
cd D:\cloudepluse\mobile; npx expo start --dev-client
```

---

## 8. Configuration

Backend settings live in `backend\.env` (copied from `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `PROMETHEUS_URL` | `http://localhost:9090` | Prometheus endpoint |
| `MONGO_URI` | `mongodb://localhost:27017` | MongoDB connection |
| `API_PORT` | `5000` | Flask port |
| `PROM_JOB` | `windows` | Scrape job name |
| `DISK_VOLUME` | `C:` | Which volume to monitor |
| `COLLECT_INTERVAL_SECONDS` | `10` | Sampling frequency |
| `BACKFILL_MINUTES` | `120` | Real history pulled on first run |

Alert thresholds are **not** in this file - they are stored in MongoDB and are
editable from the Alerts tab in the app.

---

## 9. Optional: deploying to AWS EC2

The spec lists AWS EC2 as an optional deployment target. To switch:

1. Launch an EC2 instance (Ubuntu) and install `node_exporter` on it.
2. Open port 9100 in the security group to your Prometheus host.
3. In `monitoring/prometheus.yml`, replace the `windows` job target with your
   EC2 instance address, and change the job name to `node`.
4. In `backend/.env`, set `PROM_JOB=node`.
5. Update the PromQL in `backend/services/prom.py` to the `node_exporter`
   metric names (`node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`,
   `node_filesystem_avail_bytes`, `node_network_receive_bytes_total`).

Everything else - the collector, both ML models, alerting and the app - works
unchanged, because they only ever read the normalised sample format.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `windows` target DOWN in Prometheus | Exporter not installed/running | Re-run step 3; check `Get-Service windows_exporter` |
| `health` says `"data_source": "unavailable"` | Prometheus cannot scrape the exporter | Check <http://localhost:9182/metrics> |
| Backend logs "backfill produced no data" | Exporter was not running at startup | Install it, then restart `python app.py` |
| App shows "Cannot reach the CloudPulse backend" | Phone not on same Wi-Fi, or Flask not running | See the Wi-Fi note in step 6 |
| ML tabs say "insufficient data" | Fewer than 30 samples stored | Wait ~5 minutes, or confirm backfill succeeded |
| `docker compose up` fails | Docker Desktop not started | Launch Docker Desktop, wait for the whale icon |
