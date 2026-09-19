/**
 * MergePane — a read-only side pane (Ours, Theirs, or Base peek).
 *
 * Renders the visible slice of the alignedRows[] model. Does NOT own
 * its own scroll container — the parent MergeEditor3Way provides the
 * single scroll container; this pane just renders rows at the right
 * absolute Y offset.
 *
 * Layout:
 *   <div class="pane">
 *     <header>Ours (123 lines)</header>
 *     <div class="pane-content" style="height: totalHeight">
 *       {visibleRows.map(row => <MergeRow ... />)}
 *     </div>
 *   </div>
 */

import { memo, useMemo } from 'react';
import { MergeRow } from './MergeRow';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';
import type { AlignedRow } from '../../lib/merge/mergeTypes';
import type { SupportedLang } from '../../lib/syntaxHighlight';

const ROW_HEIGHT = 20; // match MergeRow + useMergeViewport

interface MergePaneProps {
  /** Pane title (Ours / Theirs / Base). */
  title: string;
  /** Which side — used for accent color (ours=green, theirs=red, base=muted). */
  side: 'ours' | 'theirs' | 'base';
  /** The alignedRows[] from the parent. */
  alignedRows: AlignedRow[];
  /** Visible range [start, end) from the viewport. */
  visibleRange: { start: number; end: number };
  /** Total scrollable height in px. */
  totalHeight: number;
  /** Scroll offset in px (translates the visible slice). */
  scrollTop: number;
  /** Detected programming language for syntax highlighting. */
  lang: SupportedLang;
  /** Source lines for this side (for content extraction). */
  lines: string[];
}

function MergePaneImpl({
  title,
  side,
  alignedRows,
  visibleRange,
  totalHeight,
  scrollTop,
  lang,
  lines,
}: MergePaneProps) {
  const { t } = useI18n();
  // Slice the visible rows.
  const visibleRows = useMemo(
    () => alignedRows.slice(visibleRange.start, visibleRange.end),
    [alignedRows, visibleRange.start, visibleRange.end],
  );
  const headerColor =
    side === 'ours' ? 'text-status-added'
      : side === 'theirs' ? 'text-status-deleted'
        : 'text-text-tertiary';
  return (
    <div className="flex-1 flex flex-col border-r border-border-default last:border-r-0 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0 h-8">
        <span className={cn('truncate', headerColor)}>
          {title}
          <span className="ml-2 text-2xs text-text-tertiary normal-case font-normal">
            ({lines.length} {t('common.lines')})
          </span>
        </span>
      </div>
      {/* Content — renders only the visible rows, absolutely positioned.
          The container is `pointer-events: none` so scroll events bubble
          up to the parent's scroll container. */}
      <div className="flex-1 overflow-hidden relative">
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: totalHeight,
            transform: `translateY(${-scrollTop}px)`,
          }}
        >
          {visibleRows.map((row, i) => {
            const idx = visibleRange.start + i;
            const lineNum = side === 'ours' ? row.oursLine : side === 'theirs' ? row.theirsLine : row.baseLine;
            const isGhost = side === 'ours' ? row.isGhost.ours : side === 'theirs' ? row.isGhost.theirs : row.isGhost.base;
            const text = lineNum !== null ? lines[lineNum] ?? '' : '';
            return (
              <MergeRow
                key={idx}
                text={text}
                lineNum={lineNum !== null ? lineNum + 1 : null}
                regionKind={row.regionKind}
                isGhost={isGhost}
                lang={lang}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const MergePane = memo(MergePaneImpl);
