/**
 * Unit tests for the idle chunk-preload queue used to warm lazily-loaded
 * page/dialog chunks (window/dialog open-speed optimization).
 *
 * The queue logic is injected with a fake idle scheduler — no DOM, no real
 * dynamic imports. Ordering, batching (one import per idle slice), completion
 * and cancellation are verified here.
 */
import { describe, it, expect, vi } from 'vitest';
import { runPreloadQueue, CHUNK_PRELOADERS, idleScheduler } from '../../src/hooks/useChunkPreload';

/** Deterministic idle scheduler: collects callbacks for manual draining. */
function makeFakeScheduler() {
  const queue: Array<() => void> = [];
  const scheduler = vi.fn((cb: () => void) => {
    queue.push(cb);
  });
  const drain = () => {
    // Drain everything currently queued (callbacks may enqueue more).
    while (queue.length) {
      queue.shift()!();
    }
  };
  return { scheduler, drain, size: () => queue.length };
}

describe('runPreloadQueue', () => {
  it('schedules the first preload on the first idle slice', () => {
    const { scheduler } = makeFakeScheduler();
    const preloads = [vi.fn().mockResolvedValue(undefined)];
    runPreloadQueue(preloads, scheduler as unknown as (cb: () => void, t: number) => void);
    expect(scheduler).toHaveBeenCalledTimes(1);
    expect(preloads[0]).not.toHaveBeenCalled(); // not yet idle
  });

  it('preloads exactly one chunk per idle slice, in order', () => {
    const { scheduler, drain } = makeFakeScheduler();
    const preloads = [1, 2, 3].map(() => vi.fn().mockResolvedValue(undefined));
    runPreloadQueue(preloads, scheduler as unknown as (cb: () => void, t: number) => void);

    // First idle slice → first chunk only
    scheduler.mock.calls[0][0]();
    expect(preloads[0]).toHaveBeenCalledTimes(1);
    expect(preloads[1]).not.toHaveBeenCalled();
    expect(preloads[2]).not.toHaveBeenCalled();

    // Second idle slice → second chunk only
    scheduler.mock.calls[1][0]();
    expect(preloads[1]).toHaveBeenCalledTimes(1);
    expect(preloads[2]).not.toHaveBeenCalled();

    // Third idle slice → third chunk, no further scheduling
    const callsBefore = scheduler.mock.calls.length;
    scheduler.mock.calls[2][0]();
    expect(preloads[2]).toHaveBeenCalledTimes(1);
    expect(scheduler.mock.calls.length).toBe(callsBefore);
  });

  it('runs the whole queue to completion when idle callbacks drain', () => {
    const { scheduler, drain } = makeFakeScheduler();
    const preloads = Array.from({ length: 5 }, () => vi.fn().mockResolvedValue(undefined));
    runPreloadQueue(preloads, scheduler as unknown as (cb: () => void, t: number) => void);
    drain();
    for (const p of preloads) expect(p).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops the queue — later chunks are never preloaded', () => {
    const { scheduler, drain } = makeFakeScheduler();
    const preloads = [vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)];
    const cancel = runPreloadQueue(preloads, scheduler as unknown as (cb: () => void, t: number) => void);

    scheduler.mock.calls[0][0](); // first chunk fires
    cancel();
    drain(); // pending idle callback must become a no-op

    expect(preloads[0]).toHaveBeenCalledTimes(1);
    expect(preloads[1]).not.toHaveBeenCalled();
  });

  it('survives rejected preloads (best-effort by design)', () => {
    const { scheduler, drain } = makeFakeScheduler();
    const failing = vi.fn().mockRejectedValue(new Error('chunk fetch failed'));
    const following = vi.fn().mockResolvedValue(undefined);
    const preloads = [failing, following];
    runPreloadQueue(preloads, scheduler as unknown as (cb: () => void, t: number) => void);
    expect(() => drain()).not.toThrow();
    expect(following).toHaveBeenCalledTimes(1);
  });

  it('never schedules anything for an empty queue', () => {
    const { scheduler } = makeFakeScheduler();
    runPreloadQueue([], scheduler as unknown as (cb: () => void, t: number) => void);
    expect(scheduler).not.toHaveBeenCalled();
  });
});

describe('CHUNK_PRELOADERS registry', () => {
  it('covers pages + heavy dialogs and is non-empty', () => {
    expect(CHUNK_PRELOADERS.length).toBeGreaterThanOrEqual(30);
    for (const p of CHUNK_PRELOADERS) {
      expect(typeof p).toBe('function');
    }
  });

  it('idleScheduler falls back to setTimeout when requestIdleCallback is absent', () => {
    vi.useFakeTimers();
    const w = window as unknown as { requestIdleCallback?: unknown };
    const hadRic = 'requestIdleCallback' in w;
    const original = w.requestIdleCallback;
    delete w.requestIdleCallback;
    const cb = vi.fn();
    idleScheduler(cb, 1000);
    vi.advanceTimersByTime(120);
    expect(cb).toHaveBeenCalled();
    if (hadRic) w.requestIdleCallback = original;
    vi.useRealTimers();
  });
});
