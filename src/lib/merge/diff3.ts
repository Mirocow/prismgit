/**
 * diff3 — three-way diff algorithm.
 *
 * Based on the classic Hunt-McIlroy LCS approach, extended to three
 * sequences. The output is a list of Regions that classify each
 * contiguous run as stable / changed-ours / changed-theirs / conflict.
 *
 * Algorithm outline (matches KDiff3 / GNU diff3):
 *   1. Compute LCS(base, ours) → "matching blocks" where ours == base.
 *   2. Compute LCS(base, theirs) → "matching blocks" where theirs == base.
 *   3. Walk the three sequences together, advancing each pointer past the
 *      next "matching block" boundary. Between two boundaries, classify
 *      the gap:
 *        - ours[chunk] == base[chunk] and theirs[chunk] != base[chunk]
 *          → changed-theirs (theirs is the only side that diverged)
 *        - ours[chunk] != base[chunk] and theirs[chunk] == base[chunk]
 *          → changed-ours
 *        - ours[chunk] == theirs[chunk] (both changed identically)
 *          → stable (both sides agreed; treat as no real conflict)
 *        - both diverged and unequal → conflict
 *
 * Pure function — no side effects, no I/O. Trivially testable.
 */

import type { Region, RegionKind } from './mergeTypes';

/**
 * Compute the LCS-based matching blocks between two string arrays.
 * Returns an array of [aStart, bStart, length] triples for each
 * maximal matching run. These are the "common" segments.
 *
 * Uses the standard dynamic-programming LCS table. For very large
 * inputs (>5000 lines) this is O(N*M) memory — for that case a Web
 * Worker is recommended (see useMergeViewport.ts). Here we keep it
 * synchronous and simple — the common case (a few hundred lines per
 * conflict) is fast enough.
 */
function matchingBlocks(a: string[], b: string[]): Array<[number, number, number]> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = length of LCS of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // Walk forward to extract the matching pairs
  const blocks: Array<[number, number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      // Start a new block
      const startI = i, startJ = j;
      while (i < n && j < m && a[i] === b[j]) { i++; j++; }
      blocks.push([startI, startJ, i - startI]);
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return blocks;
}

/**
 * Merge the matching blocks of (base, ours) and (base, theirs) into a
 * single walk through base. At each base position we know:
 *   - whether ours matches (covered by an ours-block)
 *   - whether theirs matches (covered by a theirs-block)
 *
 * Between two consecutive base positions where BOTH match (or the
 * start/end), we have a "gap" on either side that needs classification.
 */
interface MatchPoint {
  baseIdx: number;
  oursIdx: number | null; // null = no match at this base position in ours
  theirsIdx: number | null;
}

function buildMatchPoints(
  base: string[],
  ours: string[],
  theirs: string[],
): MatchPoint[] {
  const oursBlocks = matchingBlocks(base, ours);
  const theirsBlocks = matchingBlocks(base, theirs);
  // For each base index, look up oursIdx / theirsIdx if covered.
  const oursAt = new Map<number, number>();
  for (const [bs, os, len] of oursBlocks) {
    for (let k = 0; k < len; k++) oursAt.set(bs + k, os + k);
  }
  const theirsAt = new Map<number, number>();
  for (const [bs, ts, len] of theirsBlocks) {
    for (let k = 0; k < len; k++) theirsAt.set(bs + k, ts + k);
  }
  // Boundaries = positions where BOTH ours and theirs have a match (these
  // are the "stable anchors" that we can sync on). Plus start and end.
  const points: MatchPoint[] = [];
  points.push({ baseIdx: 0, oursIdx: oursAt.get(0) ?? null, theirsIdx: theirsAt.get(0) ?? null });
  for (let bi = 1; bi < base.length; bi++) {
    // We treat a position as an anchor if ours OR theirs has a match here.
    // Actual classification happens in the walk.
    const oi = oursAt.get(bi) ?? null;
    const ti = theirsAt.get(bi) ?? null;
    if (oi !== null || ti !== null) {
      points.push({ baseIdx: bi, oursIdx: oi, theirsIdx: ti });
    }
  }
  points.push({
    baseIdx: base.length,
    oursIdx: ours.length,
    theirsIdx: theirs.length,
  });
  return points;
}

/**
 * Walk the MatchPoints and emit Regions for the gaps between anchors.
 *
 * Two consecutive anchor points P0 and P1 define a "chunk":
 *   base[chunk]   = base[P0.baseIdx .. P1.baseIdx]
 *   ours[chunk]   = ours[P0.oursIdx .. P1.oursIdx]   (using prev-match's
 *                                                  next position; null
 *                                                  means ours had no match
 *                                                  in this range)
 *   theirs[chunk] = theirs[P0.theirsIdx .. P1.theirsIdx]
 *
 * Classification:
 *   - If ours == base (chunk-by-chunk equal) and theirs != base  → changed-theirs
 *   - If theirs == base and ours != base                          → changed-ours
 *   - If ours == theirs (both changed the same way)               → stable (no conflict)
 *   - Otherwise                                                  → conflict
 */
function classifyChunk(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  baseStart: number, baseEnd: number,
  oursStart: number | null, oursEnd: number | null,
  theirsStart: number | null, theirsEnd: number | null,
): RegionKind {
  // Slice the three chunks. null means that side had no anchor before this
  // chunk — treat it as "the whole side is consumed past this point" →
  // effectively an empty chunk from that side.
  const baseChunk = baseLines.slice(baseStart, baseEnd);
  // For ours/theirs: when startIdx is null, we use the LAST known position
  // (which is the previous anchor's match). The caller (walkMatchPoints)
  // tracks last-known positions and passes them as non-null.
  const oursChunk = oursStart !== null && oursEnd !== null
    ? oursLines.slice(oursStart, oursEnd)
    : [];
  const theirsChunk = theirsStart !== null && theirsEnd !== null
    ? theirsLines.slice(theirsStart, theirsEnd)
    : [];
  // Quick equality checks (line-by-line)
  const baseEqOurs = baseChunk.length === oursChunk.length
    && baseChunk.every((l, i) => l === oursChunk[i]);
  const baseEqTheirs = baseChunk.length === theirsChunk.length
    && baseChunk.every((l, i) => l === theirsChunk[i]);
  const oursEqTheirs = oursChunk.length === theirsChunk.length
    && oursChunk.every((l, i) => l === theirsChunk[i]);
  if (oursEqTheirs) return 'stable'; // both sides agree (or both empty)
  if (baseEqOurs && !baseEqTheirs) return 'changed-theirs';
  if (baseEqTheirs && !baseEqOurs) return 'changed-ours';
  return 'conflict';
}

/**
 * Run diff3 on three line arrays. Returns the list of Regions in order.
 *
 * @param baseLines   common ancestor
 * @param oursLines   current branch (HEAD)
 * @param theirsLines incoming branch
 */
export function diff3(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
): Region[] {
  if (baseLines.length === 0 && oursLines.length === 0 && theirsLines.length === 0) {
    return [];
  }
  const points = buildMatchPoints(baseLines, oursLines, theirsLines);
  const regions: Region[] = [];
  // Track the last known position in each side as we walk.
  let prevBase = 0;
  let prevOurs: number | null = 0;
  let prevTheirs: number | null = 0;

  for (let pi = 0; pi < points.length; pi++) {
    const p = points[pi];
    // Determine the chunk range on each side.
    // For sides where p's index is null, we use prevKnown for that side
    // (chunk length 0 from that side).
    const baseEnd = p.baseIdx;
    const oursEnd = p.oursIdx;
    const theirsEnd = p.theirsIdx;
    // Only emit a region if the chunk is non-empty on at least one side.
    const baseLen = baseEnd - prevBase;
    const oursLen = oursEnd !== null && prevOurs !== null ? oursEnd - prevOurs : 0;
    const theirsLen = theirsEnd !== null && prevTheirs !== null ? theirsEnd - prevTheirs : 0;
    if (baseLen > 0 || oursLen > 0 || theirsLen > 0) {
      const kind = classifyChunk(
        baseLines, oursLines, theirsLines,
        prevBase, baseEnd,
        prevOurs, oursEnd,
        prevTheirs, theirsEnd,
      );
      regions.push({
        kind,
        baseStart: prevBase,
        baseLen,
        oursStart: prevOurs ?? 0,
        oursLen,
        theirsStart: prevTheirs ?? 0,
        theirsLen,
      });
    }
    // Advance prev pointers. If p has a null for a side, keep the prev value
    // (so the next chunk extends from where we last left off on that side).
    prevBase = baseEnd;
    if (oursEnd !== null) prevOurs = oursEnd;
    if (theirsEnd !== null) prevTheirs = theirsEnd;
  }
  // Merge adjacent regions of the same kind (optimization: fewer regions =
  // fewer React components + cleaner UI).
  return mergeAdjacentRegions(regions);
}

function mergeAdjacentRegions(regions: Region[]): Region[] {
  if (regions.length === 0) return regions;
  const out: Region[] = [regions[0]];
  for (let i = 1; i < regions.length; i++) {
    const last = out[out.length - 1];
    const r = regions[i];
    if (last.kind === r.kind) {
      // Merge into last
      last.baseLen += r.baseLen;
      last.oursLen += r.oursLen;
      last.theirsLen += r.theirsLen;
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * Convenience: count the conflicts in a region list.
 */
export function countConflicts(regions: Region[]): number {
  return regions.filter((r) => r.kind === 'conflict').length;
}

/**
 * Convenience: check whether the regions contain any conflict.
 */
export function hasConflicts(regions: Region[]): boolean {
  return regions.some((r) => r.kind === 'conflict');
}
