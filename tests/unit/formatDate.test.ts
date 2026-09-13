import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDate, formatAbsoluteDate, formatTime, currentLocale } from '../../src/lib/formatDate';
import { useI18nStore } from '../../src/lib/i18n';

// Mock the i18n module to a known state — date formatting depends on
// the active locale (ru/zh/de/en).
vi.mock('../../src/i18n/locales', () => ({
  en: {},
  loadLocaleDict: vi.fn().mockResolvedValue({}),
}));

describe('QW-6 formatDate helpers', () => {
  beforeEach(() => {
    useI18nStore.setState({ locale: 'en', dictVersion: 0 });
  });

  describe('formatDate (relative)', () => {
    it('returns empty string for empty input', () => {
      expect(formatDate('')).toBe('');
    });

    it('returns the original string for an unparseable date', () => {
      expect(formatDate('not-a-date')).toBe('not-a-date');
    });

    it('returns "just now" for a date in the last 59 seconds', () => {
      const justNow = new Date(Date.now() - 5_000).toISOString();
      expect(formatDate(justNow)).toBe('just now');
    });

    it('returns "Xm ago" for minutes', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatDate(fiveMinAgo)).toBe('5m ago');
    });

    it('returns "Xh ago" for hours', () => {
      const threeHrsAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
      expect(formatDate(threeHrsAgo)).toBe('3h ago');
    });

    it('returns "yesterday" for a 1-day-old date', () => {
      const yesterday = new Date(Date.now() - 24 * 3_600_000 - 60_000).toISOString();
      expect(formatDate(yesterday)).toBe('yesterday');
    });

    it('returns "Xd ago" for days', () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3_600_000).toISOString();
      expect(formatDate(fiveDaysAgo)).toBe('5d ago');
    });

    it('returns "Xw ago" for weeks', () => {
      const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 3_600_000).toISOString();
      expect(formatDate(threeWeeksAgo)).toBe('3w ago');
    });

    it('returns "Xmo ago" for months', () => {
      const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 3_600_000).toISOString();
      expect(formatDate(threeMonthsAgo)).toBe('3mo ago');
    });

    it('returns "Xy ago" for years', () => {
      const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 3_600_000).toISOString();
      expect(formatDate(fiveYearsAgo)).toBe('5y ago');
    });

    it('translates to Russian when locale=ru', () => {
      useI18nStore.setState({ locale: 'ru' });
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatDate(fiveMinAgo)).toBe('5 мин назад');
    });

    it('translates to Chinese when locale=zh', () => {
      useI18nStore.setState({ locale: 'zh' });
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatDate(fiveMinAgo)).toBe('5 分钟前');
    });

    it('translates to German when locale=de', () => {
      useI18nStore.setState({ locale: 'de' });
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatDate(fiveMinAgo)).toBe('vor 5 Min.');
    });

    it('honors explicit locale arg over active locale', () => {
      useI18nStore.setState({ locale: 'en' });
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatDate(fiveMinAgo, 'ru')).toBe('5 мин назад');
    });
  });

  describe('formatAbsoluteDate', () => {
    it('returns empty string for empty input', () => {
      expect(formatAbsoluteDate('')).toBe('');
    });

    it('returns a non-empty localized string for a valid date', () => {
      const dateStr = '2024-01-15T10:30:00Z';
      const result = formatAbsoluteDate(dateStr, 'en');
      expect(result).toContain('2024');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('uses ru-RU formatting for locale=ru', () => {
      const dateStr = '2024-01-15T10:30:00Z';
      const result = formatAbsoluteDate(dateStr, 'ru');
      // ru-RU renders the year inside dots / spaces.
      expect(result).toContain('2024');
      expect(result).toMatch(/янв/i);
    });

    it('uses zh-CN formatting for locale=zh', () => {
      const dateStr = '2024-01-15T10:30:00Z';
      const result = formatAbsoluteDate(dateStr, 'zh');
      expect(result).toContain('2024');
      expect(result).toContain('1'); // month=1
      expect(result).toContain('15');
    });
  });

  describe('formatTime', () => {
    it('returns empty string for empty input', () => {
      expect(formatTime('')).toBe('');
    });

    it('returns HH:MM:SS for a valid timestamp', () => {
      const dateStr = '2024-01-15T10:30:45Z';
      const result = formatTime(dateStr, 'en');
      // Result depends on timezone but should always contain 3 numeric groups.
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('currentLocale', () => {
    it('reads the active locale from useI18nStore', () => {
      useI18nStore.setState({ locale: 'de' });
      expect(currentLocale()).toBe('de');
    });
  });
});
