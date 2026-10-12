/**
 * Shared motion primitives, built on React Native's own Animated API.
 *
 * Deliberately no Reanimated: the app ships as an EAS dev-client build, and a
 * native dependency would force a rebuild/reinstall for every user. Everything
 * here is JS-driven and runs in the existing binary.
 *
 * Rule of thumb applied below: transforms and opacity use the native driver;
 * anything that drives an SVG prop or React state cannot, and says so.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ViewStyle } from 'react-native';

import { motion } from '../theme';

/**
 * Entrance animation: fades and lifts its children into place.
 * `index` staggers siblings so a screenful of cards cascades instead of
 * popping in as one slab.
 */
export function FadeInUp({
  children,
  index = 0,
  distance = 14,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  distance?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      delay: index * motion.stagger,
      easing: motion.entrance,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [index, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Animates a number towards `target` and returns the in-between value for
 * rendering as text.
 *
 * Text content is React state, so this cannot use the native driver. To keep
 * the cost down it only re-renders when the value changes at the precision
 * actually displayed (`decimals`) - roughly 10-20 renders per transition
 * instead of one per frame.
 */
export function useCountUp(
  target: number | null | undefined,
  { duration = motion.base, decimals = 1 }: { duration?: number; decimals?: number } = {}
): number | null {
  const value = useRef(new Animated.Value(typeof target === 'number' ? target : 0)).current;
  const [shown, setShown] = useState(typeof target === 'number' ? target : 0);
  const lastEmitted = useRef(shown);

  useEffect(() => {
    if (typeof target !== 'number' || !Number.isFinite(target)) return;

    const factor = 10 ** decimals;
    const id = value.addListener(({ value: v }) => {
      const rounded = Math.round(v * factor) / factor;
      if (rounded !== lastEmitted.current) {
        lastEmitted.current = rounded;
        setShown(rounded);
      }
    });

    const anim = Animated.timing(value, {
      toValue: target,
      duration,
      easing: motion.standard,
      useNativeDriver: false,
    });
    anim.start();

    return () => {
      anim.stop();
      value.removeListener(id);
    };
  }, [target, duration, decimals, value]);

  return typeof target === 'number' ? shown : null;
}

/**
 * An Animated.Value that eases to `target` whenever it changes.
 * For driving SVG props (gauge sweep, chart reveal), hence no native driver.
 */
export function useAnimatedValue(target: number, duration = motion.slow): Animated.Value {
  const value = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    const anim = Animated.timing(value, {
      toValue: Number.isFinite(target) ? target : 0,
      duration,
      easing: motion.standard,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [target, duration, value]);

  return value;
}

/** Soft looping halo, used on the "live" indicator to signal active polling. */
export function Pulse({
  children,
  active = true,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  style?: ViewStyle | ViewStyle[];
}) {
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, {
          toValue: 1,
          duration: 900,
          easing: motion.standard,
          useNativeDriver: true,
        }),
        Animated.timing(beat, {
          toValue: 0,
          duration: 900,
          easing: motion.standard,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, beat]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
          transform: [
            { scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Pressable that dips slightly on touch - cheap tactile feedback. */
export function PressScale({
  children,
  onPress,
  style,
  to = 0.94,
  accessibilityLabel,
  accessibilityState,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  to?: number;
  accessibilityLabel?: string;
  accessibilityState?: { selected?: boolean };
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const spring = (toValue: number) =>
    Animated.spring(scale, {
      toValue,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => spring(to)}
      onPressOut={() => spring(1)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={style}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}
