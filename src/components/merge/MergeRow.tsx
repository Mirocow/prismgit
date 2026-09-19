/**
 * MergeRow — a single row in any of the 3 merge panes.
 *
 * Uses INLINE STYLES for background colour — no CSS classes.
 * This guarantees the colour is applied regardless of CSS cascade,
 * specificity, or Tailwind purge issues.
 */

import { memo, useMemo } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';
import { wordDiff, type WordSegment } from '../../lib/wordDiff';
import type { RegionKind } from '../../lib/merge/mergeTypes';

const ROW_HEIGHT = 20;

// DIRECT COLOUR VALUES — no CSS variables, no CSS classes
const COLORS = {
  ours:    'rgba(34, 197, 94, 0.35)',   // green
  theirs:  'rgba(59, 130, 246, 0.35)',  // blue
  ghost:   'rgba(128, 128, 128, 0.05)',  // grey
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
  diffAgainst?: string | null;
  side?: 'ours' | 'theirs' | 'base';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderWordDiffHtml(segments: WordSegment[], lang: SupportedLang, side: 'ours' | 'theirs' | 'base'): string {
  let html = '';
  for (const seg of segments) {
    if (seg.text === '') continue;
    if (seg.kind === 'equal') {
      html += tokensToHtml(tokenizeLine(seg.text, lang)) || escapeHtml(seg.text);
    } else {
      const isUnique = (side === 'ours' && seg.kind === 'removed')
                    || (side === 'theirs' && seg.kind === 'added');
      if (isUnique) {
        // Inline style on the span — green for ours, blue for theirs
        const bg = side === 'ours' ? 'rgba(34,197,94,0.6)' : 'rgba(59,130,246,0.6)';
        html += `<span style="background-color:${bg};color:#fff;font-weight:600;border-radius:2px;padding:0 1px;">${escapeHtml(seg.text)}</span>`;
      } else {
        html += escapeHtml(seg.text);
      }
    }
  }
  return html || '&nbsp;';
}

function MergeRowImpl({
  text,
  lineNum,
  regionKind,
  isGhost,
  lang,
  diffAgainst,
  side = 'base',
}: MergeRowProps) {
  const contentHtml = useMemo(() => {
    if (isGhost || text === '') return '&nbsp;';
    if (regionKind === 'conflict' && diffAgainst != null && diffAgainst !== text) {
      const result = wordDiff(text, diffAgainst);
      const segments = side === 'ours' ? result.old : side === 'theirs' ? result.new : null;
      if (segments) return renderWordDiffHtml(segments, lang, side);
    }
    return tokensToHtml(tokenizeLine(text, lang)) || '&nbsp;';
  }, [text, isGhost, regionKind, diffAgainst, side, lang]);

  // INLINE STYLE — determines background colour directly
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
      <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle tabular-nums">
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
