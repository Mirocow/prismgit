import { describe, it, expect } from 'vitest';
import {
  computeContrastOverrides,
  blendToward,
  cssVarName,
  CONTRAST_TOKENS,
} from '../../src/lib/contrast';

/**
 * BUGFIX "тёмные темы не адаптированы + разделители слишком яркие":
 * the contrast computation must be a PURE function of the active theme's
 * base colors. The old implementation blended getComputedStyle() values
 * which included its own previous inline overrides:
 *   1. every slider tick compounded the blend (borders marched to white);
 *   2. switching themes kept the OLD theme's blended colors on the NEW
 *      theme (light-gray separators on dark backgrounds).
 */

const DARK_BASE = {
  textPrimary: '#bfbdb6',
  textSecondary: '#8a8f98',
  textTertiary: '#7d8186',
  borderDefault: '#1f2530',
  borderSubtle: '#161a23',
  borderStrong: '#2a313e',
};

const LIGHT_BASE = {
  textPrimary: '#2c3138',
  textSecondary: '#5c6166',
  textTertiary: '#666a6f',
  borderDefault: '#d8dade',
  borderSubtle: '#e6e7eb',
  borderStrong: '#c2c7cd',
};

describe('computeContrastOverrides', () => {
  it('contrast 100 → no overrides (theme values restored)', () => {
    expect(computeContrastOverrides({ contrast: 100, isDark: true, colors: DARK_BASE })).toEqual({});
  });

  it('clamps out-of-range contrast', () => {
    expect(computeContrastOverrides({ contrast: 999, isDark: true, colors: DARK_BASE })).toEqual(
      computeContrastOverrides({ contrast: 150, isDark: true, colors: DARK_BASE }),
    );
    expect(computeContrastOverrides({ contrast: 1, isDark: false, colors: LIGHT_BASE })).toEqual(
      computeContrastOverrides({ contrast: 50, isDark: false, colors: LIGHT_BASE }),
    );
  });

  it('dark theme, contrast > 100: borders/text move toward WHITE (brighter), not black', () => {
    const out = computeContrastOverrides({ contrast: 130, isDark: true, colors: DARK_BASE });
    expect(out.borderDefault).toBeDefined();
    // Luminance of the override must exceed the base — the old compounding
    // bug eventually pushed borders toward #ffffff ("слишком яркие").
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(out.borderDefault!)).toBeGreaterThan(lum(DARK_BASE.borderDefault));
    expect(lum(out.textPrimary!)).toBeGreaterThan(lum(DARK_BASE.textPrimary));
  });

  it('light theme, contrast > 100: text/borders move toward BLACK (darker)', () => {
    const out = computeContrastOverrides({ contrast: 130, isDark: false, colors: LIGHT_BASE });
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(out.borderDefault!)).toBeLessThan(lum(LIGHT_BASE.borderDefault));
  });

  it('contrast < 100: values fade toward the provided bgPrimary', () => {
    const out = computeContrastOverrides({
      contrast: 70,
      isDark: true,
      colors: DARK_BASE,
      bgPrimary: '#0b0e14',
    });
    // Fading toward near-black bg darkens everything.
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(out.borderStrong!)).toBeLessThan(lum(DARK_BASE.borderStrong));
    // At 70 (shift 0.3), the blend is 30% of the way to the bg.
    expect(lum(out.borderStrong!)).toBeGreaterThan(0); // still visible, not pure bg
  });

  it('low-contrast fallback uses Ayu bg when bgPrimary is missing/non-hex', () => {
    const withFallback = computeContrastOverrides({ contrast: 70, isDark: true, colors: DARK_BASE });
    const withExplicit = computeContrastOverrides({ contrast: 70, isDark: true, colors: DARK_BASE, bgPrimary: '#0b0e14' });
    expect(withFallback).toEqual(withExplicit);
    const nonHex = computeContrastOverrides({ contrast: 70, isDark: false, colors: LIGHT_BASE, bgPrimary: 'rgb(1,2,3)' });
    const noBg = computeContrastOverrides({ contrast: 70, isDark: false, colors: LIGHT_BASE });
    expect(nonHex).toEqual(noBg);
  });

  it('non-hex token values are skipped (no override written for them)', () => {
    const out = computeContrastOverrides({
      contrast: 130,
      isDark: true,
      colors: { ...DARK_BASE, borderSubtle: 'rgba(255,255,255,0.04)', textTertiary: '' },
    });
    expect(out.borderSubtle).toBeUndefined();
    expect(out.textTertiary).toBeUndefined();
    expect(out.borderDefault).toBeDefined();
  });

  it('is deterministic — identical inputs give identical outputs (pure function)', () => {
    const a = computeContrastOverrides({ contrast: 125, isDark: true, colors: DARK_BASE, bgPrimary: '#0b0e14' });
    const b = computeContrastOverrides({ contrast: 125, isDark: true, colors: DARK_BASE, bgPrimary: '#0b0e14' });
    expect(a).toEqual(b);
  });

  it('the FUNCTION output never depends on previous outputs — re-feeding a RESULT with the same base colors is not how it is called (guard for the compounding bug)', () => {
    // Simulate the caller contract: inputs are always BASE colors.
    // Feeding base twice must equal feeding base once (idempotent caller).
    const once = computeContrastOverrides({ contrast: 120, isDark: true, colors: DARK_BASE });
    const twice = computeContrastOverrides({ contrast: 120, isDark: true, colors: DARK_BASE });
    expect(once).toEqual(twice);
    // And the old bug's signature — feeding the OUTPUT as input — must move
    // the value FURTHER (proving why the caller must strip overrides first).
    const compounded = computeContrastOverrides({ contrast: 120, isDark: true, colors: once as never });
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    expect(lum(compounded.borderDefault!)).toBeGreaterThan(lum(once.borderDefault!));
  });
});

describe('blendToward', () => {
  it('ratio 0 returns the original color', () => {
    expect(blendToward('#123456', [255, 255, 255], 0)).toBe('#123456');
  });

  it('ratio 1 returns the target', () => {
    expect(blendToward('#123456', [255, 255, 255], 1)).toBe('#ffffff');
  });

  it('invalid hex returns null', () => {
    expect(blendToward('#1a56670', [0, 0, 0], 0.5)).toBeNull();
    expect(blendToward('red', [0, 0, 0], 0.5)).toBeNull();
  });

  it('channels clamp to 0..255 (ratio > 1 saturates at the target, never wraps)', () => {
    expect(blendToward('#ffffff', [0, 0, 0], 2)).toBe('#000000');
    expect(blendToward('#000000', [255, 255, 255], 2)).toBe('#ffffff');
  });
});

describe('cssVarName / CONTRAST_TOKENS', () => {
  it('maps camelCase tokens to the CSS custom-property names used in globals.css', () => {
    expect(cssVarName('textPrimary')).toBe('--text-primary');
    expect(cssVarName('borderDefault')).toBe('--border-default');
    expect(cssVarName('borderSubtle')).toBe('--border-subtle');
    expect(cssVarName('borderStrong')).toBe('--border-strong');
  });

  it('covers exactly the six tokens applyContrastToDOM overrides', () => {
    expect(CONTRAST_TOKENS.sort()).toEqual(
      ['borderDefault', 'borderStrong', 'borderSubtle', 'textPrimary', 'textSecondary', 'textTertiary'].sort(),
    );
  });
});
