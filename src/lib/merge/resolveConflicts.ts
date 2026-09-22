/**
 * Conflict resolution strategies — produce the merged "Result" text.
 *
 * Strategies:
 *   - autoMerge:   apply KDiff3-style auto-merge — take stable regions
 *                  as-is, take changed-only-one-side from that side, leave
 *                  conflict markers in real conflicts.
 *   - resolveHunk: replace ONE specific conflict with the chosen
 *                  resolution (ours/theirs/base/both/manual).
 *   - undoHunk:    pop the last resolution from the undo stack.
 *
 * The Result is a single string array (lines) — the MergeEditor feeds
 * it to the textarea as initial content (uncontrolled).
 */

import type { Region, ConflictResolution } from './mergeTypes';

/**
 * Build the initial Result content by applying auto-merge:
 *   - stable           → take from base (== ours == theirs)
 *   - changed-ours     → take from ours
 *   - changed-theirs    → take from theirs
 *   - conflict          → emit <<<<<<< ======= >>>>>>> markers
 *
 * The Result is the user's starting point — they edit it further via
 * resolveHunk or manual edits in the textarea.
 */
export function buildAutoMergeResult(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  regions: Region[],
): string[] {
  const out: string[] = [];
  for (const r of regions) {
    if (r.kind === 'stable') {
      // Stable = all three sides agree, OR ours == theirs (both sides made
      // the SAME change / the same deletion). Take from OURS, not base:
      // taking base would silently REVERT an agreed change (and lose
      // add/add-same content, where baseLen is 0 but oursLen > 0).
      // `?? ''` — defensive: a region must never read past the array end
      // (undefined lines would crash every startsWith consumer downstream).
      for (let k = 0; k < r.oursLen; k++) out.push(oursLines[r.oursStart + k] ?? '');
    } else if (r.kind === 'changed-ours') {
      // Only ours changed — take ours.
      for (let k = 0; k < r.oursLen; k++) out.push(oursLines[r.oursStart + k] ?? '');
    } else if (r.kind === 'changed-theirs') {
      // Only theirs changed — take theirs.
      for (let k = 0; k < r.theirsLen; k++) out.push(theirsLines[r.theirsStart + k] ?? '');
    } else {
      // conflict — emit conflict markers (Git format).
      // `?? ''` guards are LOAD-BEARING here: the other three branches were
      // hardened earlier, but this one was not — an over-counted region
      // (stale-anchor duplicate after mergeAdjacentRegions) pushed `undefined`
      // lines into the Result, and the FIRST consumer that called
      // `.startsWith()` on them crashed with:
      //   TypeError: Cannot read properties of undefined (reading 'startsWith')
      // surfaced as the "Failed to load conflict" toast (user-reported).
      out.push('<<<<<<< ours');
      for (let k = 0; k < r.oursLen; k++) out.push(oursLines[r.oursStart + k] ?? '');
      out.push('=======');
      for (let k = 0; k < r.theirsLen; k++) out.push(theirsLines[r.theirsStart + k] ?? '');
      out.push('>>>>>>> theirs');
    }
  }
  return out;
}

/**
 * Resolve a single conflict region by replacing its block in the Result
 * with the chosen resolution. Returns the new Result array.
 *
 * @param resultLines current Result (array of lines)
 * @param conflictMarkersPositions positions of the <<<<<<< lines in resultLines
 * @param conflictIdx which conflict to resolve (0-based)
 * @param resolution resolution strategy
 * @param oursLines / theirsLines / baseLines for content extraction
 */
export function resolveHunk(
  resultLines: string[],
  conflictMarkersPositions: number[],
  conflictIdx: number,
  resolution: ConflictResolution,
  oursLines: string[],
  theirsLines: string[],
  baseLines: string[],
  regions: Region[],
): string[] {
  if (conflictIdx < 0 || conflictIdx >= conflictMarkersPositions.length) return resultLines;
  // Find the conflict region in `regions` (0-based among conflict-kind regions).
  const conflictRegions = regions.filter((r) => r.kind === 'conflict');
  const r = conflictRegions[conflictIdx];
  if (!r) return resultLines;
  const startLine = conflictMarkersPositions[conflictIdx];
  // Find the end (the >>>>>>> line). Walk forward from startLine.
  // `?? ''` — the Result array may contain undefined holes from legacy
  // or hand-built regions; never let that crash the walk.
  let endLine = startLine + 1;
  while (endLine < resultLines.length && !(resultLines[endLine] ?? '').startsWith('>>>>>>>')) {
    endLine++;
  }
  endLine++; // include the >>>>>>> line itself
  // Build the resolved replacement.
  let resolved: string[];
  switch (resolution) {
    case 'ours':
      resolved = oursLines.slice(r.oursStart, r.oursStart + r.oursLen);
      break;
    case 'theirs':
      resolved = theirsLines.slice(r.theirsStart, r.theirsStart + r.theirsLen);
      break;
    case 'base':
      resolved = baseLines.slice(r.baseStart, r.baseStart + r.baseLen);
      break;
    case 'both-ours-first':
      resolved = [
        ...oursLines.slice(r.oursStart, r.oursStart + r.oursLen),
        '',
        ...theirsLines.slice(r.theirsStart, r.theirsStart + r.theirsLen),
      ];
      break;
    case 'both-theirs-first':
      resolved = [
        ...theirsLines.slice(r.theirsStart, r.theirsStart + r.theirsLen),
        '',
        ...oursLines.slice(r.oursStart, r.oursStart + r.oursLen),
      ];
      break;
    case 'manual':
      // Empty block — user will type.
      resolved = [''];
      break;
    default:
      return resultLines;
  }
  // Splice in place.
  const next = [...resultLines.slice(0, startLine), ...resolved, ...resultLines.slice(endLine)];
  return next;
}

/**
 * Find the line indices of all <<<<<<< conflict-start markers in the
 * Result array. Used by resolveHunk + for navigation.
 */
export function findConflictMarkers(resultLines: string[]): number[] {
  const positions: number[] = [];
  for (let i = 0; i < resultLines.length; i++) {
    if ((resultLines[i] ?? '').startsWith('<<<<<<<')) positions.push(i);
  }
  return positions;
}

/**
 * Final save: validate that no conflict markers remain in the result.
 * Returns true if the file is safe to stage (no markers).
 */
export function isResultClean(resultLines: string[]): boolean {
  return !resultLines.some((l) => (l ?? '').startsWith('<<<<<<<') || (l ?? '').startsWith('>>>>>>>'));
}
