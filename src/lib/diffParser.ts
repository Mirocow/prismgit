/**
 * Git diff parser — parses unified diff output into structured hunks and lines
 */

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'hunk-header';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  newFile: boolean;
  deletedFile: boolean;
  renamedFile: boolean;
  modeChange?: { oldMode: number; newMode: number };
}

export function parseDiff(rawDiff: string): ParsedDiff {
  const lines = rawDiff.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let newFile = false;
  let deletedFile = false;
  let renamedFile = false;
  let modeChange: { oldMode: number; newMode: number } | undefined;

  for (const line of lines) {
    if (line.startsWith('new file mode')) newFile = true;
    if (line.startsWith('deleted file mode')) deletedFile = true;
    if (line.startsWith('rename from') || line.startsWith('rename to')) renamedFile = true;
    const modeMatch = line.match(/^old mode (\d+)$/) || line.match(/^new mode (\d+)$/);
    if (modeMatch) {
      const mode = parseInt(modeMatch[1], 10);
      if (line.startsWith('old mode')) modeChange = { oldMode: mode, newMode: modeChange?.newMode ?? mode };
      if (line.startsWith('new mode')) modeChange = { oldMode: modeChange?.oldMode ?? mode, newMode: mode };
    }
    if (line.startsWith('diff --git')) continue;
    if (line.startsWith('index ')) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (match) {
        const oldStart = parseInt(match[1], 10);
        const oldLines = match[2] ? parseInt(match[2], 10) : 1;
        const newStart = parseInt(match[3], 10);
        const newLines = match[4] ? parseInt(match[4], 10) : 1;
        currentHunk = {
          oldStart,
          oldLines,
          newStart,
          newLines,
          header: line,
          lines: [],
        };
        oldLine = oldStart;
        newLine = newStart;
      }
      continue;
    }
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'add',
          content: line.substring(1),
          oldLineNumber: null,
          newLineNumber: newLine++,
        });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'del',
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: null,
        });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line.substring(1),
          oldLineNumber: oldLine++,
          newLineNumber: newLine++,
        });
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return { hunks, newFile, deletedFile, renamedFile, modeChange };
}

export function countDiffStats(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      else if (line.type === 'del') deletions++;
    }
  }
  return { additions, deletions };
}

export function isBinaryDiff(rawDiff: string): boolean {
  return rawDiff.includes('Binary files') || rawDiff.includes('GIT binary patch');
}
