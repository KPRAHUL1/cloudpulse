/**
 * Module 5 - threshold alert feed and configuration.
 *
 * Everything on this screen comes from alerts/threshold.py. No ML output is
 * shown here, matching the requirement that alerts stay separate from
 * predictions.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from '../api/client';
import { Card, CardTitle, ErrorBox, InfoBox, Screen } from '../components/Screen';
import { FadeInUp } from '../components/anim';
import { StatusPill } from '../components/StatusPill';
import { usePolling } from '../hooks/usePolling';
import { colors, radius, severityColor, spacing } from '../theme';

const METRICS = [
  { key: 'cpu', label: 'CPU' },
  { key: 'memory', label: 'Memory' },
  { key: 'disk', label: 'Disk' },
];

function timeAgo(ts: number): string {
  const secs = Math.max(0, Date.now() / 1000 - ts);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function AlertsScreen() {
  const alerts = usePolling(() => api.alerts(50), 10000);
  const config = usePolling(api.alertConfig, 0);
  const health = usePolling(api.health, 30000);

  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Seed the editable form once the saved thresholds arrive.
  useEffect(() => {
    const t = config.data?.thresholds;
    if (!t) return;
    const next: Record<string, Record<string, string>> = {};
    for (const m of METRICS) {
      next[m.key] = {
        warning: String(t[m.key]?.warning ?? ''),
        critical: String(t[m.key]?.critical ?? ''),
      };
    }
    setDraft(next);
  }, [config.data]);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload: Record<string, any> = {};
      for (const m of METRICS) {
        payload[m.key] = {
          warning: Number(draft[m.key]?.warning),
          critical: Number(draft[m.key]?.critical),
        };
      }
      await api.updateAlertConfig(payload);
      setSaveMsg('Thresholds saved');
      config.refresh();
    } catch (err: any) {
      setSaveMsg(err?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const list: any[] = alerts.data?.alerts ?? [];
  // Name the store actually in use (MongoDB, or the local SQLite fallback).
  const storeName = health.data?.mongodb?.backend === 'sqlite' ? 'SQLite' : 'MongoDB';
  const critical = list.filter((a) => a.severity === 'critical').length;
  const warning = list.filter((a) => a.severity === 'warning').length;

  return (
    <Screen
      title="Alerts"
      subtitle="Threshold-based notifications"
      onRefresh={() => {
        alerts.refresh();
        config.refresh();
      }}
      refreshing={alerts.loading}
    >
      {alerts.error ? <ErrorBox message={alerts.error} /> : null}

      <View style={styles.pillRow}>
        <StatusPill label={`${critical} CRITICAL`} color={colors.red} />
        <StatusPill label={`${warning} WARNING`} color={colors.amber} />
      </View>

      {/* ------------- Threshold configuration ------------- */}
      <Card index={0}>
        <CardTitle hint={`stored in ${storeName}`}>Alert Thresholds</CardTitle>

        <View style={styles.headRow}>
          <Text style={[styles.headCell, { flex: 1 }]}>Metric</Text>
          <Text style={styles.headCell}>Warning</Text>
          <Text style={styles.headCell}>Critical</Text>
        </View>

        {METRICS.map((m) => (
          <View key={m.key} style={styles.inputRow}>
            <Text style={styles.metricLabel}>{m.label}</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.amber }]}
              keyboardType="numeric"
              value={draft[m.key]?.warning ?? ''}
              onChangeText={(v) =>
                setDraft((d) => ({ ...d, [m.key]: { ...d[m.key], warning: v } }))
              }
              placeholderTextColor={colors.textFaint}
            />
            <TextInput
              style={[styles.input, { borderColor: colors.red }]}
              keyboardType="numeric"
              value={draft[m.key]?.critical ?? ''}
              onChangeText={(v) =>
                setDraft((d) => ({ ...d, [m.key]: { ...d[m.key], critical: v } }))
              }
              placeholderTextColor={colors.textFaint}
            />
          </View>
        ))}

        <Pressable style={styles.saveBtn} onPress={save} disabled={saving}>
          {saving ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <Text style={styles.saveText}>Save thresholds</Text>
          )}
        </Pressable>

        {saveMsg ? <Text style={styles.saveMsg}>{saveMsg}</Text> : null}
      </Card>

      {/* ------------- Alert feed ------------- */}
      <Card index={1}>
        <CardTitle hint={`${list.length} records`}>Recent Alerts</CardTitle>

        {list.length === 0 ? (
          <InfoBox message="No alerts yet. An alert is recorded when a measured value crosses one of the thresholds above." />
        ) : (
          list.map((a, i) => (
            <FadeInUp
              key={`${a.ts}-${a.metric}-${i}`}
              index={Math.min(i, 8)}
              style={styles.alertRow}
            >
              <View
                style={[
                  styles.sevBar,
                  { backgroundColor: severityColor[a.severity] ?? colors.textDim },
                ]}
              />
              <View style={styles.alertBody}>
                <View style={styles.alertHead}>
                  <Text
                    style={[
                      styles.sevText,
                      { color: severityColor[a.severity] ?? colors.textDim },
                    ]}
                  >
                    {String(a.severity).toUpperCase()}
                  </Text>
                  <Text style={styles.alertTime}>{timeAgo(a.ts)}</Text>
                </View>
                <Text style={styles.alertMsg}>{a.message}</Text>
                <Text style={styles.alertMeta}>
                  {a.metric} = {a.value}
                  {a.unit} (limit {a.threshold}
                  {a.unit})
                </Text>
              </View>
            </FadeInUp>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  headRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.sm },
  headCell: {
    color: colors.textFaint,
    fontSize: 10,
    textTransform: 'uppercase',
    width: 70,
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  metricLabel: { color: colors.text, fontSize: 13, flex: 1 },
  input: {
    width: 70,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 7,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: colors.cyan,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveText: { color: colors.bg, fontWeight: '700', fontSize: 13 },
  saveMsg: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  alertRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  sevBar: { width: 3, borderRadius: 2 },
  alertBody: { flex: 1 },
  alertHead: { flexDirection: 'row', justifyContent: 'space-between' },
  sevText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  alertTime: { color: colors.textFaint, fontSize: 10 },
  alertMsg: { color: colors.text, fontSize: 13, marginTop: 3, lineHeight: 18 },
  alertMeta: { color: colors.textFaint, fontSize: 10, marginTop: 3 },
});
