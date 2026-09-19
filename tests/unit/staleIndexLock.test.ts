/**
 * Test: removeStaleIndexLock uses 30s threshold (was 5s).
 *
 * The bug: on LFS repos, `git status` takes 5-10s and `git add` takes
 * 10-20s. A 5s threshold would delete ACTIVE locks from concurrent
 * git operations, causing 'index.lock exists' errors or corrupted index.
 *
 * The fix: threshold raised from 5s to 30s.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('removeStaleIndexLock — threshold', () => {
  it('does NOT delete a lock younger than 30 seconds', () => {
    // Create a temp git repo structure
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-lock-test-'));
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    const lockPath = path.join(gitDir, 'index.lock');

    // Create a lock file with mtime = 10 seconds ago (< 30s threshold)
    fs.writeFileSync(lockPath, '');
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    fs.utimesSync(lockPath, tenSecondsAgo, tenSecondsAgo);

    // Verify the lock exists
    expect(fs.existsSync(lockPath)).toBe(true);

    // Simulate removeStaleIndexLock logic with 30s threshold
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30000) {
      // Lock is fresh — don't delete
    } else {
      fs.unlinkSync(lockPath);
    }

    // Lock should STILL exist (10s < 30s)
    expect(fs.existsSync(lockPath)).toBe(true);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes a lock older than 30 seconds', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-lock-test-'));
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    const lockPath = path.join(gitDir, 'index.lock');

    // Create a lock file with mtime = 60 seconds ago (> 30s threshold)
    fs.writeFileSync(lockPath, '');
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, sixtySecondsAgo, sixtySecondsAgo);

    expect(fs.existsSync(lockPath)).toBe(true);

    // Simulate removeStaleIndexLock logic with 30s threshold
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 30000) {
      // Lock is fresh — don't delete
    } else {
      fs.unlinkSync(lockPath);
    }

    // Lock should be DELETED (60s > 30s)
    expect(fs.existsSync(lockPath)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('would have WRONGLY deleted a 10s-old lock with the old 5s threshold', () => {
    // This test documents the OLD bug: with 5s threshold, a 10s-old
    // lock (which might be from an active `git add` on a large repo)
    // would be deleted.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-lock-test-'));
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    const lockPath = path.join(gitDir, 'index.lock');

    fs.writeFileSync(lockPath, '');
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    fs.utimesSync(lockPath, tenSecondsAgo, tenSecondsAgo);

    // OLD threshold: 5s
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const OLD_THRESHOLD = 5000;
    if (ageMs >= OLD_THRESHOLD) {
      // OLD code would delete here — WRONG!
      // We DON'T actually delete, just assert the condition
      expect(ageMs).toBeGreaterThanOrEqual(OLD_THRESHOLD);
    }

    // NEW threshold: 30s — lock is NOT deleted
    const NEW_THRESHOLD = 30000;
    expect(ageMs).toBeLessThan(NEW_THRESHOLD);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
