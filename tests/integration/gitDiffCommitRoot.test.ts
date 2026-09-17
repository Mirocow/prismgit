/**
 * Reproduces the user-reported bug:
 *   Error occurred in handler for 'git:raw':
 *   Error: fatal: bad revision '19642537704da732049b1ee1b07dee01fc909d73^..19642537704da732049b1ee1b07dee01fc909d73'
 *
 * Root cause: diffCommit() did `${hash}^..${hash}` when no parentHash was
 * supplied. The `^` resolves to the first parent — which doesn't exist
 * for the ROOT commit (a commit with no parents). git exits with:
 *   fatal: ambiguous argument '<root>^..<root>': unknown revision
 *
 * The fix: check whether the commit has any parents via
 * `git rev-list --parents -n 1 <hash>`. For root commits, use
 * `git diff --root <hash>` instead. For non-root commits, use the
 * explicit first parent `<parent>..<hash>` instead of the syntactic
 * `^` form (equivalent, but doesn't break when parent lookup fails).
 *
 * Test setup: a repo with one root commit (no parents) and one
 * non-root commit (one parent). Verify diffCommit works for both.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { diffCommit } from '../../electron/services/git';

const ROOT = '/tmp/prismgit-diffcommit-root-test';
const REPO = `${ROOT}/repo`;

const NL = String.fromCharCode(10);

function sh(cmd: string, cwd: string = REPO) {
  // mkdir -p the cwd if it doesn't exist (cwd: needs to exist for execSync)
  if (cwd !== ROOT) {
    const fs = require('node:fs');
    if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });
  }
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

let rootHash = '';
let nonRootHash = '';
let nonRootParent = '';

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  // Create REPO dir so `git init` can run with cwd=REPO.
  mkdirSync(REPO, { recursive: true });

  sh('git init -q -b main', REPO);
  sh('git config user.name "T"', REPO);
  sh('git config user.email "t@t"', REPO);

  // Root commit — no parents.
  writeFileSync(`${REPO}/a.txt`, 'a' + NL);
  sh('git add a.txt', REPO);
  sh('git commit -q -m "init (root)"', REPO);
  rootHash = execSync(`git -C ${REPO} rev-parse HEAD`, { encoding: 'utf-8' }).trim();

  // Non-root commit — one parent.
  writeFileSync(`${REPO}/b.txt`, 'b' + NL);
  sh('git add b.txt', REPO);
  sh('git commit -q -m "second (non-root)"', REPO);
  nonRootHash = execSync(`git -C ${REPO} rev-parse HEAD`, { encoding: 'utf-8' }).trim();
  nonRootParent = execSync(`git -C ${REPO} rev-parse HEAD^`, { encoding: 'utf-8' }).trim();
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('diffCommit — root commit support', () => {
  it('returns a non-empty diff for the ROOT commit (no parents)', async () => {
    // Before the fix: throws 'fatal: bad revision <root>^..<root>'.
    // After the fix: returns the diff (a.txt as new file).
    const result = await diffCommit(REPO, rootHash);
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.newPath).toBe(rootHash);
  });

  it('returns a non-empty diff for a non-root commit (one parent)', async () => {
    const result = await diffCommit(REPO, nonRootHash);
    expect(result.hunks.length).toBeGreaterThan(0);
  });

  it('accepts an explicit parentHash for non-root commits', async () => {
    const result = await diffCommit(REPO, nonRootHash, nonRootParent);
    expect(result.hunks.length).toBeGreaterThan(0);
  });

  it('returns the root commit diff with --root when no parentHash given', async () => {
    const result = await diffCommit(REPO, rootHash);
    const fileEntry = result.hunks[0];
    expect(fileEntry).toBeDefined();
  });

  it('returns an empty diff for a non-existent commit (graceful failure)', async () => {
    const result = await diffCommit(REPO, '0'.repeat(40));
    expect(result.hunks.length).toBe(0);
  });
});
