/**
 * Word-level diff using LCS (Longest Common Subsequence) algorithm.
 *
 * Adapted from AngKorGit's `packages/core/src/diff/wordDiff.ts`.
 * Tokenizes each line into word/whitespace/punctuation tokens, then computes
 * the LCS to find which segments were added, removed, or kept.
 *
 * Used to highlight inline word-level changes when showing a +/- pair.
 */

const WORD_DIFF_MAX_CELLS = 500_000; // 500k — O(m*n) cap

export type WordSegmentKind = 'equal' | 'added' | 'removed';

export interface WordSegment {
  kind: WordSegmentKind;
  text: string;
}

export interface WordDiffResult {
  old: WordSegment[];
  new: WordSegment[];
}

/** Tokenize a line into word, whitespace, and punctuation tokens. */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /\w+|\s+|[^\w\s]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Compute word-level diff between two lines using LCS.
 * Returns segments for the old line and the new line.
 * If lines are too long (m*n > WORD_DIFF_MAX_CELLS), returns the lines as-is without word-diff.
 */
export function wordDiff(oldLine: string, newLine: string): WordDiffResult {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const m = a.length;
  const n = b.length;

  // Fallback for very long lines
  if (m * n > WORD_DIFF_MAX_CELLS || (m === 0 && n === 0)) {
    return {
      old: [{ kind: 'equal', text: oldLine }],
      new: [{ kind: 'equal', text: newLine }],
    };
  }
  if (m === 0) {
    return { old: [], new: [{ kind: 'added', text: newLine }] };
  }
  if (n === 0) {
    return { old: [{ kind: 'removed', text: oldLine }], new: [] };
  }

  // LCS DP table — Uint32Array for memory efficiency
  // dp[i][j] = LCS length of a[0..i) and b[0..j)
  const dp = new Uint32Array((m + 1) * (n + 1));
  const idx = (i: number, j: number) => i * (n + 1) + j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[idx(i, j)] = dp[idx(i - 1, j - 1)] + 1;
      } else {
        dp[idx(i, j)] = Math.max(dp[idx(i - 1, j)], dp[idx(i, j - 1)]);
      }
    }
  }

  // Backtrace from dp[m][n]
  const oldSegs: WordSegment[] = [];
  const newSegs: WordSegment[] = [];
  let i = m, j = n;

  // We build segments in reverse, then reverse at the end
  const oldRev: WordSegment[] = [];
  const newRev: WordSegment[] = [];

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      oldRev.push({ kind: 'equal', text: a[i - 1] });
      newRev.push({ kind: 'equal', text: b[j - 1] });
      i--; j--;
    } else if (dp[idx(i - 1, j)] >= dp[idx(i, j - 1)]) {
      oldRev.push({ kind: 'removed', text: a[i - 1] });
      i--;
    } else {
      newRev.push({ kind: 'added', text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    oldRev.push({ kind: 'removed', text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    newRev.push({ kind: 'added', text: b[j - 1] });
    j--;
  }

  // Reverse
  oldRev.reverse();
  newRev.reverse();

  // Merge consecutive same-kind segments
  for (const seg of oldRev) {
    const last = oldSegs[oldSegs.length - 1];
    if (last && last.kind === seg.kind) {
      last.text += seg.text;
    } else {
      oldSegs.push({ ...seg });
    }
  }
  for (const seg of newRev) {
    const last = newSegs[newSegs.length - 1];
    if (last && last.kind === seg.kind) {
      last.text += seg.text;
    } else {
      newSegs.push({ ...seg });
    }
  }

  return { old: oldSegs, new: newSegs };
}
