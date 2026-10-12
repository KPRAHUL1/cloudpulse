/** Module 5 - resource utilisation charts from stored history. */
import React, { useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Card, CardTitle, ErrorBox, InfoBox, Loading, Screen } from '../components/Screen';
import { LineChart, Point } from '../components/LineChart';
import { usePolling } from '../hooks/usePolling';
import { colors, radius, spacing, withAlpha } from '../theme';

const RANGES = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
];

const SERIES = [
  { key: 'cpu', title: 'CPU Utilisation', color: colors.cyan },
  { key: 'memory', title: 'Memory Utilisation', color: colors.purple },
  { key: 'disk', title: 'Disk Utilisation', color: colors.blue },
];

export function ChartsScreen() {
  const [minutes, setMinutes] = useState(60);
  const width = Dimensions.get('window').width - spacing.lg * 2 - spacing.lg * 2;

  const history = usePolling(() => api.history(minutes), 15000, [minutes]);
  const summary = usePolling(() => api.summary(minutes), 30000, [minutes]);

  const samples: any[] = history.data?.samples ?? [];

  const toPoints = (key: string): Point[] =>
    samples
      .filter((s) => s[key] != null)
      .map((s) => ({ x: s.ts, y: s[key] as number }));

  if (history.loading && samples.length === 0) return <Loading label="Loading history..." />;

  return (
    <Screen
      title="Charts"
      subtitle="Resource utilisation over time"
      onRefresh={() => {
        history.refresh();
        summary.refresh();
      }}
      refreshing={history.loading}
    >
      {history.error ? <ErrorBox message={history.error} /> : null}

      <View style={styles.rangeRow}>
        {RANGES.map((r) => {
          const active = r.minutes === minutes;
          return (
            <Pressable
              key={r.label}
              onPress={() => setMinutes(r.minutes)}
              style={[styles.rangeBtn, active && styles.rangeBtnActive]}
            >
              <Text style={[styles.rangeText, active && styles.rangeTextActive]}>
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {samples.length === 0 ? (
        <InfoBox message="No history stored yet. The collector saves a sample every 10 seconds - give it a minute." />
      ) : null}

      {SERIES.map((s) => {
        const pts = toPoints(s.key);
        const stats = summary.data?.metrics?.[s.key];
        return (
          <Card key={s.key}>
            <CardTitle hint={`${pts.length} points`}>{s.title}</CardTitle>
            <LineChart data={pts} width={width} color={s.color} yMin={0} yMax={100} />
            {stats ? (
              <View style={styles.statsRow}>
                <MiniStat label="min" value={`${stats.min}%`} />
                <MiniStat label="avg" value={`${stats.avg}%`} />
                <MiniStat label="max" value={`${stats.max}%`} />
              </View>
            ) : null}
          </Card>
        );
      })}

      <Card index={0}>
        <CardTitle hint="bytes/sec">Network Throughput</CardTitle>
        <LineChart
          data={samples
            .filter((s) => s.net_rx != null)
            .map((s) => ({ x: s.ts, y: (s.net_rx + (s.net_tx ?? 0)) / 1024 }))}
          width={width}
          color={colors.green}
          unit="K"
        />
        <Text style={styles.axisNote}>KB/s (download + upload)</Text>
      </Card>
    </Screen>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rangeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  rangeBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rangeBtnActive: { backgroundColor: withAlpha(colors.cyan, 0.12), borderColor: colors.cyan },
  rangeText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  rangeTextActive: { color: colors.cyan },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  miniStat: { alignItems: 'center' },
  miniLabel: { color: colors.textFaint, fontSize: 10, textTransform: 'uppercase' },
  miniValue: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 2 },
  axisNote: { color: colors.textFaint, fontSize: 10, marginTop: 6, textAlign: 'right' },
});
