/**
 * Unit tests — benign-error classification for the `git:raw` IPC boundary
 * (src/lib/rawGitErrors.ts).
 *
 * Background: Electron's ipcMain.handle logs "Error occurred in handler
 * for 'git:raw'" to the main-process console for EVERY thrown error. The
 * user reported exactly this spam:
 *   Error occurred in handler for 'git:raw': Error: fatal: ambiguous
 *   argument 'main..origin/main': unknown revision or path not in the
 *   working tree.
 * (repeated for master..origin/master and v2..origin/v2). Root cause was
 * fixed at the source (fetchIncomingHashes validates refs first — commit
 * f23b3d3); these tests pin the DEFENSE-IN-DEPTH layer so any FUTURE
 * stale-range race (1s TTL ref-list cache, ref deleted by a concurrent
 * external tool, compare-dialog diff against a just-deleted branch)
 * degrades to '' instead of console spam.
 */
import { describe, it, expect } from 'vitest';
import { isBenignProbeError, isStaleRangeError, isBenignRawError } from '../../src/lib/rawGitErrors';

describe('isStaleRangeError', () => {
  // Exact messages from the user's production log.
  it('classifies the exact user-log messages as stale ranges', () => {
    expect(
      isStaleRangeError(
        "fatal: ambiguous argument 'main..origin/main': unknown revision or path not in the working tree."
      )
    ).toBe(true);
    expect(
      isStaleRangeError(
        "fatal: ambiguous argument 'master..origin/master': unknown revision or path not in the working tree."
      )
    ).toBe(true);
    expect(
      isStaleRangeError(
        "fatal: ambiguous argument 'v2..origin/v2': unknown revision or path not in the working tree."
      )
    ).toBe(true);
  });

  it('classifies triple-dot (symmetric) ranges as stale ranges', () => {
    // BranchesPage compare dialog: `git diff --name-status current...branch`
    expect(isStaleRangeError("fatal: ambiguous argument 'main...feature/x': unknown revision")).toBe(true);
  });

  it('handles the simple-git error envelope (task context + stderr dump)', () => {
    // simple-git prepends "task:" context lines around the raw stderr —
    // the fatal line itself stays INTACT on one line. The classifier must
    // find the quoted range argument anywhere in the envelope.
    const envelope = [
      "task: rev-list with path [ 'main..origin/main' ]",
      "fatal: ambiguous argument 'main..origin/main': unknown revision or path not in the working tree.",
      ' encountered error: GitError: task: rev-list with path [ ... ]',
    ].join('\n');
    expect(isStaleRangeError(envelope)).toBe(true);
  });

  it('does NOT swallow single-ref ambiguity (a real user typo propagates)', () => {
    // `git log v2` with no such branch — genuine failure, must throw.
    expect(isStaleRangeError("fatal: ambiguous argument 'v2': unknown revision or path not in the working tree.")).toBe(false);
    expect(isStaleRangeError('')).toBe(false);
  });

  it('does not match unrelated fatals', () => {
    expect(isStaleRangeError('fatal: not a git repository (or any of the parent directories): .git')).toBe(false);
    expect(isStaleRangeError("fatal: bad object HEAD")).toBe(false);
    expect(isStaleRangeError('')).toBe(false);
  });

  it('requires a QUOTED argument — plain mention of dots is not a range', () => {
    // e.g. an error text that merely contains "ambiguous" + ".." elsewhere
    expect(isStaleRangeError('something..weird went ambiguous without quotes')).toBe(false);
  });
});

describe('isBenignProbeError', () => {
  it('keeps the historical probe-error classes benign', () => {
    expect(isBenignProbeError("error: path 'src/old.ts' does not exist (neither on disk nor in the index)")).toBe(true);
    expect(isBenignProbeError("error: pathspec 'gone.txt' did not match any file(s) known to git")).toBe(true);
    expect(isBenignProbeError("error: path 'a.txt' is in the index, but not at stage 2")).toBe(true);
    expect(isBenignProbeError("no submodule mapping found in .gitmodules for path 'sub'")).toBe(true);
  });

  it('propagates messages that are none of the probe classes', () => {
    expect(isBenignProbeError('fatal: unable to access remote')).toBe(false);
    expect(isBenignProbeError('')).toBe(false);
  });
});

describe('isBenignRawError (handler decision)', () => {
  it('returns true for both probe and stale-range classes', () => {
    expect(isBenignRawError("error: pathspec 'x' did not match any file(s) known to git")).toBe(true);
    expect(isBenignRawError("fatal: ambiguous argument 'main..origin/main': unknown revision or path not in the working tree.")).toBe(true);
  });

  it('propagates real errors (network, auth, not-a-repo)', () => {
    expect(isBenignRawError('fatal: unable to access https://example.com/repo.git/')).toBe(false);
    expect(isBenignRawError('fatal: Authentication failed for repository')).toBe(false);
    expect(isBenignRawError('fatal: not a git repository')).toBe(false);
  });
});
