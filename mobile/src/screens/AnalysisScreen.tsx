/**
 * Module 5 - Machine Learning results.
 *
 * Shows both required algorithms and labels each one explicitly, so the
 * clustering output is never confused with the forecast, and neither is
 * confused with the threshold alerts on the Alerts tab.
 */
import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Card, CardTitle, ErrorBox, InfoBox, Loading, Screen } from '../components/Screen';
import { Legend, LineChart, Point } from '../components/LineChart';
import { StatusPill } from '../components/StatusPill';
import { usePolling } from '../hooks/usePolling';
import { colors, levelColor, radius, spacing } from '../theme';

const TREND_COLOR: Record<string, string> = {
  rising: colors.red,
  falling: colors.green,
  stable: colors.cyan,
};

export function AnalysisScreen() {
  const analysis = usePolling(() => api.analysis(30), 30000);
  const width = Dimensions.get('window').width - spacing.lg * 2 - spacing.lg * 2;

  const clustering = analysis.data?.clustering;
  const prediction = analysis.data?.prediction;

  if (analysis.loading && !analysis.data) return <Loading label="Running ML analysis..." />;

  return (
    <Screen
      title="ML Analysis"
      subtitle="K-Means clustering & Linear Regression prediction"
      onRefresh={analysis.refresh}
      refreshing={analysis.loading}
    >
      {analysis.error ? <ErrorBox message={analysis.error} /> : null}

      {/* ---------------- K-Means ---------------- */}
      <Card index={0}>
        <CardTitle hint="unsupervised">K-Means Clustering</CardTitle>

        {clustering?.status !== 'ok' ? (
          <InfoBox
            message={clustering?.message ?? 'Waiting for enough samples to cluster.'}
          />
        ) : (
          <>
            <View style={styles.currentRow}>
              <Text style={styles.dim}>Current pattern</Text>
              <StatusPill
                label={String(clustering.current.usage_level).toUpperCase()}
                color={levelColor[clustering.current.usage_level] ?? colors.cyan}
              />
            </View>

            {clustering.clusters.map((c: any) => (
              <View key={c.cluster_id} style={styles.clusterRow}>
                <View style={styles.clusterHead}>
                  <View
                    style={[
                      styles.levelDot,
                      { backgroundColor: levelColor[c.usage_level] ?? colors.cyan },
                    ]}
                  />
                  <Text style={styles.clusterName}>{c.usage_level} usage</Text>
                  <Text style={styles.clusterCount}>
                    {c.count} pts ({c.percentage}%)
                  </Text>
                </View>

                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${c.percentage}%`,
                        backgroundColor: levelColor[c.usage_level] ?? colors.cyan,
                      },
                    ]}
                  />
                </View>

                <Text style={styles.centroid}>
                  centroid - CPU {c.centroid.cpu}% / Mem {c.centroid.memory}% / Disk{' '}
                  {c.centroid.disk}%
                </Text>
              </View>
            ))}

            <View style={styles.metaRow}>
              <Text style={styles.meta}>k = {clustering.k}</Text>
              <Text style={styles.meta}>samples = {clustering.samples_analysed}</Text>
              {clustering.silhouette_score != null ? (
                <Text style={styles.meta}>silhouette = {clustering.silhouette_score}</Text>
              ) : null}
            </View>
          </>
        )}
      </Card>

      {/* ---------------- Linear Regression ---------------- */}
      {['cpu', 'memory'].map((metric) => {
        const p = prediction?.[metric];
        const title = metric === 'cpu' ? 'CPU' : 'Memory';

        return (
          <Card key={metric}>
            <CardTitle hint="Linear Regression">{title} Forecast</CardTitle>

            {p?.status !== 'ok' ? (
              <InfoBox message={p?.message ?? 'Waiting for enough samples to predict.'} />
            ) : (
              <>
                <LineChart
                  data={(p.history as any[]).map((h): Point => ({ x: h.ts, y: h.value }))}
                  forecast={(p.predictions as any[]).map(
                    (f): Point => ({ x: f.ts, y: f.predicted })
                  )}
                  width={width}
                  color={metric === 'cpu' ? colors.cyan : colors.purple}
                  yMin={0}
                  yMax={100}
                />
                <Legend
                  items={[
                    {
                      color: metric === 'cpu' ? colors.cyan : colors.purple,
                      label: 'observed',
                    },
                    { color: colors.purple, label: `predicted (+${p.horizon_minutes}m)` },
                  ]}
                />

                <View style={styles.predRow}>
                  <Pred label="Now" value={`${p.current_value}%`} color={colors.text} />
                  <Pred
                    label={`In ${p.horizon_minutes}m`}
                    value={`${p.predicted_at_horizon}%`}
                    color={colors.purple}
                  />
                  <Pred
                    label="Trend"
                    value={p.trend}
                    color={TREND_COLOR[p.trend] ?? colors.cyan}
                  />
                </View>

                <Text style={styles.meta}>
                  slope {p.slope_per_hour > 0 ? '+' : ''}
                  {p.slope_per_hour}%/hour - fit quality R2 = {p.r2_score} -{' '}
                  {p.samples_analysed} samples
                </Text>
              </>
            )}
          </Card>
        );
      })}

      <InfoBox message="These are statistical predictions. They never trigger alerts - alerting is threshold-based and lives on the Alerts tab." />
    </Screen>
  );
}

function Pred({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.pred}>
      <Text style={styles.predLabel}>{label}</Text>
      <Text style={[styles.predValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { color: colors.textDim, fontSize: 13 },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  clusterRow: { marginBottom: spacing.lg },
  clusterHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  levelDot: { width: 8, height: 8, borderRadius: 4 },
  clusterName: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  clusterCount: { color: colors.textDim, fontSize: 11 },
  barTrack: {
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    marginTop: 6,
    overflow: 'hidden',
  },
  barFill: { height: 6, borderRadius: radius.sm },
  centroid: { color: colors.textFaint, fontSize: 10, marginTop: 5 },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  meta: { color: colors.textFaint, fontSize: 10 },
  predRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  pred: { flex: 1 },
  predLabel: { color: colors.textFaint, fontSize: 10, textTransform: 'uppercase' },
  predValue: { fontSize: 16, fontWeight: '700', marginTop: 2 },
});
