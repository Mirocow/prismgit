/**
 * MergePane — a read-only side pane (Ours, Theirs, or Base peek).
 *
 * v3 layout: the pane is a TALL COLUMN (height = totalHeight = aligned
 * rows × 20) rendered INSIDE the shared 3-pane scroll container. Rows are
 * absolutely positioned at `top: index × 20` — only the visible window
 * (visibleRange) is mounted. The pane title/header is rendered by the
 * parent (MergeEditor3Way) in a fixed row ABOVE the scroller, so headers
 * don't scroll away.
 *
 * Previously the pane wrapped its content in `overflow-hidden` with an
 * inner absolute container translated by -scrollTop — inside a shared
 * scroller that had NO overflowing content of its own. Result: the
 * container could never scroll, and the side panes were permanently
 * frozen at the top of the file (only the middle pane scrolled, alone).
 */

import { memo, useMemo } from 'react';
import { MergeRow } from './MergeRow';
import { cn } from '../../lib/utils';
import type { AlignedRow } from '../../lib/merge/mergeTypes';
import type { SupportedLang } from '../../lib/syntaxHighlight';

const ROW_HEIGHT = 20;

interface MergePaneProps {
  side: 'ours' | 'theirs' | 'base';
  alignedRows: AlignedRow[];
  visibleRange: { start: number; end: number };
  /** Total scrollable height in px — the column's height. */
  totalHeight: number;
  lang: SupportedLang;
  lines: string[];
}

function MergePaneImpl({
  side,
  alignedRows,
  visibleRange,
  totalHeight,
  lang,
  lines,
}: MergePaneProps) {
  const visibleRows = useMemo(
    () => alignedRows.slice(visibleRange.start, visibleRange.end),
    [alignedRows, visibleRange.start, visibleRange.end],
  );
  return (
    <div
      className={cn(
        'flex-1 min-w-0 relative overflow-hidden',
        side === 'ours' && 'border-r border-border-default',
        side === 'theirs' && 'border-l border-border-default',
      )}
      style={{ height: totalHeight }}
      data-testid={`merge-pane-${side}`}
    >
      {visibleRows.map((row, i) => {
        const idx = visibleRange.start + i;
        const lineIdx = side === 'ours' ? row.oursLine : side === 'theirs' ? row.theirsLine : row.baseLine;
        const isGhost = side === 'ours' ? row.isGhost.ours : side === 'theirs' ? row.isGhost.theirs : row.isGhost.base;
        const text = lineIdx !== null ? lines[lineIdx] ?? '' : '';
        return (
          <div key={idx} style={{ position: 'absolute', top: idx * ROW_HEIGHT, left: 0, right: 0 }}>
            <MergeRow
              text={text}
              lineNum={lineIdx !== null ? lineIdx + 1 : null}
              regionKind={row.regionKind}
              isGhost={isGhost}
              lang={lang}
              side={side}
            />
          </div>
        );
      })}
    </div>
  );
}

export const MergePane = memo(MergePaneImpl);
