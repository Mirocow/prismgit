/**
 * Unit tests for the watcher debounce with MAX-WAIT cap (v3).
 *
 * The old debounce restarted its 500ms timer on EVERY event, so a sustained
 * stream of fs events (git checkout of many files, `git gc`, IDE auto-save)
 * postponed the renderer notification indefinitely — the UI's status could
 * stay stale forever while events kept arriving. The v3 max-wait cap
 * guarantees delivery within DEBOUNCE_MAX_WAIT_MS (2s) of the FIRST event.
 *
 * These tests drive the debounce seam directly (__watcherTestHooks) with
 * fake timers — no real filesystem events, fully deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock electron: capture BrowserWindow.getAllWindows().send(...) calls ──
type SentMessage = { repoPath: string; eventType: string; timestamp: number };
const sent: SentMessage[] = [];
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (_channel: string, payload: SentMessage) => {
            sent.push(payload);
          },
        },
      },
    ],
  },
}));

import { __watcherTestHooks } from '../../electron/services/watcher';

const REPO = '/tmp/watcher-test-repo';

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watcher debounce — burst ends → single trailing notification', () => {
  it('delivers once, 500ms after the last event of a short burst', () => {
    const entry = __watcherTestHooks.makeEntry(REPO);
    __watcherTestHooks.debounce(entry, 'worktree');
    vi.advanceTimersByTime(200);
    __watcherTestHooks.debounce(entry, 'worktree');
    vi.advanceTimersByTime(200);
    __watcherTestHooks.debounce(entry, 'worktree');
    // 500ms after the LAST event (we're at +400ms since it) → not yet.
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ repoPath: REPO, eventType: 'worktree' });
    __watcherTestHooks.clearTimers(entry);
  });
});

describe('watcher debounce — max-wait cap prevents starvation (v3 fix)', () => {
  it('flushes within 2s even when events keep arriving non-stop', () => {
    const entry = __watcherTestHooks.makeEntry(REPO);
    // Simulate a sustained event stream: an event every 300ms for 4.8s —
    // every event restarts the 500ms trailing timer, so WITHOUT the
    // max-wait cap no notification would EVER fire (starvation).
    // Flush schedule with the cap: t≈2000 (max-wait #1), t≈4100
    // (max-wait #2, armed by the first event after flush #1).
    let t = 0;
    __watcherTestHooks.debounce(entry, 'worktree');
    while (t < 4800) {
      vi.advanceTimersByTime(300);
      t += 300;
      __watcherTestHooks.debounce(entry, 'worktree');
      // ── THE assertion: by 2s+ε after the FIRST event, at least one
      //    notification must have been delivered.
      if (t === 2100) {
        expect(sent.length).toBeGreaterThanOrEqual(1);
      }
    }
    // Over the whole stream: flush at ~2000 and ~4100 → exactly 2
    // (bounds tolerate scheduling jitter).
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThanOrEqual(3);
    __watcherTestHooks.clearTimers(entry);
  });

  it('first flush carries the first event type of the burst (max-wait path)', () => {
    const entry = __watcherTestHooks.makeEntry(REPO);
    __watcherTestHooks.debounce(entry, 'head');
    // Flood with different event types — the max-wait flush fires 2s after
    // the first event and delivers the event type it was armed with.
    let t = 0;
    while (t < 2000) {
      vi.advanceTimersByTime(250);
      t += 250;
      __watcherTestHooks.debounce(entry, 'worktree');
    }
    vi.advanceTimersByTime(50); // total 2050ms since first event
    expect(sent.length).toBeGreaterThanOrEqual(1);
    // The max-wait timer was armed with the FIRST event ('head').
    expect(sent[0].eventType).toBe('head');
    __watcherTestHooks.clearTimers(entry);
  });
});

describe('watcher debounce — timer hygiene', () => {
  it('normal trailing flush cancels the max-wait guard (no double notify)', () => {
    const entry = __watcherTestHooks.makeEntry(REPO);
    __watcherTestHooks.debounce(entry, 'index');
    // Event, then 500ms of quiet → trailing flush fires at +500ms.
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(1);
    // The max-wait guard (armed at t=0 for t=2000) must have been CANCELED
    // by the trailing flush — no second notification at +2000ms.
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(1);
    __watcherTestHooks.clearTimers(entry);
  });

  it('clearTimers prevents any late notification', () => {
    const entry = __watcherTestHooks.makeEntry(REPO);
    __watcherTestHooks.debounce(entry, 'worktree');
    __watcherTestHooks.clearTimers(entry);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(0);
  });
});
