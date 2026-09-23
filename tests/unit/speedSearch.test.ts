/**
 * Unit tests for src/lib/speedSearch.ts — SmartGit-style speed search.
 *
 * Covers:
 *   - useSpeedSearch: query accumulation, backspace/escape handling,
 *     navigation callbacks, input-field isolation, modifier-combo skip,
 *     reset-after-inactivity, max query length
 *   - highlightSpeedSearch: segment splitting with match flags
 *   - findSpeedSearchMatch: wrap-around matching, case-insensitivity
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSpeedSearch,
  highlightSpeedSearch,
  findSpeedSearchMatch,
} from '../../src/lib/speedSearch';

/** Fire a real KeyboardEvent at the element the hook registered. */
function keyDown(el: HTMLElement, key: string, opts: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
}

describe('useSpeedSearch', () => {
  function setup(options = {}) {
    const onNavigate = vi.fn();
    const onHome = vi.fn();
    const onEnd = vi.fn();
    const hook = renderHook(() => useSpeedSearch<HTMLDivElement>({ onNavigate, onHome, onEnd, ...options }));
    const el = document.createElement('div');
    // The hook needs a tabIndex-free plain div; focus isn't required —
    // dispatchEvent triggers the listener regardless.
    document.body.appendChild(el);
    act(() => {
      hook.result.current.registerTarget(el);
    });
    return { hook, el, onNavigate, onHome, onEnd, unmount: () => { hook.unmount(); el.remove(); } };
  }

  it('accumulates printable characters into the query', () => {
    const { hook, el } = setup();
    act(() => { keyDown(el, 'f'); keyDown(el, 'i'); keyDown(el, 'x'); });
    expect(hook.result.current.query).toBe('fix');
  });

  it('Backspace removes the last character', () => {
    const { hook, el } = setup();
    act(() => { keyDown(el, 'a'); keyDown(el, 'b'); keyDown(el, 'c'); });
    act(() => { keyDown(el, 'Backspace'); });
    expect(hook.result.current.query).toBe('ab');
  });

  it('Escape clears the whole query', () => {
    const { hook, el } = setup();
    act(() => { keyDown(el, 'h'); keyDown(el, 'i'); });
    act(() => { keyDown(el, 'Escape'); });
    expect(hook.result.current.query).toBe('');
  });

  it('ArrowUp/ArrowDown call onNavigate without touching the query', () => {
    const { hook, el, onNavigate } = setup();
    act(() => { keyDown(el, 'g'); keyDown(el, 'ArrowDown'); });
    expect(hook.result.current.query).toBe('g');
    expect(onNavigate).toHaveBeenCalledWith(1);
    act(() => { keyDown(el, 'ArrowUp'); });
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it('Home/End call onHome/onEnd', () => {
    const { el, onHome, onEnd } = setup();
    act(() => { keyDown(el, 'Home'); });
    expect(onHome).toHaveBeenCalledTimes(1);
    act(() => { keyDown(el, 'End'); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ignores keystrokes when an input is focused', () => {
    const { hook } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    });
    expect(hook.result.current.query).toBe('');
    input.remove();
  });

  it('ignores modifier combos (Ctrl/Cmd/Alt)', () => {
    const { hook, el } = setup();
    act(() => {
      keyDown(el, 'k', { ctrlKey: true });
      keyDown(el, 'k', { metaKey: true });
      keyDown(el, 'k', { altKey: true });
    });
    expect(hook.result.current.query).toBe('');
  });

  it('ignores configured ignoreKeys (default: Tab, Enter)', () => {
    const { hook, el } = setup();
    act(() => { keyDown(el, 'Tab'); keyDown(el, 'Enter'); });
    expect(hook.result.current.query).toBe('');
  });

  it('caps the query at 64 characters', () => {
    const { hook, el } = setup();
    act(() => {
      for (let i = 0; i < 70; i++) keyDown(el, 'x');
    });
    expect(hook.result.current.query).toHaveLength(64);
  });

  it('clears the query after the reset delay', () => {
    vi.useFakeTimers();
    try {
      const { hook, el } = setup({ resetDelay: 1000 });
      act(() => { keyDown(el, 'a'); });
      expect(hook.result.current.query).toBe('a');
      act(() => { vi.advanceTimersByTime(1100); });
      expect(hook.result.current.query).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('setQuery is exposed for programmatic control', () => {
    const { hook } = setup();
    act(() => { hook.result.current.setQuery('manual'); });
    expect(hook.result.current.query).toBe('manual');
  });
});

describe('highlightSpeedSearch', () => {
  it('returns one unmatched segment for an empty query', () => {
    expect(highlightSpeedSearch('anything', '')).toEqual([{ text: 'anything', match: false }]);
  });

  it('splits a string around all case-insensitive matches', () => {
    const segs = highlightSpeedSearch('Fix the fix in fixes', 'fix');
    // NB: no leading empty segment — the impl only emits a pre-match
    // segment when it has length > 0.
    expect(segs).toEqual([
      { text: 'Fix', match: true },
      { text: ' the ', match: false },
      { text: 'fix', match: true },
      { text: ' in ', match: false },
      { text: 'fix', match: true },
      { text: 'es', match: false },
    ]);
  });

  it('returns a single matched segment when the whole text matches', () => {
    expect(highlightSpeedSearch('FIX', 'fix')).toEqual([{ text: 'FIX', match: true }]);
  });

  it('returns the text unmatched when the query is absent', () => {
    expect(highlightSpeedSearch('abc', 'zzz')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('findSpeedSearchMatch', () => {
  const items = ['main', 'feature/alpha', 'feature/beta', 'release'];

  it('finds the first substring match from the start', () => {
    expect(findSpeedSearchMatch(items, 'feat', (s) => s)).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(findSpeedSearchMatch(['Alpha', 'Beta'], 'beta', (s) => s)).toBe(1);
  });

  it('wraps around from startIndex', () => {
    // Start at index 2 — 'main' is only reachable via wrap-around.
    expect(findSpeedSearchMatch(items, 'main', (s) => s, 2)).toBe(0);
  });

  it('returns -1 for an empty query or no match', () => {
    expect(findSpeedSearchMatch(items, '', (s) => s)).toBe(-1);
    expect(findSpeedSearchMatch(items, 'zzz', (s) => s)).toBe(-1);
  });

  it('supports custom getText projections', () => {
    const objs = [{ n: 'one' }, { n: 'two' }];
    expect(findSpeedSearchMatch(objs, 'tw', (o) => o.n)).toBe(1);
  });
});
