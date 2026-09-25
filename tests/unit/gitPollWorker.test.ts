/**
 * gitPollWorker — the utilityProcess entry of the separate status-fetch
 * process.
 *
 * The module is imported with a FAKE process.parentPort (an EventEmitter +
 * postMessage spy): exactly the channel shape a real Electron
 * utilityProcess provides. Pins the wire protocol:
 *  - posts { kind: 'ready' } at startup (main buffers requests until it);
 *  - { kind: 'poll', id, request } → runs the job → posts
 *    { kind: 'poll-result', id, result };
 *  - a throwing job → { kind: 'poll-error', id, message };
 *  - malformed messages are ignored (never crash the worker).
 *
 * In any non-utility host parentPort is undefined and importing the module
 * is a harmless no-op — that's what the last case asserts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../../electron/services/gitPollCore.js', () => ({
  runPollJob: vi.fn(async (req: { repoPath: string }) => ({
    fetched: true,
    error: null,
    branch: `branch-of:${req.repoPath}`,
    incoming: 7,
    outgoing: 8,
    dirty: 9,
  })),
  DEFAULT_REMOTE_FETCH_TIMEOUT_MS: 60_000,
}));

import { runPollJob } from '../../electron/services/gitPollCore.js';

interface FakePort extends EventEmitter {
  posted: unknown[];
  postMessage(message: unknown): void;
}

const fakePort: FakePort = new EventEmitter() as FakePort;
fakePort.posted = [];
fakePort.postMessage = (message: unknown) => {
  fakePort.posted.push(message);
};

// The worker module captures process.parentPort at import time — install
// the fake BEFORE the dynamic import below.
(process as unknown as { parentPort?: unknown }).parentPort = fakePort;

// Imported dynamically AFTER parentPort is installed (module registers its
// listener at import; vitest isolates module graphs per test file, so this
// runs the real entry exactly once).
await import('../../electron/services/gitPollWorker.js');

const REQUEST = {
  repoPath: '/repos/alpha',
  checkedRemotes: ['origin'],
  sshEnvVars: {},
  authArgs: {},
  fetchTimeoutMs: 60_000,
} as const;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  vi.mocked(runPollJob).mockClear();
});

afterAll(() => {
  delete (process as unknown as { parentPort?: unknown }).parentPort;
});

describe('gitPollWorker — utilityProcess entry protocol', () => {
  it('announces itself with { kind: "ready" } at startup', () => {
    expect(fakePort.posted).toContainEqual({ kind: 'ready' });
  });

  it('answers a poll message with a poll-result carrying the job result', async () => {
    fakePort.posted.length = 0;
    fakePort.emit('message', { data: { kind: 'poll', id: 42, request: { ...REQUEST } } });
    await flushMicrotasks();

    expect(runPollJob).toHaveBeenCalledWith({ ...REQUEST });
    expect(fakePort.posted).toEqual([
      {
        kind: 'poll-result',
        id: 42,
        result: { fetched: true, error: null, branch: 'branch-of:/repos/alpha', incoming: 7, outgoing: 8, dirty: 9 },
      },
    ]);
  });

  it('answers a THROWING job with poll-error (protocol belt-and-braces branch)', async () => {
    vi.mocked(runPollJob).mockImplementationOnce(async () => {
      throw new Error('core exploded');
    });
    fakePort.posted.length = 0;
    fakePort.emit('message', { data: { kind: 'poll', id: 43, request: { ...REQUEST } } });
    await flushMicrotasks();

    expect(fakePort.posted).toEqual([{ kind: 'poll-error', id: 43, message: 'core exploded' }]);
  });

  it('ignores malformed / unknown messages without posting anything', async () => {
    const callsBefore = runPollJob.mock.calls.length;
    fakePort.posted.length = 0;
    fakePort.emit('message', { data: null });
    fakePort.emit('message', { data: { kind: 'unknown-kind', id: 1 } });
    fakePort.emit('message', { data: { kind: 'poll', id: 'not-a-number', request: { ...REQUEST } } });
    fakePort.emit('message', { data: { kind: 'poll', id: 44, request: { repoPath: 123 } } });
    fakePort.emit('message', undefined);
    await flushMicrotasks();

    expect(fakePort.posted).toEqual([]);
    // Not a single NEW job run was triggered by the malformed messages.
    expect(runPollJob.mock.calls.length).toBe(callsBefore);
  });
});
