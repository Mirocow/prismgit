/**
 * Locale-aware date formatting helpers.
 *
 * QW-6: previously utils.formatDate returned English-only relative-time
 * strings ("just now", "5m ago", "yesterday", "2w ago", …) and
 * authorBadges.formatTime called date.toLocaleDateString('en-US', …)
 * — so non-English users still saw English dates.
 *
 * This module:
 *  - reads the current locale from useI18nStore (so plain functions,
 *    not just hooks, can be locale-aware without forcing every caller
 *    into a component);
 *  - returns translated relative-time strings ("5 мин назад", "вчера",
 *    "vor 2 Wochen", …);
 *  - delegates absolute-date formatting to Intl.DateTimeFormat with the
 *    correct BCP-47 tag (ru-RU / zh-CN / de-DE / en-US).
 *
 * The hook form (useRelativeDate / useAbsoluteDate) subscribes to
 * useI18nStore so components re-render when the locale changes.
 */

import { useCallback } from 'react';
import { useI18nStore, type Locale } from './i18n';
// 0.7 — dateFormat setting (Preferences → Appearance): 'relative' | 'absolute' | 'both'.
// The key existed in AppSettings with a full UI but ZERO consumers (dead setting).
import { useSettingsStore } from '../stores/settingsStore';

const BCP47: Record<Locale, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  zh: 'zh-CN',
  de: 'de-DE',
};

/**
 * Returns the active locale. Reads from the i18n store directly so
 * non-React callers (utilities, stores) can be locale-aware without
 * subscribing to re-renders.
 */
export function currentLocale(): Locale {
  return useI18nStore.getState().locale;
}

/**
 * Locale-aware relative-time formatter.
 *
 * @param dateStr ISO date string (from git log / commit author.date),
 *                 or anything new Date() can parse.
 * @param locale  Optional — defaults to the active locale.
 * @returns       Translated relative-time string, e.g. "5 мин назад",
 *                "вчера", "vor 2 Wochen", "1y ago".
 */
export function formatDate(dateStr: string, locale: Locale = currentLocale()): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const mins = Math.floor(diff / (1000 * 60));
      if (mins < 1) return relative('justNow', locale);
      return relative('minutesAgo', locale, { n: mins });
    }
    return relative('hoursAgo', locale, { n: hours });
  }
  if (days === 1) return relative('yesterday', locale);
  if (days < 7) return relative('daysAgo', locale, { n: days });
  if (days < 30) return relative('weeksAgo', locale, { n: Math.floor(days / 7) });
  if (days < 365) return relative('monthsAgo', locale, { n: Math.floor(days / 30) });
  return relative('yearsAgo', locale, { n: Math.floor(days / 365) });
}

/**
 * Locale-aware absolute-date formatter — for compact badges.
 *
 * @param dateStr  ISO date string or anything new Date() can parse.
 * @param locale   Optional — defaults to the active locale.
 * @param options  Intl options (defaults: month='short', day='numeric', year='numeric').
 * @returns        Localized absolute date string, e.g. "15 янв. 2024 г.",
 *                 "2024年1月15日", "15. Jan. 2024", "Jan 15, 2024".
 */
export function formatAbsoluteDate(
  dateStr: string,
  locale: Locale = currentLocale(),
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  try {
    return new Intl.DateTimeFormat(BCP47[locale], options).format(date);
  } catch {
    // Fall back to en-US if the runtime is missing a locale tag.
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
}

/**
 * Locale-aware time formatter — for compact timestamp badges (HH:MM:SS).
 */
export function formatTime(dateStr: string, locale: Locale = currentLocale()): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  try {
    return new Intl.DateTimeFormat(BCP47[locale], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  }
}

// --- dateFormat setting (Preferences → Appearance) — 0.7 ---

export type DateFormatMode = 'relative' | 'absolute' | 'both';

/**
 * Mode-aware date label driven by settings.dateFormat:
 *  - 'relative' — "5 мин назад" (default, previous behavior);
 *  - 'absolute' — "15 янв. 2024 г.";
 *  - 'both'     — "5 мин назад (15 янв. 2024 г.)".
 */
export function formatDateByMode(
  dateStr: string,
  mode: DateFormatMode = 'relative',
  locale: Locale = currentLocale()
): string {
  if (!dateStr) return '';
  const abs = () => formatAbsoluteDate(dateStr, locale, { year: 'numeric', month: 'short', day: 'numeric' });
  if (mode === 'absolute') return abs();
  const rel = formatDate(dateStr, locale);
  if (mode === 'both') return `${rel} (${abs()})`;
  return rel;
}

/**
 * Hook form — subscribes to settings.dateFormat so history lists re-render
 * immediately when the user switches the preference. Returns a stable-ish
 * formatter (recreated only when the mode changes).
 */
export function useDateFormatter(): (dateStr: string) => string {
  const mode = useSettingsStore((s) => s.settings.dateFormat) ?? 'relative';
  return useCallback((dateStr: string) => formatDateByMode(dateStr, mode), [mode]);
}

// --- Internal: relative-time translation table ---
type RelativeKey = 'justNow' | 'minutesAgo' | 'hoursAgo' | 'yesterday' | 'daysAgo' | 'weeksAgo' | 'monthsAgo' | 'yearsAgo';

const RELATIVE_STRINGS: Record<Locale, Record<RelativeKey, string>> = {
  en: {
    justNow: 'just now',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    yesterday: 'yesterday',
    daysAgo: '{n}d ago',
    weeksAgo: '{n}w ago',
    monthsAgo: '{n}mo ago',
    yearsAgo: '{n}y ago',
  },
  ru: {
    justNow: 'только что',
    minutesAgo: '{n} мин назад',
    hoursAgo: '{n} ч назад',
    yesterday: 'вчера',
    daysAgo: '{n} дн назад',
    weeksAgo: '{n} нед назад',
    monthsAgo: '{n} мес назад',
    yearsAgo: '{n} г назад',
  },
  zh: {
    justNow: '刚刚',
    minutesAgo: '{n} 分钟前',
    hoursAgo: '{n} 小时前',
    yesterday: '昨天',
    daysAgo: '{n} 天前',
    weeksAgo: '{n} 周前',
    monthsAgo: '{n} 个月前',
    yearsAgo: '{n} 年前',
  },
  de: {
    justNow: 'gerade eben',
    minutesAgo: 'vor {n} Min.',
    hoursAgo: 'vor {n} Std.',
    yesterday: 'gestern',
    daysAgo: 'vor {n} T.',
    weeksAgo: 'vor {n} Wo.',
    monthsAgo: 'vor {n} Mo.',
    yearsAgo: 'vor {n} J.',
  },
};

function relative(key: RelativeKey, locale: Locale, params?: Record<string, string | number>): string {
  let str = RELATIVE_STRINGS[locale]?.[key] ?? RELATIVE_STRINGS.en[key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}
