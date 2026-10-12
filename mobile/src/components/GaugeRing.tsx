/** Circular utilisation gauge drawn with react-native-svg. */
import React from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { colors, usageColor } from '../theme';
import { useAnimatedValue, useCountUp } from './anim';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function GaugeRing({
  value,
  label,
  size = 110,
  stroke = 9,
  unit = '%',
}: {
  value: number | null;
  label: string;
  size?: number;
  stroke?: number;
  unit?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tint = usageColor(value);

  // The arc sweeps to each new reading instead of jumping. strokeDashoffset is
  // an SVG prop, so this is JS-driven (see anim.tsx).
  const sweep = useAnimatedValue(pct);
  const dashOffset = sweep.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  // Digits roll to the new reading over the same beat.
  const shown = useCountUp(value);

  return (
    <View style={[styles.wrap, { width: size }]}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.surfaceAlt}
            strokeWidth={stroke}
            fill="none"
          />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={tint}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            fill="none"
          />
        </G>
      </Svg>

      <View style={[styles.center, { width: size, height: size }]}>
        <Text style={[styles.value, { color: tint }]}>
          {shown == null ? '--' : shown.toFixed(1)}
          <Text style={styles.unit}>{unit}</Text>
        </Text>
      </View>

      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 20, fontWeight: '700' },
  unit: { fontSize: 11, fontWeight: '600' },
  label: { color: colors.textDim, fontSize: 12, marginTop: 6, fontWeight: '500' },
});
