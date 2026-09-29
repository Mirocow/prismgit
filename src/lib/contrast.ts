/**
 * UI-contrast computation — pure functions, no DOM access.
 *
 * BUGFIX "тёмные темы не адаптированы + разделители слишком яркие":
 * the old applyContrastToDOM() (settingsStore) blended colors it read from
 * getComputedStyle() — which INCLUDES the inline overrides it had written
 * on the previous call. Two consequences:
 *   1. Every slider tick re-blended the ALREADY blended colors → the values
 *      marched toward white (dark themes) / black (light themes).
 *   2. Switching themes never recomputed the overrides, so the previous
 *      theme's blended --border-* kept overriding the new [data-theme]
 *      block → dark themes rendered with light-gray separators.
 *
 * The fix: this module is PURE — the caller always feeds the ACTIVE
 * THEME's base token values (applyContrastToDOM removes its own inline
 * overrides before reading them) and applies whatever comes back.
 */

export const CONTRAST_TOKENS = [
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'borderDefault',
  'borderSubtle',
  'borderStrong',
] as const;

export type ContrastToken = (typeof CONTRAST_TOKENS)[number];

/** CSS custom-property name for a token (e.g. borderDefault → --border-default). */
export function cssVarName(token: ContrastToken): string {
  return `--${token.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
}

export interface ContrastInputs {
  /** 50..150; 100 = neutral (no overrides). */
  contrast: number;
  isDark: boolean;
  /** Base token colors of the ACTIVE theme (hex #rrggbb). */
  colors: Partial<Record<ContrastToken, string>>;
  /** --bg-primary of the active theme — the low-contrast fade target. */
  bgPrimary?: string;
}

export type ContrastOverrides = Partial<Record<ContrastToken, string>>;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Blend `hex` toward `target` by ratio (0 = unchanged, 1 = target). */
export function blendToward(hex: string, target: [number, number, number], ratio: number): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return rgbToHex(r + (target[0] - r) * ratio, g + (target[1] - g) * ratio, b + (target[2] - b) * ratio);
}

/** Fallback --bg-primary values (Ayu) used when the caller can't read one. */
const FALLBACK_BG = { dark: '#0b0e14', light: '#f7f8fa' } as const;

/**
 * Compute the inline overrides for a contrast setting.
 *
 *   contrast > 100 → text/borders move AWAY from the background
 *                   (toward white in dark themes, black in light ones)
 *   contrast < 100 → text/borders FADE toward the background
 *   contrast = 100 → {} (caller removes any previous overrides)
 *
 * Non-hex token values (e.g. rgba() strings, empty strings) are skipped —
 * same behavior as the previous implementation.
 */
export function computeContrastOverrides(inputs: ContrastInputs): ContrastOverrides {
  const clamped = Math.max(50, Math.min(150, inputs.contrast));
  if (clamped === 100) return {};

  const shift = Math.abs(clamped - 100) / 100; // 0.0 .. 0.5
  const extreme: [number, number, number] = inputs.isDark ? [255, 255, 255] : [0, 0, 0];
  const bgRgb = hexToRgb(inputs.bgPrimary ?? '') ?? hexToRgb(inputs.isDark ? FALLBACK_BG.dark : FALLBACK_BG.light)!;
  const target = clamped > 100 ? extreme : bgRgb;

  const out: ContrastOverrides = {};
  for (const token of CONTRAST_TOKENS) {
    const base = inputs.colors[token];
    if (!base) continue;
    const blended = blendToward(base, target, shift);
    if (blended) out[token] = blended;
  }
  return out;
}
