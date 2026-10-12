import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, withAlpha } from '../theme';
import { Pulse } from './anim';

export function StatusPill({
  label,
  color,
  dim = false,
  pulse = false,
}: {
  label: string;
  color: string;
  dim?: boolean;
  /** Beat the dot, to signal that the value behind it is actively updating. */
  pulse?: boolean;
}) {
  const dot = <View style={[styles.dot, { backgroundColor: color }]} />;

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: dim ? 'transparent' : withAlpha(color, 0.12),
          borderColor: color,
        },
      ]}
    >
      {pulse ? <Pulse>{dot}</Pulse> : dot}
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
});
