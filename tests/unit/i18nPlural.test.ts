/**
 * i18n plural interpolation — the `{name|one|few|many}` pipe syntax.
 *
 * Root cause it pins: Branches' count summary rendered «1 удалённых» /
 * «2 тегов» (wrong RU agreement) because the flat-string t() had no plural
 * machinery. The pipe syntax is opt-in: en/zh/de dictionaries keep plain
 * `{name}` placeholders and MUST render byte-identically to the old engine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureLocale, useI18nStore, useI18n, t as tStandalone } from '../../src/lib/i18n';
import { renderHook } from '@testing-library/react';

/** ensureLocale is fire-and-forget (void) — the dict lands async and bumps dictVersion. */
const ensureRuLoaded = async () => {
  const before = useI18nStore.getState().dictVersion;
  ensureLocale('ru');
  useI18nStore.getState().setLocale('ru');
  await vi.waitFor(() => {
    if (useI18nStore.getState().dictVersion <= before && !useI18nStore.getState().dictVersion) {
      throw new Error('RU dictionary not loaded yet');
    }
  }, { timeout: 4000 });
};

describe('t() plural pipe interpolation', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
  });

  it('RU plural forms: 1 локальная · 2 локальные · 5 локальных · 11/12/21 edges', async () => {
    await ensureRuLoaded();
    const ru = (local: number, remote: number, tags: number, stashes: number) =>
      tStandalone('branches.countSummary', { local, remote, tags, stashes });
    // 1/1/1 — all singular forms
    expect(ru(1, 1, 1, 1)).toBe('1 локальная · 1 удалённая · 1 тег · 1 stash');
    // 2-4 — few forms
    expect(ru(2, 3, 4, 2)).toBe('2 локальные · 3 удалённые · 4 тега · 2 stash');
    // 5+ — many forms
    expect(ru(5, 11, 20, 5)).toBe('5 локальных · 11 удалённых · 20 тегов · 5 stash');
    // The 11-14 teens are «many» even though they end in 1-4
    expect(ru(11, 12, 14, 11)).toBe('11 локальных · 12 удалённых · 14 тегов · 11 stash');
    // 21 — «one» again
    expect(ru(21, 101, 21, 21)).toBe('21 локальная · 101 удалённая · 21 тег · 21 stash');
  });

  it('plain placeholders render byte-identically (no pipe = no behavior change)', async () => {
    // EN never uses the pipe — the whole EN dictionary path is unchanged.
    expect(tStandalone('tags.count', { count: 6 })).toBe('6 tags');
    // Multi-param plain placeholders still all replaced.
    await ensureLocale('en');
    expect(
      tStandalone('history.taggedChipOff', { inView: 4, total: 6 }),
    ).toBe(
      'Show only commits with a tag (release points). Tagged commits in the loaded history: 4; total tags in the repo: 6.',
    );
  });

  it('useI18n().t interpolates the same way (hook path shares the engine)', async () => {
    await ensureRuLoaded();
    const { result } = renderHook(() => useI18n());
    expect(
      result.current.t('branches.countSummary', { local: 1, remote: 2, tags: 5, stashes: 1 }),
    ).toBe('1 локальная · 2 удалённые · 5 тегов · 1 stash');
  });

  it('unknown placeholder names are left untouched (no cross-param leakage)', async () => {
    // {tag} must not eat {tags}: after the loop, any placeholder whose name
    // is not a param stays literal.
    expect(tStandalone('tags.count', {})).toBe('{count} tags');
    // A param used twice is replaced in every occurrence.
    expect(tStandalone('branches.countSummary', { local: 1, remote: 1, tags: 1, stashes: 0 }))
      .toBe('1 local · 1 remote · 1 tags · 0 stashes');
  });
});
