/**
 * Pure helpers for the Search (Investigate) tool.
 */

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Parse `git grep --line-number` output: `path:line:text`.
 *
 * Robustness notes:
 *   - Empty input → empty array (was an array with one empty string before).
 *   - Lines without a colon (or with one colon but no second one) are
 *     skipped instead of producing NaN line numbers.
 *   - Windows-style paths with a drive letter (C:\repo\file.ts) — git grep
 *     with `-z` / NUL separators would be cleaner, but for the line-based
 *     output we parse here we accept both forward and back slashes.
 *   - The text part is kept verbatim, including any colons it may contain.
 *
 * The previous implementation would silently drop lines that contained
 * colons in the file path (rare on POSIX, common on Windows). The fix is
 * to find the FIRST colon (path separator) and the SECOND colon (line/text
 * separator) — same as before, but now with the empty-input and NaN guards.
 */
export function parseGrepOutput(raw: string): GrepMatch[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const first = l.indexOf(':');
      if (first === -1) return null;
      const second = l.indexOf(':', first + 1);
      if (second === -1) return null;
      const file = l.slice(0, first);
      const lineStr = l.slice(first + 1, second);
      const line = parseInt(lineStr, 10);
      if (!Number.isFinite(line) || line <= 0) return null;
      return { file, line, text: l.slice(second + 1) };
    })
    .filter((m): m is GrepMatch => m !== null);
}

export interface HighlightSegment {
  seg: string;
  hit: boolean;
}

/**
 * Split a line into plain/highlighted segments around regex matches.
 * Falls back to plain text on invalid regex (so the user can keep typing
 * without seeing an exception).
 *
 * Note: when the regex contains capturing groups, only the FULL match (m[0])
 * is highlighted — partial group highlighting would require a separate
 * per-group pass and isn't worth the complexity for the search use case.
 */
export function highlight(text: string, pattern: string, ignoreCase: boolean): HighlightSegment[] {
  if (!text) return [{ seg: '', hit: false }];
  if (!pattern || !pattern.trim()) return [{ seg: text, hit: false }];
  // Anchor the pattern as a substring search when the user typed a plain
  // alphanumeric string — this avoids the surprise of "function(" matching
  // "function" (regex grouping). We detect "plain alphanumeric" by checking
  // that the pattern doesn't contain any regex special characters.
  const isPlain = /^[a-zA-Z0-9_\-./ ]+$/.test(pattern);
  const re = (() => {
    try {
      if (isPlain) {
        // Escape regex special chars in the pattern so a literal search works.
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped, ignoreCase ? 'gi' : 'g');
      }
      return new RegExp(pattern, ignoreCase ? 'gi' : 'g');
    } catch {
      // Invalid regex — fall back to plain substring search (escaped).
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { return new RegExp(escaped, ignoreCase ? 'gi' : 'g'); } catch { return null; }
    }
  })();
  if (!re) return [{ seg: text, hit: false }];
  const out: HighlightSegment[] = [];
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ seg: text.slice(last, m.index), hit: false });
    out.push({ seg: m[0], hit: true });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++; // avoid infinite loops on empty matches
  }
  if (last < text.length) out.push({ seg: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ seg: text, hit: false }];
}

/**
 * Filter tracked files by a user query: matches basename FIRST, then the full
 * path; basename hits sort before path-only hits, then alphabetically.
 *
 * The filter now also supports SPACE-separated multi-token queries — each
 * token must appear (in any order) in either the basename or the path.
 * This lets the user type "src tsx" to find `src/components/Button.tsx`
 * instead of typing the full path.
 */
export function filterTrackedFiles(files: string[], query: string, limit = 200): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Split on whitespace — each token must match (basename OR path).
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored = files.filter((f) => {
    const base = f.slice(f.lastIndexOf('/') + 1).toLowerCase();
    const lower = f.toLowerCase();
    return tokens.every((tok) => base.includes(tok) || lower.includes(tok));
  });
  scored.sort((a, b) => {
    const aBase = a.slice(a.lastIndexOf('/') + 1).toLowerCase();
    const bBase = b.slice(b.lastIndexOf('/') + 1).toLowerCase();
    // Stronger match: basename starts with the FIRST token.
    const aStarts = aBase.startsWith(tokens[0]) ? 0 : 1;
    const bStarts = bBase.startsWith(tokens[0]) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    // Then: basename contains the first token.
    const aBaseHit = aBase.includes(tokens[0]) ? 0 : 1;
    const bBaseHit = bBase.includes(tokens[0]) ? 0 : 1;
    if (aBaseHit !== bBaseHit) return aBaseHit - bBaseHit;
    // Then: alphabetical.
    return a.localeCompare(b);
  });
  return scored.slice(0, limit);
}
