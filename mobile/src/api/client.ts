/**
 * CloudPulse API client.
 *
 * The Flask backend runs on your computer, not on the phone, so the app has to
 * be told where to find it. The base URL is resolved in three steps:
 *
 *   1. EXPO_PUBLIC_API_URL  - an explicit URL baked in at build time. Required
 *      for standalone APKs (preview / production builds), which have no dev
 *      server to infer the address from. Set it in eas.json.
 *   2. Expo dev-server host - works in Expo Go and in development builds, both
 *      of which connect to Metro. Finds your laptop's LAN IP automatically.
 *   3. localhost            - last resort, only useful in the web preview.
 */
import Constants from 'expo-constants';

const API_PORT = 5000;

function resolveBaseUrl(): string {
  // 1. Explicit build-time URL (standalone builds, or a deployed backend).
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  // 2. Expo exposes the dev machine as "192.168.1.5:8081".
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.manifest2 as any)?.extra?.expoGo?.developer?.host;

  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${API_PORT}/api`;

  // 3. Fallback.
  return `http://localhost:${API_PORT}/api`;
}

export const API_BASE = resolveBaseUrl();

export class ApiError extends Error {}

/**
 * ngrok's free tier serves a one-time HTML interstitial on browser-looking
 * requests. A JSON client would receive that page instead of the API response
 * and fail to parse it, so every request opts out. The header is ignored by
 * backends reached any other way (LAN, Cloudflare, a deployed host).
 */
const BASE_HEADERS: Record<string, string> = {
  'ngrok-skip-browser-warning': 'true',
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  let response: Response;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    response = await fetch(url, {
      ...options,
      headers: { ...BASE_HEADERS, ...(options?.headers ?? {}) },
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err: any) {
    throw new ApiError(
      err?.name === 'AbortError'
        ? `Request timed out: ${url}`
        : `Cannot reach the CloudPulse backend at ${API_BASE}. ` +
          `Check that the backend is running and, on a LAN address, that ` +
          `this device is on the same network.`
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.message ?? `HTTP ${response.status} from ${path}`);
  }
  return body as T;
}

// ---------------------------------------------------------------- Endpoints
export const api = {
  health: () => request<any>('/health'),

  currentMetrics: () => request<any>('/metrics/current'),
  history: (minutes = 60) => request<any>(`/metrics/history?minutes=${minutes}`),
  summary: (minutes = 60) => request<any>(`/metrics/summary?minutes=${minutes}`),

  clusters: () => request<any>('/ml/clusters'),
  predict: (metric: string, horizon = 30) =>
    request<any>(`/ml/predict?metric=${metric}&horizon=${horizon}`),
  analysis: (horizon = 30) => request<any>(`/ml/analysis?horizon=${horizon}`),

  alerts: (limit = 50) => request<any>(`/alerts?limit=${limit}`),
  alertSummary: () => request<any>('/alerts/summary'),
  alertConfig: () => request<any>('/alerts/config'),
  updateAlertConfig: (thresholds: Record<string, any>) =>
    request<any>('/alerts/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(thresholds),
    }),
};
