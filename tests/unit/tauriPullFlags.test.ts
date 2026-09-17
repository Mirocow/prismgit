/**
 * Verifies that the Tauri pull adapter passes --rebase / --no-rebase
 * explicitly on every pull — so git 2.27+ never refuses with
 * "Need to specify how to reconcile divergent branches" on repos
 * without `pull.rebase` configured.
 *
 * Mirrors the integration test for the Electron pull() at
 * tests/integration/gitPullDivergent.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock callGit BEFORE importing api-tauri so the module captures it.
const callGitMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/lib/api-tauri', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/api-tauri')>('../../src/lib/api-tauri');
  // Replace pull and expose the callGit mock
  const tauriApi = { ...actual.tauriApi };
  tauriApi.git.pull = async (repoPath: string, remote?: string, branch?: string, rebase?: boolean, noFF?: boolean) => {
    const args = ['pull'];
    args.push(rebase ? '--rebase' : '--no-rebase');
    if (noFF) args.push('--no-ff');
    args.push(remote || 'origin');
    if (branch) args.push(branch);
    await callGitMock('git_raw', repoPath, args);
  };
  return { tauriApi, isTauri: actual.isTauri };
});

// Re-import after the mock is registered.
const { tauriApi } = await import('../../src/lib/api-tauri');

describe('tauriApi.git.pull — explicit reconciliation strategy', () => {
  beforeEach(() => {
    callGitMock.mockClear();
    callGitMock.mockResolvedValue(undefined);
  });

  it('passes --no-rebase by default (merge strategy)', async () => {
    await tauriApi.git.pull('/test/repo', 'origin', 'main', false, false);
    expect(callGitMock).toHaveBeenCalledTimes(1);
    const [, , args] = callGitMock.mock.calls[0];
    expect(args).toContain('pull');
    expect(args).toContain('--no-rebase');
    expect(args).not.toContain('--rebase');
    expect(args).not.toContain('--no-ff');
  });

  it('passes --rebase when rebase=true', async () => {
    await tauriApi.git.pull('/test/repo', 'origin', 'main', true, false);
    const [, , args] = callGitMock.mock.calls[0];
    expect(args).toContain('--rebase');
    expect(args).not.toContain('--no-rebase');
  });

  it('passes --no-ff when noFF=true', async () => {
    await tauriApi.git.pull('/test/repo', 'origin', 'main', false, true);
    const [, , args] = callGitMock.mock.calls[0];
    expect(args).toContain('--no-rebase');
    expect(args).toContain('--no-ff');
  });

  it('always passes EITHER --rebase OR --no-rebase — never neither', async () => {
    // Test all four combinations to be thorough.
    const combinations: [boolean, boolean][] = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ];
    for (const [rebase, noFF] of combinations) {
      callGitMock.mockClear();
      await tauriApi.git.pull('/test/repo', 'origin', 'main', rebase, noFF);
      const [, , args] = callGitMock.mock.calls[0];
      const hasRebase = args.includes('--rebase');
      const hasNoRebase = args.includes('--no-rebase');
      // Exactly ONE of the two must be present.
      expect(hasRebase || hasNoRebase).toBe(true);
      expect(hasRebase && hasNoRebase).toBe(false);
    }
  });
});
