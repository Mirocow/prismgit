/**
 * Build the AlignedRow[] model — the SINGLE source of truth for the
 * 3 panes. Each row in the array corresponds to ONE visible line in each
 * pane; ghost rows (null line numbers) pad shorter sides so the visual
 * alignment is preserved.
 *
 * Pipeline:
 *   (baseLines, oursLines, theirsLines, regions)
 *     → for each region:
 *         - stable           → emit aligned rows 1:1:1
 *         - changed-ours     → emit rows where base & theirs have ghost lines
 *                              (we only changed ours, so ours has more)
 *         - changed-theirs   → mirror of above
 *         - conflict         → interleave ours + theirs with ghost fillers
 *
 * Result is consumed by MergeRow/MergePane for rendering.
 */

import type { Region, AlignedRow } from './mergeTypes';

/**
 * Build the aligned rows array.
 *
 * @param baseLines
 * @param oursLines
 * @param theirsLines
 * @param regions — output of diff3()
 */
export function alignRows(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  regions: Region[],
): AlignedRow[] {
  const rows: AlignedRow[] = [];
  // Walk each region; emit rows in order.
  for (let ri = 0; ri < regions.length; ri++) {
    const r = regions[ri];
    const baseSlice = baseLines.slice(r.baseStart, r.baseStart + r.baseLen);
    const oursSlice = oursLines.slice(r.oursStart, r.oursStart + r.oursLen);
    const theirsSlice = theirsLines.slice(r.theirsStart, r.theirsStart + r.theirsLen);
    if (r.kind === 'stable') {
      // All three equal — emit 1:1:1 rows.
      const len = Math.max(baseSlice.length, oursSlice.length, theirsSlice.length);
      for (let k = 0; k < len; k++) {
        rows.push({
          baseLine: k < baseSlice.length ? r.baseStart + k : null,
          oursLine: k < oursSlice.length ? r.oursStart + k : null,
          theirsLine: k < theirsSlice.length ? r.theirsStart + k : null,
          resultLine: null, // populated by resolveConflicts / manual edit
          regionKind: r.kind,
          regionIdx: ri,
          isGhost: {
            base: k >= baseSlice.length,
            ours: k >= oursSlice.length,
            theirs: k >= theirsSlice.length,
          },
        });
      }
    } else if (r.kind === 'changed-ours') {
      // Only ours changed — base & theirs remain at the original (so they
      // should be the same length as base). Emit rows where ours may have
      // MORE lines (inserts) or fewer (deletes). Base & theirs pad with
      // ghosts when ours has extra.
      const maxLen = Math.max(oursSlice.length, baseSlice.length);
      for (let k = 0; k < maxLen; k++) {
        rows.push({
          baseLine: k < baseSlice.length ? r.baseStart + k : null,
          oursLine: k < oursSlice.length ? r.oursStart + k : null,
          // theirs matches base (it's unchanged) — but the actual theirs
          // slice has the same length as base, so we index by k into base
          // length for alignment.
          theirsLine: k < baseSlice.length ? r.theirsStart + k : null,
          resultLine: null,
          regionKind: r.kind,
          regionIdx: ri,
          isGhost: {
            base: k >= baseSlice.length,
            ours: k >= oursSlice.length,
            theirs: k >= baseSlice.length,
          },
        });
      }
    } else if (r.kind === 'changed-theirs') {
      // Mirror of changed-ours.
      const maxLen = Math.max(theirsSlice.length, baseSlice.length);
      for (let k = 0; k < maxLen; k++) {
        rows.push({
          baseLine: k < baseSlice.length ? r.baseStart + k : null,
          oursLine: k < baseSlice.length ? r.oursStart + k : null,
          theirsLine: k < theirsSlice.length ? r.theirsStart + k : null,
          resultLine: null,
          regionKind: r.kind,
          regionIdx: ri,
          isGhost: {
            base: k >= baseSlice.length,
            ours: k >= baseSlice.length,
            theirs: k >= theirsSlice.length,
          },
        });
      }
    } else {
      // conflict — both sides changed differently.
      // Align ours and theirs LINE-BY-LINE (like Meld): each row shows
      // ours[k] on the left and theirs[k] on the right. When one side
      // is shorter, the remaining rows get ghost (null) for that side.
      //
      // This is DIFFERENT from the old sequential layout (ours first,
      // then theirs) which made the theirs pane show ALL-GHOST rows
      // for the entire ours block → blue colour never appeared.
      const maxLen = Math.max(oursSlice.length, theirsSlice.length);
      for (let k = 0; k < maxLen; k++) {
        const hasOurs = k < oursSlice.length;
        const hasTheirs = k < theirsSlice.length;
        rows.push({
          baseLine: k < baseSlice.length ? r.baseStart + k : null,
          oursLine: hasOurs ? r.oursStart + k : null,
          theirsLine: hasTheirs ? r.theirsStart + k : null,
          resultLine: null,
          regionKind: 'conflict',
          regionIdx: ri,
          isGhost: {
            base: k >= baseSlice.length,
            ours: !hasOurs,
            theirs: !hasTheirs,
          },
        });
      }
    }
  }
  return rows;
}

/**
 * Find the aligned-row index range for a given conflict region index.
 * Returns [start, end) exclusive, or null if region is not a conflict
 * or no rows exist for it.
 */
export function findConflictRowRange(
  rows: AlignedRow[],
  regionIdx: number,
): [number, number] | null {
  let start = -1;
  let end = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].regionIdx === regionIdx && rows[i].regionKind === 'conflict') {
      if (start === -1) start = i;
      end = i + 1;
    } else if (start !== -1) {
      // We've passed the conflict region.
      break;
    }
  }
  return start === -1 ? null : [start, end];
}
