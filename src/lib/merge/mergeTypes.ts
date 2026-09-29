/**
 * Type definitions for the 3-way merge engine.
 *
 * Pipeline:
 *   raw (baseLines, oursLines, theirsLines)
 *     → diff3(...)               → Region[] (high-level change classification)
 *     → alignRows(...)           → AlignedRow[] (one entry per visible row,
 *                                  with ghost-fill for unequal lengths)
 *     → MergeEditor3Way renders   → 3 panes read from the same AlignedRow[]
 *
 * The AlignedRow[] is the SINGLE source of truth for the 3 panes — it
 * guarantees that row N in Ours visually aligns with row N in Theirs and
 * row N in Result, even when the underlying line counts differ.
 */

/** Region kind produced by the diff3 algorithm. */
export type RegionKind =
  /** All three sides (base/ours/theirs) agree — context lines. */
  | 'stable'
  /** Only OURS changed (theirs == base). Safe to auto-accept ours. */
  | 'changed-ours'
  /** Only THEIRS changed (ours == base). Safe to auto-accept theirs. */
  | 'changed-theirs'
  /** Both sides changed differently — true conflict, needs user input. */
  | 'conflict';

/** A contiguous run of lines that diff3 classifies together. */
export interface Region {
  kind: RegionKind;
  /** Start index in baseLines (exclusive of base for 'changed-theirs' where base may be empty). */
  baseStart: number;
  /** Length in baseLines. */
  baseLen: number;
  /** Start index in oursLines. */
  oursStart: number;
  /** Length in oursLines. */
  oursLen: number;
  /** Start index in theirsLines. */
  theirsStart: number;
  /** Length in theirsLines. */
  theirsLen: number;
}

/**
 * A single row in the aligned-rows model. The MergeEditor renders one
 * AlignedRow per visible line in each of the 3 panes.
 *
 * When a side has no equivalent line (because the other side added/removed
 * lines), the corresponding field is `null` — the pane renders a "ghost"
 * (empty, dimmed) row in that position so visual alignment is preserved.
 */
export interface AlignedRow {
  /** Index into baseLines, or null if base has no line at this row (ghost). */
  baseLine: number | null;
  /** Index into oursLines, or null. */
  oursLine: number | null;
  /** Index into theirsLines, or null. */
  theirsLine: number | null;
  /** Index into resultLines (the merged output), or null until resolved. */
  resultLine: number | null;
  /** Which region this row belongs to (for background tinting). */
  regionKind: RegionKind;
  /** Region index in the regions[] array (for "current conflict" tracking). */
  regionIdx: number;
  /** Per-side ghost flags — true when that side has no line here. */
  isGhost: { base: boolean; ours: boolean; theirs: boolean };
}

/** Conflict metadata tracked separately from AlignedRow[] for UI state. */
export interface ConflictRegion {
  /** 0-based index in the regions[] array. */
  id: number;
  /** Range in alignedRows[] (start inclusive, end exclusive). */
  alignedRowStart: number;
  alignedRowEnd: number;
  /** True after the user has applied a resolution (or manually edited). */
  resolved: boolean;
  /** Which resolution was applied, for undo display. */
  resolution?: ConflictResolution;
}

export type ConflictResolution =
  | 'ours'
  | 'theirs'
  | 'base'
  | 'both-ours-first'
  | 'both-theirs-first'
  | 'manual';



