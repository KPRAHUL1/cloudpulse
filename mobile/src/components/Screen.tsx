import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, elevation, radius, spacing, withAlpha } from '../theme';
import { FadeInUp } from './anim';

export function Screen({
  title,
  subtitle,
  children,
  onRefresh,
  refreshing = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.cyan}
          />
        ) : undefined
      }
    >
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
      <View style={{ height: spacing.xxl }} />
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  index = 0,
}: {
  children: React.ReactNode;
  style?: any;
  /** Position in the screen's card stack - drives the entrance stagger. */
  index?: number;
}) {
  return (
    <FadeInUp index={index}>
      <View style={[styles.card, style]}>{children}</View>
    </FadeInUp>
  );
}

export function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View style={styles.cardTitleRow}>
      <Text style={styles.cardTitle}>{children}</Text>
      {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.cyan} />
      <Text style={styles.dim}>{label}</Text>
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>Connection problem</Text>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function InfoBox({ message }: { message: string }) {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingTop: spacing.sm },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.card,
  },
  cardTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  cardHint: { color: colors.textFaint, fontSize: 11 },
  center: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  dim: { color: colors.textDim, fontSize: 13 },
  errorBox: {
    backgroundColor: withAlpha(colors.red, 0.08),
    borderColor: colors.red,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  errorTitle: { color: colors.red, fontWeight: '700', marginBottom: 4 },
  errorText: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  infoBox: {
    backgroundColor: withAlpha(colors.cyan, 0.07),
    borderColor: withAlpha(colors.cyan, 0.3),
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  infoText: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
});
