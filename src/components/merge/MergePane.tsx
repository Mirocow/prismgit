/**
 * MergePane — a read-only side pane (Ours, Theirs, or Base peek).
 *
 * Renders the visible slice of the alignedRows[] model.
 * Only block-level background tint (green=ours, blue=theirs, grey=ghost).
 */

import { memo, useMemo } from 'react';
import { MergeRow } from './MergeRow';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n';
import type { AlignedRow } from '../../lib/merge/mergeTypes';
import type { SupportedLang } from '../../lib/syntaxHighlight';

const ROW_HEIGHT = 20;

interface MergePaneProps {
  title: string;
  side: 'ours' | 'theirs' | 'base';
  alignedRows: AlignedRow[];
  visibleRange: { start: number; end: number };
  totalHeight: number;
  scrollTop: number;
  lang: SupportedLang;
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
  const visibleRows = useMemo(
    () => alignedRows.slice(visibleRange.start, visibleRange.end),
    [alignedRows, visibleRange.start, visibleRange.end],
  );
  const headerColor =
    side === 'ours' ? 'text-status-added'
      : side === 'theirs' ? 'text-status-info'
        : 'text-text-tertiary';
  const headerStyle = side === 'theirs'
    ? { color: 'var(--status-info)' }
    : undefined;
  return (
    <div className="flex-1 flex flex-col border-r border-border-default last:border-r-0 min-w-0 overflow-hidden">
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0 h-8">
        <span className={cn('truncate', headerColor)} style={headerStyle}>
          {title}
          <span className="ml-2 text-2xs text-text-tertiary normal-case font-normal">
            ({lines.length} {t('common.lines')})
          </span>
        </span>
      </div>
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
            const lineIdx = side === 'ours' ? row.oursLine : side === 'theirs' ? row.theirsLine : row.baseLine;
            const isGhost = side === 'ours' ? row.isGhost.ours : side === 'theirs' ? row.isGhost.theirs : row.isGhost.base;
            const text = lineIdx !== null ? lines[lineIdx] ?? '' : '';
            return (
              <MergeRow
                key={idx}
                text={text}
                lineNum={lineIdx !== null ? lineIdx + 1 : null}
                regionKind={row.regionKind}
                isGhost={isGhost}
                lang={lang}
                side={side}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const MergePane = memo(MergePaneImpl);
