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
 * Windows paths (C:\...) are not a concern here — git in the app runs on the
 * user's OS with forward slashes in grep output.
 */
export function parseGrepOutput(raw: string): GrepMatch[] {
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const first = l.indexOf(':');
      if (first === -1) return null;
      const second = l.indexOf(':', first + 1);
      if (second === -1) return null;
      const file = l.slice(0, first);
      const line = parseInt(l.slice(first + 1, second), 10);
      if (Number.isNaN(line)) return null;
      return { file, line, text: l.slice(second + 1) };
    })
    .filter((m): m is GrepMatch => m !== null);
}

export interface HighlightSegment {
  seg: string;
  hit: boolean;
}

/** Split a line into plain/highlighted segments around regex matches. */
export function highlight(text: string, pattern: string, ignoreCase: boolean): HighlightSegment[] {
  if (!pattern.trim()) return [{ seg: text, hit: false }];
  try {
    const re = new RegExp(pattern, ignoreCase ? 'gi' : 'g');
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
  } catch {
    // invalid regex — fall back to plain text
    return [{ seg: text, hit: false }];
  }
}

/**
 * Filter tracked files by a user query: matches basename FIRST, then the full
 * path; basename hits sort before path-only hits, then alphabetically.
 */
export function filterTrackedFiles(files: string[], query: string, limit = 200): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = files.filter((f) => {
    const base = f.slice(f.lastIndexOf('/') + 1).toLowerCase();
    return base.includes(q) || f.toLowerCase().includes(q);
  });
  scored.sort((a, b) => {
    const aBase = a.slice(a.lastIndexOf('/') + 1).toLowerCase();
    const bBase = b.slice(b.lastIndexOf('/') + 1).toLowerCase();
    const aHit = aBase.includes(q) ? 0 : 1;
    const bHit = bBase.includes(q) ? 0 : 1;
    return aHit - bHit || a.localeCompare(b);
  });
  return scored.slice(0, limit);
}
