/**
 * Merged index scan for the Changes page — ONE `git ls-files -v` instead of
 * TWO full index reads.
 *
 * PERF (v3.1): repo open used to run BOTH `git ls-files` (tracked count +
 * unchanged-files list) and `git ls-files -v` (assume-unchanged /
 * skip-worktree flags) — two full index walks that produce almost the same
 * output: `-v` is the plain listing with a one-char tag PREFIX per line.
 * On a 50k-file repo each walk is 100-300ms of pure duplicate I/O.
 *
 * The tag letters (git docs, `git help ls-files`, -v mode):
 *   H = cached (regular tracked file)      S = skip-worktree
 *   M = unmerged (conflict)                h/K/k/m = assume-unchanged variants
 *   R = removed/deleted from index
 * Lowercase h means the file is BOTH cached AND assume-unchanged; k/K are
 * other assume-unchanged spelling variants older/newer git emits. We treat
 * any lowercase tag that is not 'h'/'k' as assume-unchanged too — matching
 * the previous parser's conservative set (h, k, l, m, n) exactly, no more.
 *
 * Quoted paths: git C-quotes paths with special characters
 * (`"src/uni\303\251.ts"`); `core.quotepath=false` avoids it but we don't
 * control global config, so the parser strips the surrounding quotes the
 * same way the numstat parser in ChangesPage does (leading+trailing only —
 * the escape sequences are rare and were ALSO kept verbatim by the old
 * separate loaders, so behavior is identical).
 */

/** The single argv that feeds the merged scan. */
export const LS_FILES_V_ARGS = ['ls-files', '-v'] as const;

export interface IndexScanResult {
  /** Total number of tracked entries (tag char + path per line). */
  trackedTotal: number;
  /** Plain tracked paths (tag stripped). */
  trackedFiles: string[];
  /** Paths with an assume-unchanged tag (lowercase h/k/l/m/n). */
  assumeUnchanged: string[];
  /** Paths with the skip-worktree tag (S). */
  skipped: string[];
}

/**
 * Parse `git ls-files -v` output into all four datasets the Changes page
 * needs. Line format: `<tag><space?><path>` — git prints `<tag> <path>`
 * (single space) for regular tags; the old parser used `line.slice(1).trim()`
 * which tolerates any spacing, so we keep that behavior.
 */
export function parseLsFilesV(out: string): IndexScanResult {
  const trackedFiles: string[] = [];
  const assumeUnchanged: string[] = [];
  const skipped: string[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const tag = line[0];
    let p = line.slice(1).trim();
    if (!p) continue;
    // Strip git's C-quoting the same way the numstat parser does.
    if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
      p = p.slice(1, -1);
    }
    trackedFiles.push(p);
    if (tag === 'h' || tag === 'k' || tag === 'l' || tag === 'm' || tag === 'n') {
      assumeUnchanged.push(p);
    }
    if (tag === 'S') {
      skipped.push(p);
    }
  }
  return {
    trackedTotal: trackedFiles.length,
    trackedFiles,
    assumeUnchanged,
    skipped,
  };
}
