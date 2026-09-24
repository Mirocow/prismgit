/**
 * MergeRow — a single row in any of the 3 merge panes (Ours/Theirs/Base).
 *
 * Uses INLINE STYLES for background colour — no CSS classes.
 * Only BLOCK-LEVEL background tint (green=ours, blue=theirs, grey=ghost).
 * No word-level diff highlighting.
 */

import { memo, useMemo } from 'react';
import { tokenizeLineCached, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';
import type { RegionKind } from '../../lib/merge/mergeTypes';

const ROW_HEIGHT = 20;

const COLORS = {
  ours:    'rgba(34, 197, 94, 0.35)',
  theirs:  'rgba(59, 130, 246, 0.35)',
  ghost:   'rgba(128, 128, 128, 0.05)',
  none:    'transparent',
};
const BORDER_COLORS = {
  ours:    'rgba(34, 197, 94, 0.9)',
  theirs:  'rgba(59, 130, 246, 0.9)',
};

interface MergeRowProps {
  text: string;
  lineNum: number | null;
  regionKind: RegionKind;
  isGhost: boolean;
  lang: SupportedLang;
  side?: 'ours' | 'theirs' | 'base';
}

function MergeRowImpl({
  text,
  lineNum,
  isGhost,
  lang,
  side = 'base',
}: MergeRowProps) {
  const contentHtml = useMemo(() => {
    if (isGhost || text === '') return '&nbsp;';
    return tokensToHtml(tokenizeLineCached(text, lang)) || '&nbsp;';
  }, [text, isGhost, lang]);

  const bg = isGhost ? COLORS.ghost
    : side === 'ours' ? COLORS.ours
    : side === 'theirs' ? COLORS.theirs
    : COLORS.none;
  const borderLeft = side === 'ours' ? `3px solid ${BORDER_COLORS.ours}` : undefined;
  const borderRight = side === 'theirs' ? `3px solid ${BORDER_COLORS.theirs}` : undefined;

  return (
    <div
      className="flex items-start font-mono text-xs leading-5 px-1"
      style={{ height: ROW_HEIGHT, backgroundColor: bg, borderLeft, borderRight }}
    >
      <span className="w-10 shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle tabular-nums">
        {lineNum ?? ''}
      </span>
      <span
        className="flex-1 pl-2 whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
    </div>
  );
}

export const MergeRow = memo(MergeRowImpl);
