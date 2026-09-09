/**
 * Lazy loading hook for large lists.
 *
 * Returns only the visible window of items based on scroll position.
 * Used by History (500+ commits), Branches (100+), Tags, Reflog, Stashes, Changes file list.
 *
 * Adapts to dynamic row heights by tracking measured heights per item.
 * Falls back to `estimateRowHeight` for items not yet measured.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

interface LazyListOptions {
  /** Total number of items in the full list. */
  itemCount: number;
  /** Estimated row height in pixels (used before measurement). */
  estimateRowHeight: number;
  /** Overscan: how many extra rows to render above/below the visible window. */
  overscan?: number;
}

interface LazyListResult {
  /** Indices of items to render (visible window + overscan). */
  visibleRange: { start: number; end: number };
  /** Total height of the list (for scrollbar sizing). */
  totalHeight: number;
  /** Offset to apply to the rendered container (so item N appears at the right Y). */
  offsetY: number;
  /** Ref to attach to the scroll container. */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Call when an item's actual height is measured (for dynamic-height lists). */
  measureItem: (index: number, height: number) => void;
  /** Scroll to a specific item index. */
  scrollToIndex: (index: number) => void;
}

export function useLazyList({
  itemCount,
  estimateRowHeight,
  overscan = 8,
}: LazyListOptions): LazyListResult {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [measuredHeights, setMeasuredHeights] = useState<Map<number, number>>(new Map());

  // Track viewport size
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Track scroll position (throttled via rAF)
  const rafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Compute cumulative heights
  const { totalHeight, offsets } = useMemo(() => {
    const heights: number[] = new Array(itemCount);
    let total = 0;
    for (let i = 0; i < itemCount; i++) {
      heights[i] = measuredHeights.get(i) ?? estimateRowHeight;
      total += heights[i];
    }
    // Compute cumulative offsets
    const offs: number[] = new Array(itemCount + 1);
    offs[0] = 0;
    for (let i = 0; i < itemCount; i++) {
      offs[i + 1] = offs[i] + heights[i];
    }
    return { totalHeight: total, offsets: offs };
  }, [itemCount, measuredHeights, estimateRowHeight]);

  // Binary search for the first item whose bottom is below scrollTop
  const start = useMemo(() => {
    let lo = 0, hi = itemCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - overscan);
  }, [offsets, scrollTop, itemCount, overscan]);

  // Find end: first item whose top is beyond scrollTop + viewportHeight
  const end = useMemo(() => {
    const target = scrollTop + viewportHeight;
    let lo = start, hi = itemCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(itemCount, lo + overscan);
  }, [offsets, start, scrollTop, viewportHeight, itemCount, overscan]);

  const offsetY = offsets[start] ?? 0;

  const measureItem = useCallback((index: number, height: number) => {
    setMeasuredHeights(prev => {
      const cur = prev.get(index);
      if (cur !== undefined && Math.abs(cur - height) < 1) return prev; // no change
      const next = new Map(prev);
      next.set(index, height);
      return next;
    });
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(itemCount - 1, index));
    el.scrollTop = offsets[target] ?? 0;
  }, [offsets, itemCount]);

  return {
    visibleRange: { start, end },
    totalHeight,
    offsetY,
    scrollRef,
    measureItem,
    scrollToIndex,
  };
}
