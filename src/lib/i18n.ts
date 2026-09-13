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
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
    ensureLocale(locale);
    set({ locale });
  },
}));

// Load the dictionary for the initial (saved/detected) locale if non-English.
ensureLocale(useI18nStore.getState().locale);

// --- Hook (for React components) ---

export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  // Subscribe to dictVersion: when a lazy dictionary arrives, every component
  // using t() re-renders with the translated strings.
  useI18nStore((s) => s.dictVersion);

  const t = (key: string, params?: Record<string, string | number>): string => {
    let str = translations[locale]?.[key] ?? translations.en?.[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  };

  return { t, locale, setLocale };
}

// --- Standalone t() for non-React contexts (stores, utils) ---

export function t(key: string, params?: Record<string, string | number>): string {
  const locale = useI18nStore.getState().locale;
  let str = translations[locale]?.[key] ?? translations.en?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}
