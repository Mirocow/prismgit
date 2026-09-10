/**
 * LazyFileList — renders files in chunks as the user scrolls.
 *
 * Uses IntersectionObserver to detect when the last rendered row is visible,
 * then loads the next batch. No arbitrary limits — all files are accessible,
 * just loaded progressively.
 *
 * Each file row is rendered via the `renderRow` callback.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
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

  // Reset when file list changes (e.g. filter applied)
  useEffect(() => {
    setVisibleCount(Math.min(BATCH_SIZE, files.length));
  }, [files]);

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
    <>
      {files.slice(0, visibleCount).map((f) => renderRow(f, isStaged))}
      {visibleCount < files.length && (
        <div ref={sentinelRef} className="px-3 py-1 text-2xs text-text-tertiary">
          {t('changes.loadingMore', { loaded: visibleCount, total: files.length })}
        </div>
      )}
    </>
  );
}
