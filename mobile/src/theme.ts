/**
 * CloudPulse design tokens.
 *
 * Light "operations console" palette. Accent hues are deliberately the 600-700
 * steps rather than the bright 400s: on a white surface the lighter steps drop
 * below the WCAG AA 4.5:1 contrast floor, which matters here because every
 * accent is used for *text* (metric values, severity labels), not just fills.
 */
import { Easing } from 'react-native';

export const colors = {
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#E9EEF4',
  border: '#DDE4ED',

  text: '#0F172A',
  textDim: '#475569',
  textFaint: '#64748B',

  // Accents - all >= 4.5:1 against `surface`.
  cyan: '#0E7490',
  purple: '#6D28D9',
  green: '#15803D',
  amber: '#B45309',
  red: '#DC2626',
  blue: '#1D4ED8',
};

/**
 * Translucent variant of a token, for tinted backgrounds.
 * `alpha` is 0-1; colours must be 6-digit hex (all of ours are).
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Colour a utilisation percentage by severity. */
export function usageColor(value: number | null | undefined): string {
  if (value == null) return colors.textFaint;
  if (value >= 85) return colors.red;
  if (value >= 70) return colors.amber;
  return colors.green;
}

/** Colour for a K-Means usage level. */
export const levelColor: Record<string, string> = {
  Low: colors.green,
  Medium: colors.amber,
  High: colors.red,
};

export const severityColor: Record<string, string> = {
  critical: colors.red,
  warning: colors.amber,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

/**
 * Card elevation. A light theme cannot rely on a surface/background luminance
 * gap the way the dark one did, so cards need a real (soft) shadow to read as
 * raised instead of as flat panels.
 */
export const elevation = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
};

/**
 * Motion tokens. Kept in one place so entrance, gauge sweep and chart draw-on
 * all share a timing language instead of each picking its own numbers.
 */
export const motion = {
  fast: 180,
  base: 320,
  slow: 560,
  draw: 900,
  /** Per-item delay for staggered list/card entrances. */
  stagger: 70,
  /** Decelerate - things entering the screen. */
  entrance: Easing.bezier(0.22, 1, 0.36, 1),
  /** Standard ease-in-out - value changes, colour crossfades. */
  standard: Easing.bezier(0.4, 0, 0.2, 1),
};
