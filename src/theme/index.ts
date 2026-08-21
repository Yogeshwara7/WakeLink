/**
 * WakeLink design tokens — single source of truth for all colours,
 * spacing, typography, and radius values.
 *
 * The app uses a dark-first palette.  Screens should import from here
 * rather than hardcoding hex values.
 */

export const Colors = {
  // Backgrounds
  bg: '#0d0d0d',
  bgCard: '#161616',
  bgElevated: '#1e1e1e',
  bgInput: '#222222',

  // Brand
  brand: '#3b82f6',       // blue-500
  brandDim: '#1d4ed8',    // blue-700

  // Status colours
  online: '#22c55e',      // green-500
  offline: '#6b7280',     // gray-500
  waking: '#f59e0b',      // amber-500
  connecting: '#3b82f6',  // blue-500
  connected: '#22c55e',   // green-500
  unknown: '#6b7280',

  // Text
  textPrimary: '#f9fafb',   // gray-50
  textSecondary: '#9ca3af', // gray-400
  textMuted: '#4b5563',     // gray-600
  textInverse: '#0d0d0d',

  // Borders
  border: '#2a2a2a',
  borderFocus: '#3b82f6',

  // Destructive
  danger: '#ef4444',
  dangerDim: '#7f1d1d',

  // Overlay
  overlay: 'rgba(0,0,0,0.6)',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 6,
  md: 12,
  lg: 18,
  full: 9999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  xxxl: 34,
} as const;

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
