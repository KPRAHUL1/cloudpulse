/**
 * Compact time-series line chart (react-native-svg).
 * Supports an optional dashed "forecast" series for Linear Regression output.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors, motion, spacing } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface Point {
  x: number;
  y: number;
}

export function LineChart({
  data,
  forecast = [],
  width,
  height = 170,
  color = colors.cyan,
  forecastColor = colors.purple,
  unit = '%',
  yMin,
  yMax,
}: {
  data: Point[];
  forecast?: Point[];
  width: number;
  height?: number;
  color?: string;
  forecastColor?: string;
  unit?: string;
  yMin?: number;
  yMax?: number;
}) {
  // Reveal progress, restarted whenever the series identity changes.
  const reveal = useRef(new Animated.Value(0)).current;
  const seriesKey = `${data.length}:${data[0]?.x ?? 0}:${forecast.length}`;
  useEffect(() => {
    reveal.setValue(0);
    const anim = Animated.timing(reveal, {
      toValue: 1,
      duration: motion.draw,
      easing: motion.entrance,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [seriesKey, reveal]);

  // SVG ids are document-global: a fixed id makes every chart on a screen
  // reuse the first one's gradient. Derive a stable unique id per instance.
  const gradientId = useMemo(
    () => `fill-${Math.random().toString(36).slice(2, 9)}`,
    []
  );

  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 20;

  const all = [...data, ...forecast];
  if (all.length < 2) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>Not enough data points yet</Text>
      </View>
    );
  }

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);

  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const lo = yMin ?? Math.min(...ys);
  const hi = yMax ?? Math.max(...ys);
  // Pad the y-range so the line is never flush against the edges.
  const span = hi - lo || 1;
  const yLo = yMin ?? Math.max(0, lo - span * 0.1);
  const yHi = yMax ?? hi + span * 0.1;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const sx = (x: number) => padL + ((x - x0) / (x1 - x0 || 1)) * plotW;
  const sy = (y: number) =>
    padT + plotH - ((y - yLo) / (yHi - yLo || 1)) * plotH;

  const toPath = (pts: Point[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x)},${sy(p.y)}`).join(' ');

  const linePath = toPath(data);
  const areaPath =
    data.length > 1
      ? `${linePath} L${sx(data[data.length - 1].x)},${padT + plotH} L${sx(
          data[0].x
        )},${padT + plotH} Z`
      : '';

  // Join the forecast onto the end of the history so the line is continuous.
  const forecastPath =
    forecast.length > 0 && data.length > 0
      ? toPath([data[data.length - 1], ...forecast])
      : '';

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => yLo + (yHi - yLo) * f);

  // Over-estimate of path length - exact measurement is not available in
  // react-native-svg, and over-covering simply means the mask fully hides the
  // line at progress 0, which is all the reveal needs.
  const traceLen = (width + height) * 3;

  return (
    <View>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.28" />
            <Stop offset="1" stopColor={color} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>

        {gridValues.map((v, i) => (
          <Line
            key={i}
            x1={padL}
            y1={sy(v)}
            x2={width - padR}
            y2={sy(v)}
            stroke={colors.border}
            strokeWidth={1}
          />
        ))}

        {areaPath ? (
          <AnimatedPath
            d={areaPath}
            fill={`url(#${gradientId})`}
            opacity={reveal.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] })}
          />
        ) : null}
        <AnimatedPath
          d={linePath}
          stroke={color}
          strokeWidth={2}
          fill="none"
          strokeDasharray={traceLen}
          strokeDashoffset={reveal.interpolate({
            inputRange: [0, 1],
            outputRange: [traceLen, 0],
          })}
        />

        {forecastPath ? (
          <AnimatedPath
            d={forecastPath}
            stroke={forecastColor}
            strokeWidth={2}
            strokeDasharray="5,4"
            fill="none"
            opacity={reveal.interpolate({
              inputRange: [0, 0.75, 1],
              outputRange: [0, 0, 1],
            })}
          />
        ) : null}
      </Svg>

      <View style={[styles.yAxis, { height: height - padT - padB, top: padT }]}>
        {[...gridValues].reverse().map((v, i) => (
          <Text key={i} style={styles.axisLabel}>
            {v.toFixed(0)}
            {unit}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: it.color }]} />
          <Text style={styles.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textFaint, fontSize: 12 },
  yAxis: {
    position: 'absolute',
    left: 0,
    width: 30,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  axisLabel: { color: colors.textFaint, fontSize: 9 },
  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 3, borderRadius: 2 },
  legendText: { color: colors.textDim, fontSize: 11 },
});
