/**
 * LazyFileList — renders files in chunks as the user scrolls.
 *
 * Uses IntersectionObserver to detect when the last rendered row is visible,
 * then loads the next batch. No arbitrary limits — all files are accessible,
 * just loaded progressively.
 *
 * Each file row is rendered via the `renderRow` callback.
 *
 * ── Scroll reset on file-list change ────────────────────────────────────
 * When the `files` prop changes (e.g. user clicks a different folder in the
 * tree, applies a filter, or the repo status updates), the parent scroll
 * container is reset to scrollTop=0. Without this, switching from a folder
 * with 500 files (scrolled to row 400) to a folder with 10 files leaves
 * the scrollbar at the old position — the user sees empty space and the new
 * files are off-screen above.
 *
 * The reset is done via a forwarded ref to the nearest scrollable ancestor,
 * found at mount time via `closest('.overflow-y-auto')`.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { FileStatus } from '../lib/api';
import { useI18n } from '../lib/i18n';

const BATCH_SIZE = 50; // Render 50 rows at a time

interface LazyFileListProps {
  files: FileStatus[];
  isStaged: boolean;
  renderRow: (file: FileStatus, isStaged: boolean) => React.ReactNode;
}

export function LazyFileList({ files, isStaged, renderRow }: LazyFileListProps) {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(Math.min(BATCH_SIZE, files.length));
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Stable key derived from file paths — only changes when the ACTUAL file
  // list content changes (paths added/removed/reordered), NOT when the
  // array reference changes. This prevents visibleCount from resetting on
  // every rename-detection refresh (which creates a new array reference
  // even when the file list is identical).
  const fileKey = useMemo(
    () => files.map(f => `${f.path}\0${f.index}\0${f.working_dir}`).join('\n'),
    [files]
  );

  // Reset visibleCount only when the file list content actually changes.
  // Using fileKey (string) as dependency — stable across array-reference
  // changes when content is the same.
  useEffect(() => {
    setVisibleCount(Math.min(BATCH_SIZE, files.length));
  }, [fileKey, files.length]);

  // Reset the scroll position of the nearest scrollable ancestor whenever
  // the file list content changes. Without this, switching folders leaves
  // the scrollbar at the old position, making the new files appear "missing"
  // (they're off-screen above the viewport).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Walk up the DOM to find the scroll container. The file list's
    // immediate parent is the role="listbox" wrapper; the scrollable
    // ancestor is typically 2-3 levels up.
    let el: HTMLElement | null = root;
    for (let i = 0; i < 6 && el; i++) {
      const style = getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        el.scrollTop = 0;
        return;
      }
      el = el.parentElement;
    }
    // Fallback: didn't find a scrollable ancestor — try the data-tagged
    // scroll container the parent page sets.
    const tagged = root.closest('[data-file-scroll-container]') as HTMLElement | null;
    if (tagged) tagged.scrollTop = 0;
  }, [fileKey]);

  // IntersectionObserver to load more when sentinel is visible
  const loadMore = useCallback(() => {
    setVisibleCount(prev => Math.min(prev + BATCH_SIZE, files.length));
  }, [files.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        loadMore();
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (files.length === 0) return null;

  return (
    // A11Y-1 — wrap the file rows in role="listbox" so screen readers
    // announce the listbox semantics ("X items, in list") and let SR
    // users navigate with arrow keys. Each row's role="option" +
    // aria-selected is set by the renderRow caller.
    <div ref={rootRef} role="listbox" aria-multiselectable={true}>
      {files.slice(0, visibleCount).map((f) => renderRow(f, isStaged))}
      {visibleCount < files.length && (
        <div ref={sentinelRef} className="px-3 py-1 text-2xs text-text-tertiary" aria-hidden={true}>
          {t('changes.loadingMore', { loaded: visibleCount, total: files.length })}
        </div>
      )}
    </div>
  );
}
