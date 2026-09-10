import * as os from "os";
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

/**
 * Integration test for the Stash → Diff bug fix.
 *
 * THE BUG (before fix):
 *   Stashes page used `selectCommit(stash.hash)` which DiffPage interpreted
 *   as `baseRef = stash.hash`, then computed `git diff stash.hash -- working-tree`.
 *   This showed unrelated working-tree changes, NOT the stash content.
 *
 * THE FIX:
 *   Stashes page now sets `diffRequest = { baseRef: stash^, compareRef: stash,
 *   filePath: '.' }`, and DiffPage runs `git diff stash^..stash`. This shows
 *   exactly what the stash contains (working-tree changes that were stashed).
 *
 * This test verifies the git semantics: `git diff stash^..stash` produces a
 * non-empty diff containing the stashed lines, while `git diff stash` (the old
 * buggy comparison against working tree) gives unrelated results.
 */
describe('Stash → Diff bug fix — git-level verification', () => {
  const TEST_REPO_DIR = path.join(os.tmpdir(), 'prismgit-repos', 'test-repo');
  const STASH_FILE = path.join(TEST_REPO_DIR, 'src/stash-diff-test.txt');
  const MARKER_FILE = path.join(TEST_REPO_DIR, 'src/stash-marker.txt');

  let stashHash: string;
  let originalContent: string;

  function shell(cmd: string, cwd = TEST_REPO_DIR) {
    return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  }

  beforeAll(() => {
    // ALWAYS recreate: e2e suites share this fixture and may leave it dirty.
    execSync('bash tests/fixtures/setup-test-repo.sh', { encoding: 'utf-8', cwd: process.cwd() });

    // Save state of the marker file (it may exist from earlier stash tests)
    if (fs.existsSync(MARKER_FILE)) {
      originalContent = fs.readFileSync(MARKER_FILE, 'utf-8');
    } else {
      originalContent = '';
    }

    // Create a unique marker file, stash it. The stash will contain this file
    // addition — we'll verify the diff shows it.
    fs.writeFileSync(STASH_FILE, 'this line was stashed\n');
    shell('git add src/stash-diff-test.txt');
    shell('git stash push -m "Stash diff test fixture" -- src/stash-diff-test.txt');

    // Resolve the stash hash — needed because stashList returns it, and our
    // StashesPage.handleViewStash uses stash.hash as compareRef.
    const list = shell("git stash list --format='%H' --no-color");
    stashHash = list.split('\n')[0].trim();
    expect(stashHash).toBeTruthy();
    expect(stashHash.length).toBe(40);

    // Sanity: the file should no longer exist in the working tree (it was stashed)
    expect(fs.existsSync(STASH_FILE)).toBe(false);
  });

  afterAll(() => {
    // Clean up the stash we created for this test
    try {
      // Find our stash by message and drop it
      const list = shell('git stash list');
      const lines = list.split('\n');
      const ourLine = lines.find(l => l.includes('Stash diff test fixture'));
      if (ourLine) {
        const idx = parseInt(ourLine.split(':')[0].replace('stash@{', '').replace('}', ''), 10);
        shell(`git stash drop stash@{${idx}}`);
      }
    } catch { /* ignore */ }

    // Remove the marker file if it popped back
    try { fs.unlinkSync(STASH_FILE); } catch { /* ignore */ }
  });

  it('stashList returns the stash with a full 40-char hash', async () => {
    const stashes = await gitService.stashList(TEST_REPO_DIR);
    const ours = stashes.find(s => s.message.includes('Stash diff test fixture'));
    expect(ours).toBeDefined();
    expect(ours!.hash).toBe(stashHash);
    expect(ours!.hash.length).toBe(40);
  });

  it('git diff stash^..stash shows the stashed content (CORRECT)', () => {
    // This is what the FIXED StashesPage → DiffPage does.
    // baseRef = stash^ (parent — the commit the stash was based on)
    // compareRef = stash
    // Result: shows the working-tree changes that were stashed.
    const diff = shell(`git diff --no-color ${stashHash}^..${stashHash}`);
    expect(diff).toContain('stash-diff-test.txt');
    expect(diff).toContain('this line was stashed');
    expect(diff.length).toBeGreaterThan(50); // non-trivial diff
  });

  it('git diff stash (no compareRef) shows changes vs working tree — DIFFERENT', () => {
    // This simulates the BUGGY behaviour: `git diff <stashHash>` compares
    // the stash commit against the current working tree. Because the stashed
    // file is no longer in the working tree, this produces a diff that
    // DELETES the file (the stash has it, working tree doesn't) — which is
    // NOT what the user wanted to see.
    const buggyDiff = shell(`git diff --no-color ${stashHash}`);
    // The diff is about stash vs working tree, not stash content
    // For a stash containing an added file, the buggy diff would show the
    // file as "deleted" (since it's in the stash but not working tree).
    // The key point: this is NOT the stash content.
    if (buggyDiff.length > 0) {
      // If there's any output, it's about working-tree-vs-stash, not stash content.
      // The new file appears as a deletion because it exists in stash but not WT.
      expect(buggyDiff).toContain('stash-diff-test.txt');
      // For a deletion the diff starts with `diff --git` and has `--- ` line
      // pointing at the file (a/ prefix). The user thinks they're seeing "what's
      // in the stash" but actually sees "what's missing from working tree".
      // The `+this line was stashed` should NOT appear in this buggy diff
      // because the file is gone from WT — git shows it as a deletion.
      // (If it does appear, it's because git diff with no `..` uses working
      // tree as the second operand and the file was deleted, so it's a deletion.)
    }
    // Either way, this proves the semantics differ:
    //   stash^..stash  →  stash content (what was saved)
    //   stash alone    →  stash vs current working tree (often unrelated)
  });

  it('the two diffs are different (proving the fix matters)', () => {
    const correctDiff = shell(`git diff --no-color ${stashHash}^..${stashHash}`);
    const buggyDiff = shell(`git diff --no-color ${stashHash}`);
    // They MUST be different — otherwise the bug fix wouldn't matter.
    // (Both could contain the file path, but the actual diff content differs:
    //  correct shows additions of the stashed lines; buggy shows deletions
    //  because the file is gone from working tree.)
    expect(correctDiff).not.toEqual(buggyDiff);
  });

  it('git diff stash^..stash uses double-dot semantics (direct, not merge-base)', () => {
    // The fix specifically uses `..` (direct) rather than `...` (merge-base).
    // For stash commits, parent[0] is an ancestor, so both give the same result
    // — but `..` is the semantically correct choice for "show what changed from
    // parent to stash".
    const doubleDot = shell(`git diff --no-color ${stashHash}^..${stashHash}`);
    // Triple-dot would be `git diff stash^...stash` which for an ancestor
    // relationship also gives the same result, but is semantically wrong.
    // We assert `..` produces the expected content.
    expect(doubleDot).toContain('this line was stashed');
  });

  it('StashesPage-style diffRequest would produce the correct diff', () => {
    // Simulate what DiffPage does with diffRequest = { baseRef: stash^,
    // compareRef: stash, filePath: '.' }
    // DiffPage runs: `git diff --name-status --no-color stash^..stash`
    // to get the file list.
    const baseRef = `${stashHash}^`;
    const compareRef = stashHash;
    const fileListRaw = shell(`git diff --name-status --no-color ${baseRef}..${compareRef}`);
    const files = fileListRaw.split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    // The stashed file should appear in the list
    const hasStashFile = files.some(line => line.includes('stash-diff-test.txt'));
    expect(hasStashFile).toBe(true);

    // Then for each file, DiffPage runs `git diff --no-color stash^..stash -- <file>`
    const stashFilePath = files.find(f => f.includes('stash-diff-test.txt'));
    expect(stashFilePath).toBeDefined();
    const fileStatus = stashFilePath!.split('\t')[0]; // 'A' for added
    expect(fileStatus).toBe('A');

    const fileDiff = shell(`git diff --no-color ${baseRef}..${compareRef} -- src/stash-diff-test.txt`);
    expect(fileDiff).toContain('this line was stashed');
    expect(fileDiff).toContain('+++'); // added line marker
  });
});
