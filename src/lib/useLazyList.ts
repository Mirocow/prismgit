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
  scrollRef: React.RefObject<HTMLDivElement | null>;
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
  // PERFORMANCE (P7): the previous `measuredHeights: Map<number, number>`
  // recreated a Map on every measurement, which in turn invalidated the
  // `totalHeight + offsets` useMemo — re-running an O(N) scan on every
  // measurement. On a 10 000-row list with 30 visible items, the initial
  // measurement pass did 30 × O(10 000) = 300 000 ops just for offsets.
  //
  // Now heights live in a flat `Float64Array` indexed by row position.
  // Mutation is in-place (no Map clone), and the `version` counter is the
  // only thing that bumps to trigger the useMemo recompute.
  const heightsRef = useRef<Float64Array>(new Float64Array(0));
  const [heightsVersion, setHeightsVersion] = useState(0);
  // Reallocate when itemCount changes (avoid index-out-of-bounds writes).
  if (heightsRef.current.length !== itemCount) {
    const next = new Float64Array(itemCount);
    // Preserve previously measured heights for indices that still exist.
    next.set(heightsRef.current.subarray(0, Math.min(heightsRef.current.length, itemCount)));
    heightsRef.current = next;
  }

  // Compute cumulative heights.
  const { totalHeight, offsets } = useMemo(() => {
    const heights = heightsRef.current;
    const offs = new Float64Array(itemCount + 1);
    let total = 0;
    offs[0] = 0;
    for (let i = 0; i < itemCount; i++) {
      const h = heights[i] || estimateRowHeight;
      total += h;
      offs[i + 1] = total;
    }
    return { totalHeight: total, offsets: offs };
  }, [itemCount, estimateRowHeight, heightsVersion]);

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
    const cur = heightsRef.current[index];
    if (cur !== undefined && Math.abs(cur - height) < 1) return; // no change
    heightsRef.current[index] = height;
    // Bump version to trigger recompute of totalHeight + offsets.
    setHeightsVersion(v => v + 1);
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
