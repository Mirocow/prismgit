/**
 * Fetch deduplication (per-repo in-flight mutex) — electron/services/git.ts.
 *
 * User-reported bug ("При запуске Fetch происходит 2 раза загрузка"): the same
 * repository could be fetched concurrently from several entry points (menu
 * accelerator + renderer keydown double-fire, History page auto-fetch,
 * sidebar poll, double click) — every caller downloaded everything again.
 *
 * Contract after the fix:
 *  - two concurrent fetch()/fetchAll() calls for the SAME repo run ONE
 *    `git fetch` process; the second caller joins the in-flight one;
 *  - a NEW call after the previous one settled runs a fresh fetch;
 *  - different repositories are independent;
 *  - failures propagate to every joined caller and release the mutex.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('simple-git', () => {
  const raw = vi.fn().mockResolvedValue('');
  const getRemotes = vi
    .fn()
    .mockResolvedValue([{ name: 'origin', refs: { fetch: 'http://example.com/r.git', push: '' } }]);
  const simpleGit = vi.fn(() => ({ raw, getRemotes }));
  // Expose the shared mocked methods — every getGit() instance returns them.
  return { default: simpleGit, __mocks: { raw, getRemotes } };
});

vi.mock('../../electron/services/storage.js', () => ({
  getSetting: vi.fn().mockReturnValue(undefined),
}));

import { fetch, fetchAll } from '../../electron/services/git';

const simpleGitModule = (await import('simple-git')) as unknown as {
  __mocks: { raw: ReturnType<typeof vi.fn> };
};
const raw = simpleGitModule.__mocks.raw;

describe('fetch dedupe — one download per repo at a time', () => {
  beforeEach(() => {
    raw.mockReset();
    raw.mockResolvedValue('');
  });

  // The service reaches git.raw only after awaiting remoteNetworkArgs —
  // flush a macrotask so the deferred mockImplementationOnce kicks in.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it('runs ONE git fetch when the same repo is fetched twice concurrently', async () => {
    let release!: () => void;
    raw.mockImplementationOnce(() => new Promise<void>((res) => { release = res; }));

    const p1 = fetch('/repo/dedupe', 'origin', true);
    const p2 = fetch('/repo/dedupe', 'origin', true);
    await flush();
    release();
    await Promise.all([p1, p2]);

    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('joins an in-flight fetchAll as well (menu Fetch vs History auto-fetch)', async () => {
    let release!: () => void;
    raw.mockImplementationOnce(() => new Promise<void>((res) => { release = res; }));

    const all = fetchAll('/repo/dedupe2', true);
    const one = fetch('/repo/dedupe2', 'origin', true, true);
    await flush();
    release();
    await Promise.all([all, one]);

    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('runs a fresh fetch after the previous one finished (mutex released)', async () => {
    await fetch('/repo/seq', 'origin', true);
    await fetch('/repo/seq', 'origin', true);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('fetches different repositories independently', async () => {
    let release!: () => void;
    raw.mockImplementationOnce(() => new Promise<void>((res) => { release = res; }));

    const a = fetch('/repo/a-plain', 'origin');
    const b = fetch('/repo/b-plain', 'origin');
    await flush();
    release();
    await Promise.all([a, b]);

    expect(raw).toHaveBeenCalledTimes(2);
  });

  it('propagates the failure to BOTH callers and releases the mutex', async () => {
    raw.mockImplementationOnce(() => Promise.reject(new Error('network down')));

    const p1 = fetch('/repo/fail', 'origin');
    const p2 = fetch('/repo/fail', 'origin');
    await expect(p1).rejects.toThrow(/network down/i);
    await expect(p2).rejects.toThrow(/network down/i);

    // Mutex released — the next fetch must actually run.
    await fetch('/repo/fail', 'origin');
    expect(raw).toHaveBeenCalledTimes(2);
  });
});
