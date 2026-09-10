/**
 * Conflict markers parser — extracts conflict hunks from a file content
 * with Git conflict markers (<<<<<<<, =======, >>>>>>>)
 */

export interface ConflictHunk {
  startLine: number;
  oursStart: number;
  oursLines: string[];
  theirsStart: number;
  theirsLines: string[];
  endLine: number;
}

export function parseConflicts(content: string): ConflictHunk[] {
  const lines = content.split('\n');
  const hunks: ConflictHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i;
      const oursStart = i + 1;
      const oursLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) {
        oursLines.push(lines[i]);
        i++;
      }
      i++; // skip =======
      const theirsStart = i;
      const theirsLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirsLines.push(lines[i]);
        i++;
      }
      i++; // skip >>>>>>> ...
      hunks.push({
        startLine,
        oursStart,
        oursLines,
        theirsStart,
        theirsLines,
        endLine: i,
      });
    } else {
      i++;
    }
  }
  return hunks;
}

export function buildResolvedContent(content: string, hunks: ConflictHunk[], resolutions: Map<number, string[]>): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let i = 0;
  let hunkIdx = 0;
  while (i < lines.length) {
    if (hunkIdx < hunks.length && i === hunks[hunkIdx].startLine) {
      const resolved = resolutions.get(hunkIdx);
      if (resolved) {
        result.push(...resolved);
      } else {
        result.push(...lines.slice(i, hunks[hunkIdx].endLine));
      }
      i = hunks[hunkIdx].endLine;
      hunkIdx++;
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result.join('\n');
}

export function hasConflicts(content: string): boolean {
  return content.includes('<<<<<<<') && content.includes('>>>>>>>');
}

export function countConflicts(content: string): number {
  return parseConflicts(content).length;
}
