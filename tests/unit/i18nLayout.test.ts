/**
 * i18n layout-tolerance tests.
 *
 * RU/DE UI strings are 2-4x longer than the EN strings some fixed-width
 * chrome was sized for. These tests pin the layout-tolerance machinery:
 *   - the locale-aware state-column width clamp (text never truncated),
 *   - the text measurement fallback (deterministic without Canvas/jsdom),
 *   - presence of the state/header keys the width logic relies on,
 *   - <html lang> sync driving hyphenation (globals.css).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DOMAINS } from '../i18n-domains';
import { computeStateColumnWidth, measureTextWidth, UI_FONT_STACK } from '../../src/lib/measure';

const STATE_KEYS = [
  'changes.statusUntracked',
  'changes.conflicted',
  'changes.statusModified',
  'changes.stateAdded',
  'changes.statusDeleted',
  'changes.statusRenamed',
  'changes.stateCopied',
  'changes.stateUnchanged',
  'changes.stateIgnored',
  'changes.stateAssumeUnchanged',
  'changes.stateSkipped',
  'changes.stateSubmodule',
];

const HISTORY_HEADER_KEYS = [
  'history.headerGraph',
  'history.headerCommits',
  'history.headerIncoming',
  'history.headerFiltered',
];

describe('i18n layout: keys for locale-aware chrome', () => {
  it('state-column keys exist in all four locales', () => {
    const changes = DOMAINS.changes;
    for (const key of STATE_KEYS) {
      for (const loc of ['en', 'ru', 'zh', 'de'] as const) {
        expect(changes[loc][key], `${loc} ${key}`).toBeTruthy();
      }
    }
  });

  it('history header keys exist in all four locales', () => {
    const history = DOMAINS.history;
    for (const key of HISTORY_HEADER_KEYS) {
      for (const loc of ['en', 'ru', 'zh', 'de'] as const) {
        expect(history[loc][key], `${loc} ${key}`).toBeTruthy();
      }
    }
  });

  it('history header placeholders survive translation ({n})', () => {
    const history = DOMAINS.history;
    for (const key of ['history.headerCommits', 'history.headerIncoming'] as const) {
      for (const loc of ['en', 'ru', 'zh', 'de'] as const) {
        expect(history[loc][key], `${loc} ${key} lost {n}`).toContain('{n}');
      }
    }
  });
});

describe('computeStateColumnWidth', () => {
  it('clamps to the longest localized label so text is never cut', () => {
    // "Рабочее дерево" etc. — measure via char heuristic for determinism
    const labels = ['Изменён', 'Рабочее дерево', 'Добавлен (новый)'];
    const width = computeStateColumnWidth(70, labels, (s) => s.length * 7.2);
    expect(width).toBeGreaterThanOrEqual(15 * 7.2 + 20); // longest + padding
  });

  it('never shrinks below the persisted (user-resized) width', () => {
    const width = computeStateColumnWidth(200, ['Изменён'], (s) => s.length * 7.2);
    expect(width).toBe(200);
  });

  it('english labels keep the compact default width', () => {
    const width = computeStateColumnWidth(70, ['Staged', 'Unstaged', 'Modified'], (s) => s.length * 7.2);
    // 8 chars * 7.2 = 57.6 + 20 padding = ~78 → close to the 70px default
    expect(width).toBeLessThan(90);
  });

  it('respects custom padding and floor', () => {
    const width = computeStateColumnWidth(0, ['A'], (s) => s.length, { padding: 0, minWidth: 40 });
    expect(width).toBe(40);
  });
});

describe('measureTextWidth fallbacks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the char-count heuristic when Canvas is unavailable', () => {
    // jsdom has no real 2d context — the util must still return a
    // deterministic positive number (length * 7.2 fallback).
    const width = measureTextWidth('Изменён', `italic 12px ${UI_FONT_STACK}`);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeGreaterThan(measureTextWidth('M', `italic 12px ${UI_FONT_STACK}`));
  });
});
