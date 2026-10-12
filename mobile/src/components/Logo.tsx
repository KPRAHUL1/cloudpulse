/**
 * In-app CloudPulse mark + wordmark.
 *
 * Shares its geometry with assets/icon.svg. The launcher icon has to stay
 * legible at 48px so it carries the CP monogram only; here there is room for
 * the full name, so the word is set beside the mark.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { colors, motion, spacing } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The CP monogram tile on its own. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="logoTile" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.cyan} />
          <Stop offset="0.55" stopColor={colors.blue} />
          <Stop offset="1" stopColor={colors.purple} />
        </LinearGradient>
      </Defs>

      <Rect width={512} height={512} rx={116} fill="url(#logoTile)" />

      <Path
        d="M150 300a56 56 0 0 1 10-111 82 82 0 0 1 152-22 66 66 0 0 1 50 133z"
        fill="#FFFFFF"
        opacity={0.14}
      />

      {/* CP monogram */}
      <Path
        d="M255.6 147.3A74 74 0 1 0 255.6 260.7"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={34}
        strokeLinecap="round"
      />
      <Path d="M308 130V286" fill="none" stroke="#FFFFFF" strokeWidth={34} strokeLinecap="round" />
      <Path
        d="M308 130h26a40 40 0 0 1 0 80h-26"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={34}
        strokeLinecap="round"
      />

      {/* Pulse trace */}
      <Path
        d="M112 352h52l28-38 30 76 28-56 28 18h122"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={22}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Mark + "CloudPulse" wordmark, with the pulse trace drawing itself in once on
 * mount. strokeDashoffset is an SVG prop, so this is a JS-driven animation.
 */
export function Logo({ subtitle }: { subtitle?: string }) {
  const draw = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.timing(draw, {
      toValue: 0,
      duration: motion.draw,
      delay: 120,
      easing: motion.entrance,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [draw]);

  // Trace length is ~360 user units; 420 over-covers it so nothing peeks out.
  const TRACE = 420;

  return (
    <View style={styles.row}>
      <LogoMark size={34} />

      <View style={styles.words}>
        <View style={styles.titleRow}>
          <Text style={styles.cloud}>Cloud</Text>
          <Text style={styles.pulse}>Pulse</Text>
        </View>

        {/* Underline that redraws the ECG beat beneath the wordmark */}
        <Svg width={132} height={14} viewBox="0 0 300 30">
          <AnimatedPath
            d="M2 20h86l20-15 22 24 20-20 18 11h130"
            fill="none"
            stroke={colors.cyan}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={TRACE}
            strokeDashoffset={draw.interpolate({
              inputRange: [0, 1],
              outputRange: [0, TRACE],
            })}
          />
        </Svg>

        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  words: { justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'baseline' },
  cloud: { color: colors.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  pulse: { color: colors.cyan, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { color: colors.textFaint, fontSize: 11, marginTop: 1 },
});
