import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Speed Search hook (SmartGit Manual: "Speed Search — type in tables/trees to find entries").
 *
 * As the user types, this hook maintains a query string. The consumer is
 * responsible for highlighting or filtering based on the query.
 *
 * Behavior:
 * - Keystrokes accumulate over 500ms since last keypress
 * - Backspace removes the last char of the query
 * - Escape clears the query
 * - ArrowUp / ArrowDown navigation handled by consumer
 *
 * Usage:
 * ```tsx
 * const { query, registerTarget } = useSpeedSearch<HTMLDivElement>({
 *   onNavigate: (dir) => setSelectedIdx(i => Math.max(0, Math.min(items.length - 1, i + dir))),
 *   onHome: () => setSelectedIdx(0),
 *   onEnd: () => setSelectedIdx(items.length - 1),
 * });
 * <div ref={registerTarget} tabIndex={0}>...</div>
 * ```
 */
export interface SpeedSearchOptions {
  /** Called with +1 for ArrowDown, -1 for ArrowUp. */
  onNavigate?: (direction: number) => void;
  /** Called when user presses Home — typically selects first item. */
  onHome?: () => void;
  /** Called when user presses End — typically selects last item. */
  onEnd?: () => void;
  /** Delay before clearing the query after the last keystroke (default 1500ms). */
  resetDelay?: number;
  /** Keys to ignore (default: Tab, Enter). */
  ignoreKeys?: string[];
}

export function useSpeedSearch<T extends HTMLElement = HTMLDivElement>(
  options: SpeedSearchOptions = {}
) {
  const { onNavigate, onHome, onEnd, resetDelay = 1500, ignoreKeys = ['Tab', 'Enter'] } = options;
  const [query, setQuery] = useState('');
  const targetRef = useRef<T | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if focus is in an input/textarea — speed search should not interfere with typing
      const target = e.target as HTMLElement;
      const isInInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (isInInput) return;

      // Skip modifier combos (Ctrl+C, Cmd+K, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (ignoreKeys.includes(e.key)) return;

      if (e.key === 'Escape') {
        setQuery('');
        return;
      }
      if (e.key === 'Backspace') {
        setQuery(q => q.slice(0, -1));
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowDown') {
        onNavigate?.(1);
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp') {
        onNavigate?.(-1);
        e.preventDefault();
        return;
      }
      if (e.key === 'Home') {
        onHome?.();
        e.preventDefault();
        return;
      }
      if (e.key === 'End') {
        onEnd?.();
        e.preventDefault();
        return;
      }
      // Accumulate printable chars
      if (e.key.length === 1) {
        setQuery(q => (q + e.key).slice(0, 64));
        e.preventDefault();
      }
    },
    [onNavigate, onHome, onEnd, ignoreKeys]
  );

  // Reset query after inactivity
  useEffect(() => {
    if (!query) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setQuery(''), resetDelay);
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [query, resetDelay]);

  // Attach listener when target is set
  const registerTarget = useCallback(
    (el: T | null) => {
      // Remove old listener
      if (targetRef.current) {
        targetRef.current.removeEventListener('keydown', handleKeyDown);
      }
      targetRef.current = el;
      if (el) {
        el.addEventListener('keydown', handleKeyDown);
      }
    },
    [handleKeyDown]
  );

  // Cleanup
  useEffect(() => {
    return () => {
      if (targetRef.current) {
        targetRef.current.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [handleKeyDown]);

  return { query, setQuery, registerTarget };
}

/**
 * Highlight the speed-search query in a string for display.
 * Returns an array of segments: matched (highlighted) and unmatched.
 */
export function highlightSpeedSearch(text: string, query: string): { text: string; match: boolean }[] {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const result: { text: string; match: boolean }[] = [];
  let idx = 0;
  let i = lower.indexOf(q, idx);
  while (i !== -1) {
    if (i > idx) result.push({ text: text.slice(idx, i), match: false });
    result.push({ text: text.slice(i, i + q.length), match: true });
    idx = i + q.length;
    i = lower.indexOf(q, idx);
  }
  if (idx < text.length) result.push({ text: text.slice(idx), match: false });
  return result;
}

/**
 * Find the first item index matching the speed-search query.
 */
export function findSpeedSearchMatch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  startIndex = 0
): number {
  if (!query) return -1;
  const q = query.toLowerCase();
  // Wrap-around search starting from startIndex
  for (let i = 0; i < items.length; i++) {
    const idx = (startIndex + i) % items.length;
    const text = getText(items[idx]).toLowerCase();
    if (text.includes(q)) return idx;
  }
  return -1;
}
