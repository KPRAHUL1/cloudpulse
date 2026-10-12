/**
 * CloudPulse - Real-Time Cloud Resource & Health Monitoring System
 * Module 5: Dashboard & Visualization (React Native / Expo)
 */
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PressScale } from './src/components/anim';
import { Logo } from './src/components/Logo';
import { AlertsScreen } from './src/screens/AlertsScreen';
import { AnalysisScreen } from './src/screens/AnalysisScreen';
import { ChartsScreen } from './src/screens/ChartsScreen';
import { OverviewScreen } from './src/screens/OverviewScreen';
import { colors, elevation, motion, radius, spacing } from './src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { key: string; label: string; icon: IconName; render: () => React.ReactElement }[] = [
  { key: 'overview', label: 'Overview', icon: 'pulse', render: () => <OverviewScreen /> },
  { key: 'charts', label: 'Charts', icon: 'bar-chart', render: () => <ChartsScreen /> },
  { key: 'analysis', label: 'Analysis', icon: 'git-network', render: () => <AnalysisScreen /> },
  { key: 'alerts', label: 'Alerts', icon: 'notifications', render: () => <AlertsScreen /> },
];

export default function App() {
  const [active, setActive] = useState(TABS[0].key);
  const [barWidth, setBarWidth] = useState(0);

  const index = Math.max(0, TABS.findIndex((t) => t.key === active));
  const current = TABS[index] ?? TABS[0];

  // Sliding pill behind the selected tab.
  const slide = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    Animated.spring(slide, {
      toValue: index,
      friction: 11,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [index, slide]);

  // Cross-fade the screen body on every tab change.
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: motion.base,
      easing: motion.entrance,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [active, fade]);

  const tabWidth = barWidth / TABS.length;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Logo subtitle="Real-time resource monitoring" />
      </View>

      <Animated.View style={[styles.body, { opacity: fade }]}>{current.render()}</Animated.View>

      <View
        style={styles.tabBar}
        onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {barWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.indicator,
              {
                width: tabWidth - spacing.lg,
                transform: [
                  {
                    translateX: slide.interpolate({
                      inputRange: TABS.map((_, i) => i),
                      outputRange: TABS.map((_, i) => i * tabWidth + spacing.sm),
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}

        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <PressScale
              key={tab.key}
              style={styles.tab}
              onPress={() => setActive(tab.key)}
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
            >
              <View style={styles.tabInner}>
                <Ionicons
                  name={tab.icon}
                  size={21}
                  color={isActive ? colors.cyan : colors.textFaint}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </View>
            </PressScale>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  body: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    ...elevation.raised,
  },
  indicator: {
    position: 'absolute',
    top: spacing.xs,
    bottom: spacing.sm,
    left: 0,
    marginHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  tab: { flex: 1 },
  tabInner: { alignItems: 'center', gap: 3 },
  tabLabel: { color: colors.textFaint, fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: colors.cyan },
});
