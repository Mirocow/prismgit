/**
 * MergeRow — a single row in any of the 3 merge panes (Ours/Theirs/Base).
 *
 * Memoized for performance — only re-renders when its props change.
 *
 * Render:
 *   <div class="row" style="height: 20px">
 *     <span class="line-number">123</span>
 *     <span class="content">
 *       ... syntax-highlighted code OR word-diff segments ...
 *     </span>
 *   </div>
 *
 * Background tint comes from the regionKind + ghost flags:
 *   - stable       → no bg
 *   - changed-ours → green tint (light)
 *   - changed-theirs → red tint (light)
 *   - conflict     → orange/yellow tint
 *   - ghost row    → striped grey background
 *
 * Word-level diff:
 *   When a row is inside a CONFLICT region AND a `diffAgainst` line is
 *   provided (the corresponding line from the OTHER side), we compute a
 *   word-level diff and highlight the changed words inline. This makes
 *   the specific changes between OURS and THEIRS pop out — without it,
 *   the user only sees block-level background tints and can't tell WHICH
 *   words actually differ.
 *
 *   For 'ours' rows, diffAgainst = the theirs line at the same aligned-row
 *   index. Added words (in ours but not theirs) get .word-diff-added.
 *   Removed words (in theirs but not ours) get .word-diff-removed.
 *   For 'theirs' rows the highlighting mirrors: added = theirs-only words.
 */

import { memo, useMemo } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';
import { wordDiff, type WordSegment } from '../../lib/wordDiff';
import { cn } from '../../lib/utils';
import type { RegionKind } from '../../lib/merge/mergeTypes';

const ROW_HEIGHT = 20; // must match useMergeViewport.MERGE_ROW_HEIGHT

interface MergeRowProps {
  /** The actual text content of this row, or '' for ghosts. */
  text: string;
  /** 1-based line number, or null for ghost rows. */
  lineNum: number | null;
  /** Region kind for background tinting. */
  regionKind: RegionKind;
  /** Whether this row is a ghost (no equivalent line on this side). */
  isGhost: boolean;
  /** Programming language for syntax highlighting. */
  lang: SupportedLang;
  /** The line from the OTHER side to diff against (for word-level highlight
   *  inside conflict regions). null/undefined = no word-diff. */
  diffAgainst?: string | null;
  /** Which side this row belongs to — affects word-diff segment coloring. */
  side?: 'ours' | 'theirs' | 'base';
}

/** Map regionKind → background CSS class (used when not a ghost). */
function bgClassForRegion(kind: RegionKind, isGhost: boolean): string {
  if (isGhost) return 'bg-bg-ghost-row';
  switch (kind) {
    case 'stable':         return '';
    case 'changed-ours':   return 'conflict-bg-ours';
    case 'changed-theirs': return 'conflict-bg-theirs';
    case 'conflict':       return 'conflict-bg-conflict';
    default:               return '';
  }
}

/** Escape a string for safe insertion into innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render word-diff segments as HTML. For 'ours' rows, the segments come
 * from wordDiff(oldLine=ours, newLine=theirs).old — so 'removed' segments
 * are words present in ours but missing from theirs (i.e. words that are
 * DIFFERENT in ours). For 'theirs' rows we use wordDiff.new — 'added'
 * segments are words present in theirs but not in ours.
 *
 * To make the highlight intuitive for the user:
 *   - On the OURS side: highlight words that are NOT in theirs → these are
 *     "ours-only" words. Use .word-diff-ours (green) so the colour matches
 *     the OURS row background tint (also green) — same-side = same colour.
 *   - On the THEIRS side: highlight words that are NOT in ours → these are
 *     "theirs-only" words. Use .word-diff-theirs (red) so the colour matches
 *     the THEIRS row background tint (also red) — same-side = same colour.
 *
 * Equal segments are rendered with plain syntax highlighting.
 */
function renderWordDiffHtml(
  segments: WordSegment[],
  lang: SupportedLang,
  side: 'ours' | 'theirs' | 'base',
): string {
  let html = '';
  for (const seg of segments) {
    if (seg.text === '') continue;
    if (seg.kind === 'equal') {
      // Use syntax highlighting for equal segments.
      html += tokensToHtml(tokenizeLine(seg.text, lang)) || escapeHtml(seg.text);
    } else {
      // For 'ours' side: 'removed' segments (in ours, not in theirs) → ours-only.
      // For 'theirs' side: 'added' segments (in theirs, not in ours) → theirs-only.
      // In both cases, the highlighted span represents "what's unique to this side".
      // Use a SIDE-SPECIFIC class so the colour matches the row's bg tint:
      //   .word-diff-ours   (green) for OURS rows
      //   .word-diff-theirs (red)   for THEIRS rows
      const isUnique = (side === 'ours' && seg.kind === 'removed')
                    || (side === 'theirs' && seg.kind === 'added');
      if (isUnique) {
        const cls = side === 'ours' ? 'word-diff-ours' : 'word-diff-theirs';
        html += `<span class="${cls}">${escapeHtml(seg.text)}</span>`;
      } else {
        // This word exists on the OTHER side but not here — render as
        // plain text (it's a context word that happens to be shared).
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
    // Word-diff ONLY in conflict regions where we have a line to diff against.
    if (regionKind === 'conflict' && diffAgainst != null && diffAgainst !== text) {
      const result = wordDiff(text, diffAgainst);
      // Pick the segment list for THIS side.
      const segments = side === 'ours' ? result.old : side === 'theirs' ? result.new : null;
      if (segments) {
        return renderWordDiffHtml(segments, lang, side);
      }
    }
    // Default: syntax highlighting only.
    return tokensToHtml(tokenizeLine(text, lang)) || '&nbsp;';
  }, [text, isGhost, regionKind, diffAgainst, side, lang]);

  const bg = bgClassForRegion(regionKind, isGhost);
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
