/**
 * MergeRow — a single row in any of the 3 merge panes (Ours/Theirs/Base).
 *
 * Memoized for performance — only re-renders when its props change.
 *
 * Render:
 *   <div class="row" style="height: 20px">
 *     <span class="line-number">123</span>
 *     <span class="content" dangerouslySetInnerHTML=...>
 *       highlighted code or &nbsp; for ghosts
 *     </span>
 *   </div>
 *
 * Background tint comes from the regionKind + ghost flags:
 *   - stable       → no bg
 *   - changed-ours → green tint (light)
 *   - changed-theirs → red tint (light)
 *   - conflict     → orange/yellow tint
 *   - ghost row    → striped grey background
 */

import { memo, useMemo } from 'react';
import { tokenizeLine, tokensToHtml, type SupportedLang } from '../../lib/syntaxHighlight';
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
}

/** Map regionKind → background CSS class (used when not a ghost). */
function bgClassForRegion(kind: RegionKind, isGhost: boolean): string {
  if (isGhost) return 'bg-bg-ghost-row';
  switch (kind) {
    case 'stable':         return '';
    case 'changed-ours':   return 'bg-conflict-bg-ours';
    case 'changed-theirs': return 'bg-conflict-bg-theirs';
    case 'conflict':       return 'bg-conflict-bg-conflict';
    default:               return '';
  }
}

function MergeRowImpl({
  text,
  lineNum,
  regionKind,
  isGhost,
  lang,
}: MergeRowProps) {
  // Tokenize + escape — memoized so re-renders with the same text/lang
  // don't re-tokenize.
  const contentHtml = useMemo(() => {
    if (isGhost || text === '') return '&nbsp;';
    return tokensToHtml(tokenizeLine(text, lang)) || '&nbsp;';
  }, [text, isGhost, lang]);
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
