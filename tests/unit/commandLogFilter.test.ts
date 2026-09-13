import { describe, it, expect } from 'vitest';
// We test isUserCommand via the CommandLogPanel export. The function is
// pure — it takes a string[] (git args) and returns a boolean — so we can
// test it in isolation without rendering React.
//
// To avoid bundling the entire CommandLogPanel component, we extract the
// function via a small re-export trick. The function lives in
// src/components/CommandLogPanel.tsx and is exported from there.
import { isUserCommand } from '../../src/components/CommandLogPanel';

/**
 * Comprehensive tests for isUserCommand() — the filter that decides which
 * captured git commands are "user-initiated" (shown in the OUTPUT panel by
 * default) vs "automatic/system" (hidden by default, shown when the user
 * toggles "System").
 *
 * The bug we're guarding against: previously, two-word commands like
 * 'stash list', 'reflog show', 'lfs ls-files' were not recognized as
 * always-system because ALWAYS_SYSTEM was checked against positional[0]
 * alone (e.g. 'stash'), not against the two-word combination. This caused
 * read-only listing commands to leak into the "user commands" view.
 *
 * Symmetrically, some 'git <cmd>' alone (no subcommand) cases were mis-
 * classified: 'git reflog' alone is equivalent to 'git reflog show'
 * (read-only), but 'reflog' was in USER_COMMANDS, so it showed as user.
 *
 * The fix:
 * 1. Multi-word ALWAYS_SYSTEM check via ALWAYS_SYSTEM_MULTI set.
 * 2. Explicit per-command handlers for stash/remote/lfs/submodule/worktree/
 *    notes/reflog/bisect — each knows its read-only vs mutating subcommands.
 * 3. ALWAYS_SYSTEM extended with the bare-command forms ('stash', 'reflog',
 *    'remote', 'lfs', 'notes', 'submodule', 'worktree') so 'git <cmd>' alone
 *    is treated as system (read-only listing) — explicit handler above
 *    decides for the with-subcommand case.
 */
describe('isUserCommand — user vs system classification', () => {
  describe('mutating commands → user', () => {
    const userCases: Array<[string, string[]]> = [
      ['push', ['push', 'origin', 'main']],
      ['pull', ['pull', '--rebase']],
      ['fetch with prune', ['fetch', 'origin', '--prune']],
      ['commit', ['commit', '-m', 'msg']],
      ['add', ['add', '--', 'file.txt']],
      ['checkout', ['checkout', 'main']],
      ['checkout new branch', ['checkout', '-b', 'feature/x']],
      ['merge', ['merge', '--no-ff', 'feature/x']],
      ['rebase', ['rebase', 'origin/main']],
      ['reset hard', ['reset', '--hard', 'HEAD~1']],
      ['restore', ['restore', '--staged', 'file.txt']],
      ['clean', ['clean', '-fd']],
      ['rm', ['rm', '--cached', 'file.txt']],
      ['mv', ['mv', 'old.txt', 'new.txt']],
      ['tag create', ['tag', '-a', 'v1.0', '-m', 'release']],
      ['clone', ['clone', 'https://example.com/repo.git']],
      ['init', ['init', '/path/to/repo']],
      ['cherry-pick', ['cherry-pick', 'abc123']],
      ['revert', ['revert', 'abc123']],
    ];
    for (const [name, args] of userCases) {
      it(`'${name}' is user`, () => {
        expect(isUserCommand(args)).toBe(true);
      });
    }
  });

  describe('read-only commands → system (ALWAYS_SYSTEM)', () => {
    const systemCases: Array<[string, string[]]> = [
      ['status', ['status']],
      ['status short', ['status', '--short', '--branch']],
      ['log', ['log', '--oneline', '-10']],
      ['rev-parse HEAD', ['rev-parse', 'HEAD']],
      ['rev-list', ['rev-list', '--count', 'HEAD']],
      ['for-each-ref', ['for-each-ref', '--format=%(refname)', 'refs/heads/']],
      ['diff', ['diff', 'HEAD']],
      ['diff-tree', ['diff-tree', '-r', 'HEAD']],
      ['show', ['show', 'HEAD']],
      ['ls-files', ['ls-files']],
      ['ls-remote', ['ls-remote', '--heads', 'origin']],
      ['cat-file', ['cat-file', '-p', 'HEAD:README.md']],
      ['merge-base', ['merge-base', 'HEAD', 'origin/main']],
      ['symbolic-ref', ['symbolic-ref', 'HEAD']],
      ['config get', ['config', '--get', 'user.name']],
      ['config list', ['config', '--list']],
      ['config --global write', ['config', '--global', 'user.name', 'Foo']], // treated as system (config writes are rare, user can toggle System)
      ['describe', ['describe', '--tags']],
      ['shortlog', ['shortlog', '-sn', 'HEAD']],
    ];
    for (const [name, args] of systemCases) {
      it(`'${name}' is system`, () => {
        expect(isUserCommand(args)).toBe(false);
      });
    }
  });

  describe('two-word read-only subcommands → system (ALWAYS_SYSTEM_MULTI)', () => {
    const systemMultiCases: Array<[string, string[]]> = [
      ['stash list', ['stash', 'list']],
      ['stash show', ['stash', 'show', 'stash@{0}']],
      ['reflog show', ['reflog', 'show']],
      ['reflog show -n', ['reflog', 'show', '-n', '5']],
      ['lfs ls-files', ['lfs', 'ls-files']],
      ['lfs status', ['lfs', 'status']],
      ['notes list', ['notes', 'list']],
      ['notes show', ['notes', 'show', 'HEAD']],
      ['submodule status', ['submodule', 'status']],
      ['submodule summary', ['submodule', 'summary']],
      ['worktree list', ['worktree', 'list']],
      ['remote show', ['remote', 'show', 'origin']],
    ];
    for (const [name, args] of systemMultiCases) {
      it(`'${name}' is system`, () => {
        expect(isUserCommand(args)).toBe(false);
      });
    }
  });

  describe('bare commands (no subcommand) → system', () => {
    // 'git stash' alone is read-only-ish (defaults to 'git stash push' but
    // our codebase always passes an explicit subcommand — defensive: system).
    // 'git reflog' alone = 'git reflog show' = read-only.
    // 'git remote' alone = read-only listing.
    // 'git lfs' alone = unusual (no-op), treated as system.
    // 'git notes' alone = unusual, system.
    // 'git submodule' alone = read-only listing.
    // 'git worktree' alone = read-only listing.
    // 'git branch' alone = read-only listing.
    const bareCases: Array<[string, string[]]> = [
      ['stash', ['stash']],
      ['reflog', ['reflog']],
      ['remote', ['remote']],
      ['remote -v', ['remote', '-v']],
      ['lfs', ['lfs']],
      ['notes', ['notes']],
      ['submodule', ['submodule']],
      ['worktree', ['worktree']],
      ['branch', ['branch']],
      ['branch -a', ['branch', '-a']],
      ['branch -r', ['branch', '-r']],
    ];
    for (const [name, args] of bareCases) {
      it(`'${name}' is system`, () => {
        expect(isUserCommand(args)).toBe(false);
      });
    }
  });

  describe('subcommands that mutate → user', () => {
    const userSubCases: Array<[string, string[]]> = [
      ['stash push', ['stash', 'push', '-u']],
      ['stash pop', ['stash', 'pop', 'stash@{0}']],
      ['stash apply', ['stash', 'apply']],
      ['stash drop', ['stash', 'drop', 'stash@{0}']],
      ['stash branch', ['stash', 'branch', 'new-branch']],
      ['stash clear', ['stash', 'clear']],
      ['remote add', ['remote', 'add', 'origin', 'https://example.com/repo.git']],
      ['remote remove', ['remote', 'remove', 'old-origin']],
      ['remote rename', ['remote', 'rename', 'old', 'new']],
      ['remote set-url', ['remote', 'set-url', 'origin', 'https://example.com/repo.git']],
      ['remote prune', ['remote', 'prune', 'origin']],
      ['lfs install', ['lfs', 'install']],
      ['lfs pull', ['lfs', 'pull']],
      ['lfs push', ['lfs', 'push']],
      ['lfs fetch', ['lfs', 'fetch']],
      ['lfs track', ['lfs', 'track', '*.mp4']],
      ['lfs untrack', ['lfs', 'untrack', '*.mp4']],
      ['submodule init', ['submodule', 'init']],
      ['submodule update', ['submodule', 'update', '--init', '--recursive']],
      ['submodule deinit', ['submodule', 'deinit', '-f', 'sub']],
      ['submodule sync', ['submodule', 'sync']],
      ['submodule add', ['submodule', 'add', 'https://example.com/sub.git', 'sub']],
      ['worktree add', ['worktree', 'add', '/path/to/wt', '-b', 'new-branch']],
      ['worktree remove', ['worktree', 'remove', '/path/to/wt', '--force']],
      ['worktree move', ['worktree', 'move', '/old', '/new']],
      ['worktree prune', ['worktree', 'prune']],
      ['notes add', ['notes', 'add', '-m', 'note', 'HEAD']],
      ['notes remove', ['notes', 'remove', 'HEAD']],
      ['reflog delete', ['reflog', 'delete', 'HEAD@{1}']],
      ['reflog expire', ['reflog', 'expire', '--all']],
      ['bisect start', ['bisect', 'start']],
      ['bisect bad', ['bisect', 'bad']],
      ['bisect good', ['bisect', 'good', 'v1.0']],
      ['bisect reset', ['bisect', 'reset']],
      ['branch new', ['branch', 'new-branch']],
      ['branch delete', ['branch', '-d', 'old-branch']],
      ['branch rename', ['branch', '-m', 'old', 'new']],
    ];
    for (const [name, args] of userSubCases) {
      it(`'${name}' is user`, () => {
        expect(isUserCommand(args)).toBe(true);
      });
    }
  });

  describe('edge cases', () => {
    it('empty args → false', () => {
      expect(isUserCommand([])).toBe(false);
    });
    it('null args → false', () => {
      expect(isUserCommand(null as unknown as string[])).toBe(false);
    });
    it('unknown command → false (defensive)', () => {
      expect(isUserCommand(['totally-unknown-command'])).toBe(false);
    });
    it('flags only → false (no positional command)', () => {
      expect(isUserCommand(['--version'])).toBe(false);
      expect(isUserCommand(['--help'])).toBe(false);
    });
    it('-C <path> prefix is stripped correctly', () => {
      // simple-git / spawnGitCapture never pass -C <path> — they use cwd —
      // but defensive: 'git -C /repo push origin main' should still be user.
      expect(isUserCommand(['-C', '/path/to/repo', 'push', 'origin', 'main'])).toBe(true);
      expect(isUserCommand(['-C', '/path/to/repo', 'status'])).toBe(false);
    });
  });
});
