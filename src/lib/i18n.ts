/**
 * i18n — Internationalization system for PrismGit.
 *
 * Supports: English (en), Russian (ru), Chinese (zh), German (de).
 *
 * Usage in components:
 *   import { useI18n } from '../lib/i18n';
 *   const { t } = useI18n();
 *   <button>{t('changes.commit')}</button>
 *
 * Or outside components (stores, utils):
 *   import { t } from '../lib/i18n';
 *   toast.success(t('common.success'));
 */

import { create } from 'zustand';
import { en, loadLocaleDict } from '../i18n/locales';

export type Locale = 'en' | 'ru' | 'zh' | 'de';

export const LOCALES: { id: Locale; label: string; flag: string }[] = [
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
];

const translations: Partial<Record<Locale, Record<string, string>>> = {
  en,
  // ru/zh/de are loaded on demand (see ensureLocale) so the startup bundle
  // carries only the English fallback dictionary.
};

// --- Store ---

const STORAGE_KEY = 'prismgit-locale';

function getInitialLocale(): Locale {
  try {
    // Test/e2e override: launchApp sets PRISMGIT_LOCALE, exposed by the
    // preload — keeps existing English-text-based e2e assertions stable
    // regardless of the OS language.
    const envLocale = (typeof window !== 'undefined' && (window as { smartgit?: { app?: { envLocale?: string } } }).smartgit?.app?.envLocale) || '';
    if (envLocale && ['en', 'ru', 'zh', 'de'].includes(envLocale)) return envLocale as Locale;
    // Try localStorage first (synchronous, fast).
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && ['en', 'ru', 'zh', 'de'].includes(saved)) return saved;
    // Detect from navigator.language
    const nav = navigator.language.toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
    if (nav.startsWith('zh')) return 'zh';
    if (nav.startsWith('de')) return 'de';
    return 'en';
  } catch {
    return 'en';
  }
}

/**
 * Async locale init — reads the saved locale from the IPC-backed
 * settings store (persistent JSON file) and overrides the initial
 * localStorage-based detection. Called once on app startup.
 *
 * This is needed because getInitialLocale() is synchronous (called
 * during store creation), but the IPC settings store is async.
 * The settings store's appLanguage field is the authoritative source
 * — localStorage is a legacy fallback.
 */
export async function initLocaleFromSettings(): Promise<void> {
  try {
    const settings = (window as { smartgit?: { settings?: { getAll?: () => Promise<Record<string, unknown>> } } }).smartgit?.settings;
    if (!settings?.getAll) return;
    const all = await settings.getAll();
    const lang = all.appLanguage as string | undefined;
    if (lang && ['en', 'ru', 'zh', 'de'].includes(lang)) {
      const current = useI18nStore.getState().locale;
      // Only override if different from what localStorage detected.
      if (current !== lang) {
        useI18nStore.getState().setLocale(lang as Locale);
      }
    }
  } catch { /* ignore — keep the detected locale */ }
}

interface I18nState {
  locale: Locale;
  /** Bumped when a lazy dictionary finishes loading — triggers re-render. */
  dictVersion: number;
  setLocale: (locale: Locale) => void;
}

/**
 * Make sure the dictionary for `locale` is present. English is static;
 * ru/zh/de are dynamic chunks loaded once and cached. Safe to call repeatedly.
 */
export function ensureLocale(locale: Locale): void {
  if (translations[locale]) return;
  void loadLocaleDict(locale).then((dict) => {
    if (!dict) return;
    translations[locale] = dict;
    // Re-render every consumer: t() output changes now.
    useI18nStore.setState((s) => ({ dictVersion: s.dictVersion + 1 }));
  });
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: getInitialLocale(),
  dictVersion: 0,
  setLocale: (locale) => {
    // Save to localStorage (legacy, kept for backwards compat).
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
    // Save to the IPC-backed settings store (persistent JSON file in
    // userData). This is more reliable than localStorage which can be
    // unreliable in some Electron configurations.
    try {
      const settings = (window as { smartgit?: { settings?: { set?: (key: string, value: unknown) => Promise<void> } } }).smartgit?.settings;
      settings?.set?.('appLanguage', locale);
    } catch { /* ignore */ }
    ensureLocale(locale);
    syncDocumentLang(locale);
    set({ locale });
  },
}));

// Load the dictionary for the initial (saved/detected) locale if non-English.
ensureLocale(useI18nStore.getState().locale);

// Keep <html lang> in sync with the active locale. Chromium uses it for
// hyphenation dictionaries (globals.css: html[lang='ru'|'de'] { hyphens: auto }),
// locale-aware font fallback (Cyrillic/CJK glyph selection), and screen readers.
function syncDocumentLang(locale: Locale): void {
  try {
    if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
  } catch { /* not a DOM context (unit tests) — ignore */ }
}
syncDocumentLang(useI18nStore.getState().locale);

// --- Interpolation ---------------------------------------------------------

/**
 * Placeholder interpolation shared by useI18n().t and the standalone t().
 *
 * Plain placeholders work as before: `{name}` → the param value.
 *
 * PLURAL (opt-in, for counters): `{name|one|few|many}` picks a Russian-style
 * CLDR plural form for the value and renders `«value form»` (e.g. params
 * {local: 1} + `{local|локальная|локальные|локальных}` → «1 локальная»).
 * Dictionaries that do not inflect (en/zh/de) simply keep the plain
 * `{name}` syntax — their rendering is byte-identical to the old engine.
 * This exists because Branches' summary showed «1 удалённых» / «2 тегов»
 * (wrong RU grammar) with no way to fix it inside a flat string.
 */
function interpolate(str: string, params: Record<string, string | number>): string {
  for (const [k, v] of Object.entries(params)) {
    if (k === 'defaultValue') continue;
    // Matches {k} AND {k|form1|form2|form3}; the pipe part is optional so
    // strings without it keep the exact old behaviour. A longer placeholder
    // ({tags} vs param {tag}) still cannot match — after the name the next
    // char must be `}` or `|`.
    str = str.replace(
      new RegExp(`\\{${k}(\\|[^{}]*)?\\}`, 'g'),
      (whole: string, pipe?: string) => {
        if (pipe === undefined) return String(v);
        const forms = pipe.slice(1).split('|');
        const n = Math.abs(Number(v));
        const m10 = n % 10;
        const m100 = n % 100;
        const idx = (m10 === 1 && m100 !== 11) ? 0
          : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) ? 1
            : 2;
        const form = forms[Math.min(idx, forms.length - 1)] ?? '';
        return `${v} ${form}`.trimEnd();
      },
    );
  }
  return str;
}

// --- Hook (for React components) ---

export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  // Subscribe to dictVersion: when a lazy dictionary arrives, every component
  // using t() re-renders with the translated strings.
  useI18nStore((s) => s.dictVersion);

  const t = (key: string, params?: Record<string, string | number>): string => {
    let str = translations[locale]?.[key] ?? translations.en?.[key];
    if (str === undefined) {
      // Fallback: when the key isn't translated yet, prefer the caller-supplied
      // defaultValue (so new features ship in English until translations catch
      // up). Without this, missing keys returned the key itself ("pages.foo")
      // which looked broken even though the developer provided a default.
      str = (params as { defaultValue?: string } | undefined)?.defaultValue ?? key;
    }
    if (params) {
      str = interpolate(str, params);
    }
    return str;
  };

  return { t, locale, setLocale };
}

// --- Standalone t() for non-React contexts (stores, utils) ---

export function t(key: string, params?: Record<string, string | number>): string {
  const locale = useI18nStore.getState().locale;
  let str = translations[locale]?.[key] ?? translations.en?.[key];
  if (str === undefined) {
    str = (params as { defaultValue?: string } | undefined)?.defaultValue ?? key;
  }
  if (params) {
    str = interpolate(str, params);
  }
  return str;
}
