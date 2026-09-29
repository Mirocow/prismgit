import { describe, it, expect } from 'vitest';
import { resolveAutoTheme } from '../../src/stores/settingsStore';
import { getThemeMeta, DEFAULT_THEME } from '../../src/lib/themes';

describe('resolveAutoTheme (4.2 — SmartGit auto light/dark)', () => {
  it('keeps the theme when its darkness already matches the system', () => {
    expect(resolveAutoTheme('light', false)).toBe('light');
    expect(resolveAutoTheme('one-dark', true)).toBe('one-dark');
    expect(resolveAutoTheme('discord', true)).toBe('discord');
    expect(resolveAutoTheme('material', false)).toBe('material');
  });

  it('flips across the curated poles (light ↔ one-dark) when darkness mismatches', () => {
    // Curation: the family pairing (github-light ↔ github-dark, …) is gone;
    // the auto pair is the default poles.
    expect(resolveAutoTheme('light', true)).toBe('one-dark');
    expect(resolveAutoTheme('one-dark', false)).toBe('light');
    expect(resolveAutoTheme('discord', false)).toBe('light');
    expect(resolveAutoTheme('simple-light', true)).toBe('one-dark');
    expect(resolveAutoTheme('light-dim-sidebar', true)).toBe('one-dark');
  });

  it('keeps custom themes as-is in auto mode (they are single-palette)', () => {
    expect(resolveAutoTheme('custom-abc', true)).toBe('custom-abc');
    expect(resolveAutoTheme('custom-abc', false)).toBe('custom-abc');
  });

  it('falls back to the poles when the theme is unknown', () => {
    expect(resolveAutoTheme('no-such-theme', true)).toBe('one-dark');
    expect(resolveAutoTheme('no-such-theme', false)).toBe(DEFAULT_THEME);
  });

  it('migrated legacy ids resolve like their curated replacement (dark → one-dark)', () => {
    expect(resolveAutoTheme('dark', true)).toBe('one-dark');
    expect(resolveAutoTheme('dracula', false)).toBe('light');
  });

  it('result is always a registered theme with matching darkness (custom aside)', () => {
    for (const saved of ['light', 'one-dark', 'discord', 'material', 'unknown-x']) {
      for (const systemDark of [true, false]) {
        const resolved = resolveAutoTheme(saved, systemDark);
        const meta = getThemeMeta(resolved);
        expect(meta).toBeDefined();
        expect(meta!.isDark).toBe(systemDark);
      }
    }
  });
});
