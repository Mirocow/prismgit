/**
 * i18n dictionary parity tests.
 *
 * The app falls back to English when a key is missing in the active locale,
 * but the requirement is full parity: every key must exist in ALL FOUR
 * locales (en/ru/zh/de) with a non-empty translation.
 */
import { describe, it, expect } from 'vitest';
import { DOMAINS } from '../../src/i18n/locales';

/** Merged per-locale dictionaries built from core + all domains. */
function merged(loc: 'en' | 'ru' | 'zh' | 'de'): Record<string, string> {
  return Object.values(DOMAINS).reduce((acc, d) => ({ ...acc, ...d[loc] }), {});
}

const LOCALES = {
  en: merged('en'),
  ru: merged('ru'),
  zh: merged('zh'),
  de: merged('de'),
};

describe('i18n dictionary parity', () => {
  it('every domain has identical key sets across all four locales', () => {
    for (const [name, domain] of Object.entries(DOMAINS)) {
      const enKeys = Object.keys(domain.en).sort();
      for (const loc of ['ru', 'zh', 'de'] as const) {
        const keys = Object.keys(domain[loc]).sort();
        expect(keys, `domain "${name}": locale "${loc}" key set differs from en`).toEqual(enKeys);
      }
    }
  });

  it('merged dictionaries have identical key sets across all four locales', () => {
    const enKeys = Object.keys(LOCALES.en).sort();
    expect(Object.keys(LOCALES.ru).sort()).toEqual(enKeys);
    expect(Object.keys(LOCALES.zh).sort()).toEqual(enKeys);
    expect(Object.keys(LOCALES.de).sort()).toEqual(enKeys);
  });

  it('no dictionary value is empty', () => {
    for (const [name, domain] of Object.entries(DOMAINS)) {
      for (const loc of ['en', 'ru', 'zh', 'de'] as const) {
        for (const [key, value] of Object.entries(domain[loc])) {
          expect(value?.trim().length ?? 0, `domain "${name}" ${loc} "${key}" is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('aggregated async locale modules match the merged dictionaries', async () => {
    const ruMod = await import('../../src/i18n/locales/aggregated/ru');
    const zhMod = await import('../../src/i18n/locales/aggregated/zh');
    const deMod = await import('../../src/i18n/locales/aggregated/de');
    expect(Object.keys(ruMod.ru).sort()).toEqual(Object.keys(LOCALES.en).sort());
    expect(Object.keys(zhMod.zh).sort()).toEqual(Object.keys(LOCALES.en).sort());
    expect(Object.keys(deMod.de).sort()).toEqual(Object.keys(LOCALES.en).sort());
  });

  it('critical app-wide keys exist', () => {
    for (const key of [
      'common.ok',
      'common.cancel',
      'nav.changes',
      'nav.history',
      'settings.language',
      'vscode.openInVscode',
      'vscode.openDiffInVscode',
      'vscode.resolveInVscode',
      'vscode.settings.registerDiffTool',
    ]) {
      for (const [loc, dict] of Object.entries(LOCALES)) {
        expect(dict[key], `key "${key}" missing in "${loc}"`).toBeDefined();
      }
    }
  });

  it('t() parameter interpolation works', async () => {
    const { t } = await import('../../src/lib/i18n');
    // Uses the English fallback chain — {count} must be replaced.
    expect(t('history.commits', { count: 7 })).toContain('7');
  });
});
