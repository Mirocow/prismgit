/**
 * MergeRow — a single row in any of the 3 merge panes (Ours/Theirs/Base).
 *
 * Memoized for performance — only re-renders when its props change.
 *
 * Background tint logic (REWRITTEN v3 — fixes the "both panes blue" bug):
 *
 *   The tint is determined by TWO factors:
 *   1. Which SIDE this pane is (ours / theirs / base) — passed as `side` prop.
 *   2. Whether this row's content is PRESENT or GHOST on this side.
 *
 *   The PREVIOUS logic used `regionKind` (stable / changed-ours /
 *   changed-theirs / conflict) to pick the tint. This was WRONG because:
 *     - In a 'changed-theirs' region, the OURS pane shows unchanged content
 *       (ours == base). The old logic tinted it BLUE (theirs colour) even
 *       though the OURS pane is showing OURS content that didn't change.
 *     - This made BOTH panes show the same colour → "both blue" bug.
 *
 *   The NEW logic: the tint colour matches the PANE, not the region.
 *     - OURS pane rows are ALWAYS green-tinted when they're inside ANY
 *       non-stable region (changed-ours OR conflict).
 *     - THEIRS pane rows are ALWAYS blue-tinted when inside ANY non-stable
 *       region (changed-theirs OR conflict).
 *     - Stable region rows get NO tint (both sides are identical there).
 *     - Ghost rows (no content on this side) get the striped grey pattern.
 *
 *   This gives a clear visual rule: green = "this is what WE have",
 *   blue = "this is what THEY have", no colour = "both sides agree".
 *
 * Word-level diff:
 *   Inside conflict regions, words unique to THIS side get a side-specific
 *   highlight (.word-diff-ours green / .word-diff-theirs blue).
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
  /** Which side this row belongs to — affects tint colour + word-diff. */
  side?: 'ours' | 'theirs' | 'base';
}

/**
 * Determine the background CSS class for a row.
 *
 * RULE (rewritten): the tint colour matches the PANE, not the region kind.
 *   - Ghost row → striped grey (this side has no line here)
 *   - Stable region → no tint (both sides agree, nothing to highlight)
 *   - ANY non-stable region (changed-ours / changed-theirs / conflict):
 *     OURS pane → green (conflict-bg-ours)
 *     THEIRS pane → blue (conflict-bg-theirs)
 *     BASE pane → orange (conflict-bg-conflict) — base is the "reference"
 *
 * This fixes the "both panes blue" bug where a 'changed-theirs' region
 * made the OURS pane show blue (because regionKind=changed-theirs → blue),
 * even though the OURS pane was showing OURS content.
 */
function bgClassForRow(
  regionKind: RegionKind,
  isGhost: boolean,
  side: 'ours' | 'theirs' | 'base',
): string {
  // Ghost rows always get the striped grey pattern.
  if (isGhost) return 'bg-bg-ghost-row';
  // Stable regions: no tint (both sides agree).
  if (regionKind === 'stable') return '';
  // Non-stable regions: tint by which PANE we're rendering.
  // This is the key fix — the colour follows the pane, not the region.
  if (side === 'ours') return 'conflict-bg-ours';
  if (side === 'theirs') return 'conflict-bg-theirs';
  // Base pane in a non-stable region → orange (reference / common ancestor).
  return 'conflict-bg-conflict';
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
 * Render word-diff segments as HTML.
 *
 * For 'ours' rows, segments come from wordDiff(oursLine, theirsLine).old:
 *   - 'removed' segments = words in ours but NOT in theirs → ours-only.
 * For 'theirs' rows, segments come from wordDiff(oursLine, theirsLine).new:
 *   - 'added' segments = words in theirs but NOT in ours → theirs-only.
 *
 * Unique words get a side-specific highlight:
 *   - OURS pane unique words → .word-diff-ours (green)
 *   - THEIRS pane unique words → .word-diff-theirs (blue)
 * Equal/shared words get plain syntax highlighting.
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
    // Word-diff ONLY in conflict regions where we have a line to diff against.
    if (regionKind === 'conflict' && diffAgainst != null && diffAgainst !== text) {
      const result = wordDiff(text, diffAgainst);
      const segments = side === 'ours' ? result.old : side === 'theirs' ? result.new : null;
      if (segments) {
        return renderWordDiffHtml(segments, lang, side);
      }
    }
    // Default: syntax highlighting only.
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
