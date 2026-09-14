import { describe, it, expect } from 'vitest';
import { resolveAutoTheme } from '../../src/stores/settingsStore';
import { getThemeMeta, DEFAULT_THEME } from '../../src/lib/themes';

describe('resolveAutoTheme (4.2 — SmartGit auto light/dark)', () => {
  it('keeps the theme when its darkness already matches the system', () => {
    expect(resolveAutoTheme('light', false)).toBe('light');
    expect(resolveAutoTheme('dark', true)).toBe('dark');
    expect(resolveAutoTheme('github-dark', true)).toBe('github-dark');
    expect(resolveAutoTheme('dracula', true)).toBe('dracula');
  });

  it('switches to the paired variant of the same family', () => {
    expect(resolveAutoTheme('github-light', true)).toBe('github-dark');
    expect(resolveAutoTheme('github-dark', false)).toBe('github-light');
    expect(resolveAutoTheme('solarized-light', true)).toBe('solarized-dark');
    expect(resolveAutoTheme('solarized-dark', false)).toBe('solarized-light');
  });

  it('falls back to the generic dark theme when system is dark and no pair exists', () => {
    // dracula/monokai/tokyo-night have no light counterpart
    expect(resolveAutoTheme('dracula', false)).toBe(DEFAULT_THEME);
    expect(resolveAutoTheme('monokai', false)).toBe(DEFAULT_THEME);
  });

  it('falls back to dark when system is dark and the theme is unknown', () => {
    expect(resolveAutoTheme('no-such-theme', true)).toBe('dark');
    expect(resolveAutoTheme('no-such-theme', false)).toBe(DEFAULT_THEME);
  });

  it('result is always a registered theme with matching darkness', () => {
    for (const saved of ['light', 'dark', 'github-light', 'dracula', 'nord', 'unknown-x']) {
      for (const systemDark of [true, false]) {
        const resolved = resolveAutoTheme(saved, systemDark);
        const meta = getThemeMeta(resolved);
        expect(meta).toBeDefined();
        expect(meta!.isDark).toBe(systemDark);
      }
    }
  });
});
