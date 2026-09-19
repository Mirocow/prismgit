/**
 * MergeRow — a single row in any of the 3 merge panes (Ours/Theirs/Base).
 *
 * SIMPLEST POSSIBLE COLOUR RULE (rewritten v4):
 *
 *   Left pane (Ours):    EVERY row with content → GREEN
 *   Right pane (Theirs): EVERY row with content → BLUE
 *   Ghost rows:           striped grey (no content on this side)
 *
 *   Center pane (Result): handled separately by MergeResultEditor —
 *   ours-block lines → GREEN, theirs-block lines → BLUE,
 *   conflict markers → RED.
 *
 * No regionKind logic — just "which pane am I?" + "do I have content?".
 */

import { memo, useMemo } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';
import { wordDiff, type WordSegment } from '../../lib/wordDiff';
import { cn } from '../../lib/utils';
import type { RegionKind } from '../../lib/merge/mergeTypes';

const ROW_HEIGHT = 20;

interface MergeRowProps {
  text: string;
  lineNum: number | null;
  regionKind: RegionKind;
  isGhost: boolean;
  lang: SupportedLang;
  diffAgainst?: string | null;
  side?: 'ours' | 'theirs' | 'base';
}

/**
 * SIMPLEST colour rule:
 *   - Ghost → striped grey
 *   - side='ours'  → GREEN (always — every ours row is green)
 *   - side='theirs' → BLUE (always — every theirs row is blue)
 *   - side='base'   → no tint (base is reference, not coloured)
 */
function bgClassForRow(
  _regionKind: RegionKind,
  isGhost: boolean,
  side: 'ours' | 'theirs' | 'base',
): string {
  if (isGhost) return 'bg-bg-ghost-row';
  if (side === 'ours') return 'conflict-bg-ours';
  if (side === 'theirs') return 'conflict-bg-theirs';
  return ''; // base pane — no tint
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWordDiffHtml(
  segments: WordSegment[],
  lang: SupportedLang,
  side: 'ours' | 'theirs' | 'base',
): string {
  let html = '';
  for (const seg of segments) {
    if (seg.text === '') continue;
    if (seg.kind === 'equal') {
      html += tokensToHtml(tokenizeLine(seg.text, lang)) || escapeHtml(seg.text);
    } else {
      const isUnique = (side === 'ours' && seg.kind === 'removed')
                    || (side === 'theirs' && seg.kind === 'added');
      if (isUnique) {
        const cls = side === 'ours' ? 'word-diff-ours' : 'word-diff-theirs';
        html += `<span class="${cls}">${escapeHtml(seg.text)}</span>`;
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
      if (segments) {
        return renderWordDiffHtml(segments, lang, side);
      }
    }
    return tokensToHtml(tokenizeLine(text, lang)) || '&nbsp;';
  }, [text, isGhost, regionKind, diffAgainst, side, lang]);

  const bg = bgClassForRow(regionKind, isGhost, side);
  return (
    <div
      className={cn('flex items-start font-mono text-xs leading-5 px-1', bg)}
      style={{ height: ROW_HEIGHT }}
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
