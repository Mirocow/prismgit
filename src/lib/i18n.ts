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
import { en } from '../i18n/locales/en';
import { ru } from '../i18n/locales/ru';
import { zh } from '../i18n/locales/zh';
import { de } from '../i18n/locales/de';

export type Locale = 'en' | 'ru' | 'zh' | 'de';

export const LOCALES: { id: Locale; label: string; flag: string }[] = [
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪' },
];

const translations: Record<Locale, Record<string, string>> = {
  en,
  ru,
  zh,
  de,
};

// --- Store ---

const STORAGE_KEY = 'prismgit-locale';

function getInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && translations[saved]) return saved;
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
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: getInitialLocale(),
  setLocale: (locale) => {
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
    set({ locale });
  },
}));

// --- Hook (for React components) ---

export function useI18n() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

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
