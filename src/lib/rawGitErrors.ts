/**
 * Benign-error classification for the `git:raw` IPC boundary.
 *
 * The `git:raw` handler (electron/ipc/git.ts) executes ARBITRARY argv from
 * the renderer. When a command fails, Electron's `ipcMain.handle` logs
 * "Error occurred in handler for 'git:raw'" to the main-process console for
 * EVERY thrown error — even when the renderer already handles the rejection
 * via `.catch(() => '')` and the failure is an EXPECTED probe, not a bug.
 *
 * Two failure classes are benign (the correct degraded answer is an EMPTY
 * string, not an exception):
 *
 * 1. PROBE errors — the renderer intentionally probes for things that may
 *    not exist: merge stages (`:1:file`, `:2:file`, `:3:file`), pathspecs
 *    of deleted files, submodule entries whose `.gitmodules` mapping was
 *    removed, index stages of files that are no longer conflicted. The
 *    renderer's contract is `''` = "not there".
 *
 * 2. STALE RANGE errors — `git rev-list main..origin/main` /
 *    `git diff A..B` / `git log A...B` die with
 *      fatal: ambiguous argument 'main..origin/main': unknown revision
 *      or path not in the working tree.
 *    when either side of the range no longer resolves. This is a RACE, not
 *    a user error: the UI read the ref list (for-each-ref), the user (or a
 *    concurrent fetch --prune / branch delete in ANOTHER tool) removed the
 *    ref, and the follow-up range command then fails. For every caller
 *    (incoming-commit sets, compare diffs) an unresolvable range side
 *    means "no commits / no differences" — exactly what an empty output
 *    conveys. The renderer's catch handlers already degrade to empty; this
 *    classification only removes the main-process console noise.
 *
 *    Deliberately restricted to RANGE arguments (containing '..'): a bare
 *    single ref (`ambiguous argument 'v2'`) is still a REAL error and
 *    propagates — a typo'd ref in a user-initiated command deserves a
 *    visible failure, an ephemeral range race does not.
 *
 * Pure functions, no imports — used by the main process AND unit tests.
 */

/** Messages of intentionally-absent probes (see class 1 above). */
const BENIGN_PROBE_RE =
  /does not exist|did not match any file|not in the index|no submodule mapping found|but not at stage/i;

/** True when the failure is an expected "not there" probe. */
export function isBenignProbeError(message: string): boolean {
  return BENIGN_PROBE_RE.test(message);
}

/**
 * True when git failed with `fatal: ambiguous argument 'X..Y'` where the
 * quoted argument is a RANGE (`A..B` or `A...B`). See class 2 above.
 */
export function isStaleRangeError(message: string): boolean {
  // Grab the QUOTED argument from the fatal line so the '..' check applies
  // to the argument git complained about — not to some other part of a
  // multi-line error dump (simple-git prepends "task:" context lines).
  const m = /ambiguous argument '([^']+)'/.exec(message);
  return m !== null && m[1].includes('..');
}

/**
 * Should the `git:raw` handler answer this failure with `''` instead of
 * re-throwing it (and flooding the main-process console)?
 */
export function isBenignRawError(message: string): boolean {
  return isBenignProbeError(message) || isStaleRangeError(message);
}
