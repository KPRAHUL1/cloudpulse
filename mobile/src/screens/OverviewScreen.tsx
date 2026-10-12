/** Module 5 - live resource overview. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Card, CardTitle, ErrorBox, Loading, Screen } from '../components/Screen';
import { GaugeRing } from '../components/GaugeRing';
import { StatusPill } from '../components/StatusPill';
import { usePolling } from '../hooks/usePolling';
import { colors, levelColor, spacing } from '../theme';

function formatUptime(seconds?: number | null): string {
  if (!seconds || seconds < 0) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatRate(bytesPerSec?: number | null): string {
  if (bytesPerSec == null) return '--';
  if (bytesPerSec > 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(2)} MB/s`;
  if (bytesPerSec > 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

export function OverviewScreen() {
  const metrics = usePolling(api.currentMetrics, 5000);
  const health = usePolling(api.health, 15000);
  const alerts = usePolling(api.alertSummary, 15000);
  const clusters = usePolling(api.clusters, 30000);

  const m = metrics.data;
  const h = health.data;
  const live = h?.data_source === 'real-time';
  // The backend reports which Module 1 source it chose, so the banner can name
  // it rather than asserting Prometheus on a path that never touched it.
  const viaHost = h?.prometheus?.source === 'psutil';
  const sourceLabel = !live
    ? 'METRICS UNAVAILABLE'
    : viaHost
      ? 'LIVE HOST METRICS'
      : 'LIVE PROMETHEUS DATA';

  if (metrics.loading && !m) return <Loading label="Connecting to CloudPulse..." />;

  return (
    <Screen
      title="Overview"
      subtitle="Live utilisation, network and host health"
      onRefresh={() => {
        metrics.refresh();
        health.refresh();
        alerts.refresh();
      }}
      refreshing={metrics.loading}
    >
      {metrics.error ? <ErrorBox message={metrics.error} /> : null}

      {/* Data-source honesty banner: states plainly whether metrics are real. */}
      <View style={styles.pillRow}>
        <StatusPill
          label={sourceLabel}
          color={live ? colors.green : colors.red}
          pulse={live}
        />
        {h?.collector?.running ? (
          <StatusPill label="COLLECTOR ON" color={colors.cyan} dim />
        ) : null}
      </View>

      <Card index={0}>
        <CardTitle hint={m?.source === 'prometheus' ? 'live' : m?.source}>
          Resource Utilisation
        </CardTitle>
        <View style={styles.gaugeRow}>
          <GaugeRing value={m?.cpu ?? null} label="CPU" />
          <GaugeRing value={m?.memory ?? null} label="Memory" />
          <GaugeRing value={m?.disk ?? null} label="Disk" />
        </View>
      </Card>

      <Card index={1}>
        <CardTitle>Network Activity</CardTitle>
        <View style={styles.statRow}>
          <Stat label="Download" value={formatRate(m?.network?.rx_bytes_per_sec)} color={colors.cyan} />
          <Stat label="Upload" value={formatRate(m?.network?.tx_bytes_per_sec)} color={colors.purple} />
          <Stat label="Total" value={`${m?.network?.total_mbps ?? '--'} Mbps`} color={colors.blue} />
        </View>
      </Card>

      <Card index={2}>
        <CardTitle>Server Health</CardTitle>
        <View style={styles.statRow}>
          <Stat label="Host uptime" value={formatUptime(m?.host_uptime_seconds)} color={colors.green} />
          <Stat
            label="Samples stored"
            value={String(h?.mongodb?.samples_stored ?? '--')}
            color={colors.cyan}
          />
          <Stat
            label="Exporter"
            value={m?.exporter_up ? 'UP' : 'DOWN'}
            color={m?.exporter_up ? colors.green : colors.red}
          />
        </View>
      </Card>

      <Card index={3}>
        <CardTitle hint="K-Means">Current Usage Pattern</CardTitle>
        {clusters.data?.status === 'ok' ? (
          <View style={styles.levelRow}>
            <StatusPill
              label={String(clusters.data.current.usage_level).toUpperCase()}
              color={levelColor[clusters.data.current.usage_level] ?? colors.cyan}
            />
            <Text style={styles.dim}>
              clustered from {clusters.data.samples_analysed} samples
            </Text>
          </View>
        ) : (
          <Text style={styles.dim}>
            {clusters.data?.message ?? 'Collecting data for clustering...'}
          </Text>
        )}
      </Card>

      <Card index={4}>
        <CardTitle hint="threshold-based">Active Alerts</CardTitle>
        <View style={styles.statRow}>
          <Stat
            label="Critical"
            value={String(alerts.data?.counts?.critical ?? 0)}
            color={colors.red}
          />
          <Stat
            label="Warning"
            value={String(alerts.data?.counts?.warning ?? 0)}
            color={colors.amber}
          />
          <Stat label="Total" value={String(alerts.data?.total ?? 0)} color={colors.textDim} />
        </View>
      </Card>
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  gaugeRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  statValue: { fontSize: 17, fontWeight: '700' },
  statLabel: { color: colors.textFaint, fontSize: 11, marginTop: 2 },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dim: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
});
