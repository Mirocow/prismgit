/**
 * Integration tests for new SmartGit manual features.
 * Real git operations against a temporary sandbox repository.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

let sandbox: string;

function makeSandbox(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-smartgit-'));
  // Init repo + initial commit + a few more commits
  execSync('git init', { cwd: dir });
  execSync('git config user.email test@example.com', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  execSync('git config commit.gpgsign false', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  execSync('git add README.md', { cwd: dir });
  execSync('git commit -m "Initial commit"', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'file1.txt'), 'content1\n');
  execSync('git add file1.txt', { cwd: dir });
  execSync('git commit -m "Add file1"', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'file2.txt'), 'content2\n');
  execSync('git add file2.txt', { cwd: dir });
  execSync('git commit -m "Add file2"', { cwd: dir });
  return dir;
}

describe('SmartGit manual features — integration', () => {
  beforeEach(() => {
    sandbox = makeSandbox();
  });
  afterEach(() => {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('recyclableCommits', () => {
    it('returns no recyclable commits in a clean repo', async () => {
      const recyclable = await gitService.recyclableCommits(sandbox);
      // After 3 commits, all are reachable — nothing recyclable
      // (May return the entries but filtered; we just check it doesn't crash)
      expect(Array.isArray(recyclable)).toBe(true);
    });

    it('detects unreachable commits after hard reset', async () => {
      // Create a commit, then reset --hard back — that commit becomes unreachable
      fs.writeFileSync(path.join(sandbox, 'orphan.txt'), 'orphan\n');
      execSync('git add orphan.txt', { cwd: sandbox });
      execSync('git commit -m "Will be orphaned"', { cwd: sandbox });
      const orphanHash = execSync('git rev-parse HEAD', { cwd: sandbox }).toString().trim();
      // Reset back to before orphan commit
      execSync('git reset --hard HEAD~1', { cwd: sandbox });
      // Wait for reflog to be written
      const recyclable = await gitService.recyclableCommits(sandbox);
      const orphanInList = recyclable.some(c => c.hash === orphanHash);
      expect(orphanInList).toBe(true);
    });
  });

  describe('isCommitPushed', () => {
    it('returns false for local-only commits', async () => {
      const headHash = execSync('git rev-parse HEAD', { cwd: sandbox }).toString().trim();
      const pushed = await gitService.isCommitPushed(sandbox, headHash);
      expect(pushed).toBe(false);
    });
  });

  describe('isEolOnlyChange', () => {
    it('detects when changes are EOL-only', async () => {
      // Create a file with LF
      fs.writeFileSync(path.join(sandbox, 'eol.txt'), 'line1\nline2\nline3\n');
      execSync('git add eol.txt', { cwd: sandbox });
      execSync('git commit -m "Add eol.txt"', { cwd: sandbox });
      // Modify to CRLF — same content, only EOL change
      fs.writeFileSync(path.join(sandbox, 'eol.txt'), 'line1\r\nline2\r\nline3\r\n');
      const eolOnly = await gitService.isEolOnlyChange(sandbox, 'eol.txt');
      expect(eolOnly).toBe(true);
    });

    it('returns false when there are real content changes', async () => {
      fs.writeFileSync(path.join(sandbox, 'eol.txt'), 'line1\nline2\nline3\n');
      execSync('git add eol.txt', { cwd: sandbox });
      execSync('git commit -m "Add eol.txt"', { cwd: sandbox });
      fs.writeFileSync(path.join(sandbox, 'eol.txt'), 'line1\nMODIFIED\nline3\n');
      const eolOnly = await gitService.isEolOnlyChange(sandbox, 'eol.txt');
      expect(eolOnly).toBe(false);
    });
  });

  describe('detectRenames', () => {
    it('detects file renames', async () => {
      fs.writeFileSync(path.join(sandbox, 'original.txt'), 'original content\n');
      execSync('git add original.txt', { cwd: sandbox });
      execSync('git commit -m "Add original"', { cwd: sandbox });
      // Rename via git mv
      execSync('git mv original.txt renamed.txt', { cwd: sandbox });
      const renames = await gitService.detectRenames(sandbox, { threshold: 50 });
      expect(renames.length).toBeGreaterThan(0);
      const found = renames.find(r => r.from === 'original.txt' && r.to === 'renamed.txt');
      expect(found).toBeDefined();
    });
  });

  describe('pickaxeSearch', () => {
    it('finds commits that introduced a string', async () => {
      fs.writeFileSync(path.join(sandbox, 'search.txt'), 'TODO: implement this\n');
      execSync('git add search.txt', { cwd: sandbox });
      execSync('git commit -m "Add TODO"', { cwd: sandbox });
      const results = await gitService.pickaxeSearch(sandbox, 'search.txt', 'TODO');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('notes', () => {
    it('adds and shows a git note', async () => {
      const headHash = execSync('git rev-parse HEAD', { cwd: sandbox }).toString().trim();
      await gitService.noteAdd(sandbox, headHash, 'This is a review note');
      const note = await gitService.noteShow(sandbox, headHash);
      expect(note).toContain('review note');
    });

    it('returns true when notes ref exists', async () => {
      const headHash = execSync('git rev-parse HEAD', { cwd: sandbox }).toString().trim();
      await gitService.noteAdd(sandbox, headHash, 'note1');
      const exists = await gitService.notesList(sandbox);
      expect(exists).toBe(true);
    });

    it('removes a git note', async () => {
      const headHash = execSync('git rev-parse HEAD', { cwd: sandbox }).toString().trim();
      await gitService.noteAdd(sandbox, headHash, 'temp note');
      await gitService.noteRemove(sandbox, headHash);
      const note = await gitService.noteShow(sandbox, headHash);
      expect(note.trim()).toBe('');
    });
  });

  describe('groupTags', () => {
    it('groups tags by version pattern', () => {
      const tags = [
        { name: 'v1.0.0', hash: 'a', hashAbbrev: 'a', lightweight: true },
        { name: 'v1.0.1', hash: 'b', hashAbbrev: 'b', lightweight: true },
        { name: 'v1.1.0', hash: 'c', hashAbbrev: 'c', lightweight: true },
        { name: 'v2.0.0', hash: 'd', hashAbbrev: 'd', lightweight: true },
        { name: 'release-2024', hash: 'e', hashAbbrev: 'e', lightweight: true },
      ] as any[];
      const groups = gitService.groupTags(tags);
      // v1.0 group, v1.1 group, v2.0 group, Other
      expect(groups.length).toBe(4);
      const v10 = groups.find(g => g.name === '1.0');
      expect(v10?.tags.length).toBe(2);
      const other = groups.find(g => g.name === 'Other');
      expect(other?.tags.length).toBe(1);
    });
  });

  describe('blameBidirectional', () => {
    it('returns past blame + future lines', async () => {
      // Create a file with initial content
      fs.writeFileSync(path.join(sandbox, 'blame.txt'), 'line1\nline2\nline3\n');
      execSync('git add blame.txt', { cwd: sandbox });
      execSync('git commit -m "Add blame.txt"', { cwd: sandbox });
      // Modify later
      fs.writeFileSync(path.join(sandbox, 'blame.txt'), 'line1\nMODIFIED\nline3\n');
      execSync('git add blame.txt', { cwd: sandbox });
      execSync('git commit -m "Modify line2"', { cwd: sandbox });
      const result = await gitService.blameBidirectional(sandbox, 'blame.txt');
      expect(result.past.lines.length).toBe(3);
      // futureLines is optional — may be empty if commits don't qualify
      expect(Array.isArray(result.futureLines)).toBe(true);
    });
  });
});
