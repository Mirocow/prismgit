/**
 * LazyFileList — renders files in chunks as the user scrolls.
 *
 * Uses IntersectionObserver to detect when the last rendered row is visible,
 * then loads the next batch. No arbitrary limits — all files are accessible,
 * just loaded progressively.
 *
 * Each file row is rendered via the `renderRow` callback.
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
    <div role="listbox" aria-multiselectable={true}>
      {files.slice(0, visibleCount).map((f) => renderRow(f, isStaged))}
      {visibleCount < files.length && (
        <div ref={sentinelRef} className="px-3 py-1 text-2xs text-text-tertiary" aria-hidden={true}>
          {t('changes.loadingMore', { loaded: visibleCount, total: files.length })}
        </div>
      )}
    </div>
  );
}
