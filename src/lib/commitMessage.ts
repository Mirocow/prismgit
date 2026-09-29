/**
 * Commit-message comment handling (SmartGit: Preferences → Commands →
 * "Commit Comments"). Mirrors core git behavior: when git opens the editor,
 * every line starting with the configured comment character (core.commentChar,
 * default '#') is stripped before the commit is created.
 *
 * PrismGit edits the message in a <textarea>, so git never gets the chance —
 * the stripping (or the confirmation) must happen in the renderer before
 * api.git.commit() is called.
 *
 * Modes (settings.commitCommentsMode):
 *  - 'as-is' — commit the message untouched;
 *  - 'ask'   — detect comment-looking lines, let the user decide (default);
 *  - 'strip' — always remove comment-looking lines.
 */

/** The effective comment character. Multi-char core.commentChar values are
 *  supported by git (≥ 2.43) — pass the whole string through. */
export function resolveCommentChar(configValue: string | undefined | null): string {
  const v = (configValue ?? '').trim();
  if (!v) return '#';
  // 'auto' (the default) means: '#' unless the message starts with a
  // 'template'-style keyword — irrelevant for a textarea UI, keep '#'.
  if (v === 'auto') return '#';
  return v;
}

/**
 * True when the line looks like a comment: it STARTS with the comment char
 * (after leading whitespace) — the same rule git uses when cleaning up the
 * message. Empty lines are never comments.
 */
export function isCommentLine(line: string, commentChar: string): boolean {
  return line.trimStart().startsWith(commentChar);
}

/** Indices (into the split lines) of all comment-looking lines. */
export function findCommentLines(message: string, commentChar: string): number[] {
  const idx: number[] = [];
  message.split('\n').forEach((line, i) => {
    if (isCommentLine(line, commentChar)) idx.push(i);
  });
  return idx;
}

/**
 * Remove comment-looking lines from the message. Consecutive comment lines
 * collapse — the surrounding empty lines are trimmed so no double blank
 * gaps remain (same as git's cleanup=strip for the default template).
 * Returns the cleaned message; whitespace-only results become ''.
 */
export function stripCommitComments(message: string, commentChar: string): string {
  const kept = message
    .split('\n')
    .filter((line) => !isCommentLine(line, commentChar))
    .join('\n');
  // Trim leading/trailing blank lines and collapse 3+ consecutive blanks to 1.
  const lines = kept.split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun += 1;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    out.push(line);
  }
  return out.join('\n');
}
