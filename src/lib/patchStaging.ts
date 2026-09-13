/**
 * Patch-level staging logic — shared between Electron and Tauri backends.
 *
 * These functions parse `git diff --unified=0` output and filter hunks
 * to a user-selected set of line ranges, producing a patch that can be
 * applied to the index via `git apply --cached`.
 *
 * The parsing is pure JS (no Node/Tauri dependencies) so it can run in
 * both the Electron main process and the Tauri renderer.
 */

interface UZeroHunk {
  header: string;
  lines: string[];
  type: 'add' | 'del' | 'mixed';
}

/**
 * Parse a `git diff --unified=0` output into its file header + hunks.
 * Line numbers inside -U0 hunks are implicit: old lines are sequential
 * from the header's -start, new lines sequential from the +start.
 */
export function parseUnifiedZero(diffOut: string): { header: string; hunks: UZeroHunk[] } {
  const lines = diffOut.split('\n');
  const hunkIdx = lines.findIndex((l) => l.startsWith('@@ -'));
  if (hunkIdx === -1) return { header: '', hunks: [] };
  const header = lines.slice(0, hunkIdx).join('\n');
  const hunks: UZeroHunk[] = [];
  let current: UZeroHunk | null = null;
  for (let i = hunkIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@ -')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [], type: 'add' };
    } else if (current) {
      if (line.startsWith('diff --git')) break;
      if (line.startsWith('+') || line.startsWith('-')) {
        const isAdd = line.startsWith('+');
        const isDel = line.startsWith('-');
        if (isAdd && current.lines.some((l) => l.startsWith('-'))) current.type = 'mixed';
        else if (isDel && current.lines.some((l) => l.startsWith('+'))) current.type = 'mixed';
        else if (isDel && current.lines.length === 0) current.type = 'del';
        current.lines.push(line);
      }
    }
  }
  if (current) hunks.push(current);
  return { header, hunks };
}

/** Is `n` inside any of the inclusive ranges? */
function inRanges(n: number, ranges: { start: number; end: number }[]): boolean {
  return ranges.some((r) => n >= r.start && n <= r.end);
}

/**
 * Filter PURE hunks (only adds or only dels) to the selected line subset
 * and recompute zero-context hunk headers.
 */
export function filterPureHunks(hunks: UZeroHunk[], ranges: { start: number; end: number }[]): string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    if (hunk.type === 'add') {
      const startNew = parseInt(hunk.header.match(/\+(\d+)/)![1], 10);
      const keptIdx = hunk.lines.map((_, i) => startNew + i).filter((n) => inRanges(n, ranges));
      if (keptIdx.length === 0) continue;
      if (keptIdx.length === hunk.lines.length) {
        out.push(hunk.header, ...hunk.lines);
      } else {
        const minNew = keptIdx[0];
        const keptLines = hunk.lines.filter((_, i) => inRanges(startNew + i, ranges));
        out.push(`@@ -${minNew - 1},0 +${minNew},${keptIdx.length} @@`, ...keptLines);
      }
    } else {
      const startOld = parseInt(hunk.header.match(/^@@ -(\d+)/)![1], 10);
      const keptIdx = hunk.lines.map((_, i) => startOld + i).filter((n) => inRanges(n, ranges));
      if (keptIdx.length === 0) continue;
      if (keptIdx.length === hunk.lines.length) {
        out.push(hunk.header, ...hunk.lines);
      } else {
        const minOld = keptIdx[0];
        const keptLines = hunk.lines.filter((_, i) => inRanges(startOld + i, ranges));
        out.push(`@@ -${minOld},${keptIdx.length} +${minOld - 1},0 @@`, ...keptLines);
      }
    }
  }
  return out;
}

/**
 * Mixed hunks are all-or-nothing (same as `git add -p`): keep the hunk
 * only if at least one add line's new number OR del line's old number
 * is selected.
 */
export function filterMixedHunks(hunks: UZeroHunk[], ranges: { start: number; end: number }[]): string[] {
  const out: string[] = [];
  for (const hunk of hunks) {
    const startOld = parseInt(hunk.header.match(/^@@ -(\d+)/)![1], 10);
    const startNew = parseInt(hunk.header.match(/\+(\d+)/)![1], 10);
    let oldNo = startOld;
    let newNo = startNew;
    let selected = false;
    for (const l of hunk.lines) {
      if (l.startsWith('+')) {
        if (inRanges(newNo, ranges)) selected = true;
        newNo++;
      } else {
        if (inRanges(oldNo, ranges)) selected = true;
        oldNo++;
      }
    }
    if (selected) out.push(hunk.header, ...hunk.lines);
  }
  return out;
}

/**
 * Build a filtered patch from the raw diff output and selected line ranges.
 * Returns null when nothing matches the selection.
 */
export function buildFilteredPatch(
  diffOut: string,
  lineRanges: { start: number; end: number }[]
): string | null {
  const { header, hunks } = parseUnifiedZero(diffOut);
  if (hunks.length === 0) return null;
  const pure = filterPureHunks(hunks.filter((h) => h.type !== 'mixed'), lineRanges);
  const mixed = filterMixedHunks(hunks.filter((h) => h.type === 'mixed'), lineRanges);
  const body = [...pure, ...mixed];
  if (body.length === 0) return null;
  return `${header}\n${body.join('\n')}\n`;
}
