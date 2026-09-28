/**
 * useMergeViewport — single scroll container + windowing hook for the
 * 3-way merge view.
 *
 * Why a single scroll container? The previous implementation created 3
 * separate useLazyList instances (one per pane), each with its own
 * scrollRef. This caused desynchronization: scroll one pane, the others
 * stayed put → lines visually misaligned.
 *
 * The new model: ONE scroll container wraps all 3 panes. The panes are
 * positioned absolutely inside it. scrollTop is the single source of
 * truth for the visible range.
 *
 * Windowing: only the visible rows + overscan are rendered. Total height
 * is rows.length * ROW_HEIGHT (all rows are equal-height for now — variable
 * row heights can be added later if needed).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export const MERGE_ROW_HEIGHT = 20; // px — must match font-mono text-xs leading-5
export const MERGE_OVERSCAN = 8; // extra rows above/below viewport

interface MergeViewportOptions {
  totalRows: number;
  /** Estimate used only for the initial render before measurement. */
  rowHeight?: number;
  overscan?: number;
  /** Attach the scroll/resize listeners only when the scroll container is
   *  actually rendered. MergeEditor3Way early-returns a loading placeholder
   *  BEFORE the scroller exists — effects that ran during loading saw
   *  scrollRef.current === null and attached NOTHING, and (deps being
   *  stable) never retried: the panes stayed frozen at row 0 for the whole
   *  session even though the element itself scrolled fine. */
  enabled?: boolean;
}

interface MergeViewport {
  /** Ref to attach to the single scroll container. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 0-based [start, end) of the visible row range (inclusive start, exclusive end). */
  visibleRange: { start: number; end: number };
  /** Total scrollable height in px — for the spacer div. */
  totalHeight: number;
  /** Current scrollTop — used by the panes to position their content. */
  scrollTop: number;
  /** Viewport height in px (used to compute end of visible range). */
  viewportHeight: number;
  /** Programmatically scroll to a specific row index. */
  scrollToRow: (idx: number) => void;
}

export function useMergeViewport({
  totalRows,
  rowHeight = MERGE_ROW_HEIGHT,
  overscan = MERGE_OVERSCAN,
  enabled = true,
}: MergeViewportOptions): MergeViewport {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  // Track the scroll container's height via ResizeObserver.
  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  // Track scrollTop — set synchronously in the scroll listener.
  // The v2 rAF-throttling stalled in compositor-quiet environments
  // (Xvfb/offscreen: no new frame is scheduled → the rAF never fires →
  // scrollTop state freezes at 0 → the windowed panes never re-render,
  // even though the element itself scrolled). Chromium already coalesces
  // scroll events to one per frame, and React 18+ batches the re-render —
  // the synchronous set is both simpler and stall-proof.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [enabled, handleScroll]);

  // Compute the visible range from scrollTop + viewportHeight.
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
    );
    return { start, end };
  }, [scrollTop, viewportHeight, totalRows, rowHeight, overscan]);

  const totalHeight = totalRows * rowHeight;

  const scrollToRow = useCallback(
    (idx: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const target = Math.max(0, Math.min(totalRows - 1, idx));
      // Center the row in the viewport.
      const targetTop = target * rowHeight - viewportHeight / 2 + rowHeight / 2;
      el.scrollTop = Math.max(0, targetTop);
    },
    [totalRows, rowHeight, viewportHeight],
  );

  return {
    scrollRef,
    visibleRange,
    totalHeight,
    scrollTop,
    viewportHeight,
    scrollToRow,
  };
}
