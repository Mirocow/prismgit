/**
 * Fetch timeout KILL (not just a caller-side rejection) — pollRemoteSummary.
 *
 * User-reported: "проверка удаленных репозиториев тормозит приложение и при
 * переключении от репозитория к репозиторию сильно возрастает время".
 *
 * The old implementation raced the fetch against a 60s timer with
 * Promise.race: the CALLER was rejected, but the git fetch subprocess kept
 * running. Every poll cycle against a slow/hung remote spawned a fresh fetch
 * while the previous ones were still alive — zombie processes accumulated,
 * and the app degraded the longer it ran (worst while switching repos, which
 * kept the poller in 30s boost mode).
 *
 * Contract after the fix:
 *  - the poll's fetch instance is constructed with simple-git's
 *    timeoutPlugin (`timeout: { block: REMOTE_FETCH_TIMEOUT_MS }`), which
 *    KILLS the child after 60s without output (inactivity timeout — a
 *    slow-but-streaming download is never killed);
 *  - the poll's LOCAL commands (symbolic-ref / rev-list ×2 / status) run on
 *    a dedicated instance, NOT the shared getGit queue the foreground
 *    repo-open burst depends on;
 *  - simple-git's 'block timeout reached' rejection is surfaced as the same
 *    "fetch timed out after Ns" message the old race produced.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Captured constructor options of every simpleGit(...) call, shared through
// the module mock so the test can assert instance-level configuration.
const instances: Array<Record<string, unknown>> = [];

vi.mock('simple-git', () => {
  const raw = vi.fn().mockResolvedValue('');
  const getRemotes = vi
    .fn()
    .mockResolvedValue([{ name: 'origin', refs: { fetch: 'http://example.com/r.git', push: '' } }]);
  // env: the service pipes the merged child environment through the
  // supported .env() builder — the mock must accept (and ignore) it.
  const simpleGit = vi.fn((opts: Record<string, unknown>) => {
    instances.push(opts ?? {});
    return { raw, getRemotes, env: vi.fn().mockReturnThis() };
  });
  return { default: simpleGit, simpleGit, __mocks: { raw, getRemotes } };
});

vi.mock('../../electron/services/storage.js', () => ({
  getSetting: vi.fn().mockReturnValue(undefined),
}));

import { pollRemoteSummary, clearPollCache } from '../../electron/services/git';
import { getSetting } from '../../electron/services/storage';

const simpleGitModule = (await import('simple-git')) as unknown as {
  __mocks: { raw: ReturnType<typeof vi.fn>; getRemotes: ReturnType<typeof vi.fn> };
};
const raw = simpleGitModule.__mocks.raw;

let repo = '';
let root = '';

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-poll-kill-'));
  repo = path.join(root, 'work');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  // Opt the repo's origin remote into the background poll so the fetch path runs.
  vi.mocked(getSetting).mockImplementation((key: string) =>
    key === 'backgroundFetchRemotes' ? { [repo]: ['origin'] } : undefined
  );
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('pollRemoteSummary — fetch subprocess is KILLED on timeout', () => {
  beforeEach(() => {
    // pollCache is module state in git.ts — without this, the 60s TTL would
    // serve the first test's summary to the following ones (no fetch, no
    // new instances) — same pattern as tests/integration/remoteCheck.test.ts.
    clearPollCache();
    raw.mockReset();
    raw.mockResolvedValue('');
    instances.length = 0;
  });

  it('constructs the fetch instance with timeout.block = 60s (kills hung children)', async () => {
    const summary = await pollRemoteSummary(repo);
    expect(summary.remotes).toEqual(['origin']);
    // One of the constructed instances must be the dedicated FETCH instance
    // with the kill-on-inactivity timeout configured.
    const fetchInstance = instances.find((o) => (o as { timeout?: { block?: number } }).timeout?.block === 60_000);
    expect(fetchInstance).toBeDefined();
    // And the fetch itself ran through it.
    const fetchCall = raw.mock.calls.find((c) => (c[0] as string[]).includes('fetch'));
    expect(fetchCall).toBeDefined();
    expect((fetchCall![0] as string[])).toContain('origin');
    expect((fetchCall![0] as string[])).toContain('--prune');
  });

  it('runs the LOCAL poll commands on a dedicated non-timeout instance (decoupled from the foreground queue)', async () => {
    await pollRemoteSummary(repo);
    // The local-commands instance: maxConcurrentProcesses set, no kill timeout.
    const localInstance = instances.find(
      (o) => (o as { maxConcurrentProcesses?: number }).maxConcurrentProcesses === 4 && !(o as { timeout?: unknown }).timeout
    );
    expect(localInstance).toBeDefined();
    // All four local reads are present in the raw call log.
    const allArgs = raw.mock.calls.map((c) => (c[0] as string[]).join(' '));
    expect(allArgs.some((a) => a.includes('symbolic-ref'))).toBe(true);
    expect(allArgs.filter((a) => a.includes('rev-list'))).toHaveLength(2);
    expect(allArgs.some((a) => a.includes('status --porcelain'))).toBe(true);
  });

  it("maps simple-git's 'block timeout reached' to the historical timeout message", async () => {
    raw.mockImplementation((args: unknown) => {
      const argv = (args as string[]).join(' ');
      if (argv.includes('fetch')) {
        return Promise.reject(new Error('block timeout reached'));
      }
      return Promise.resolve('');
    });
    const summary = await pollRemoteSummary(repo);
    expect(summary.error).toBeDefined();
    expect(summary.error).toMatch(/fetch timed out after 60s.*process killed/);
    expect(summary.fetched).toBe(false);
  });
});
