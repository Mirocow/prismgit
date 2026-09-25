/**
 * childTracker — the worker-side child-process tracker that lets the
 * background git worker kill its git children on 'shutdown' (an orphaned
 * `git fetch` used to keep running after the app quit).
 *
 * Pinned here: install wraps child_process.spawn transparently (overloads
 * preserved), live children are tracked until they exit, killAllChildren
 * kills every live child exactly once, and errors from dying children are
 * swallowed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  installChildTracker,
  killAllChildren,
  setChildrenListener,
  __trackedChildrenForTests,
  __resetChildTrackerForTests,
} from '../../electron/services/childTracker';

// IMPORTANT: the tracker patches the CJS child_process module object (the
// same object simple-git and the compiled spawn helpers resolve through in
// production). In the vitest ESM realm, `import * as cp from 'node:child_process'
// gets a FROZEN namespace that may not reflect the property patch — so the
// test drives spawn through the SAME require-based object the tracker patches
// (this is the documented vitest gotcha for spawn interceptors).
const require_ = createRequire(import.meta.url);
const cp = require_('child_process') as typeof import('node:child_process');

afterEach(() => {
  __resetChildTrackerForTests();
});

describe('installChildTracker', () => {
  it('is idempotent — a second install does not double-wrap', () => {
    installChildTracker();
    const spawn1 = cp.spawn;
    installChildTracker();
    expect(cp.spawn).toBe(spawn1);
  });

  it('transparently forwards the (cmd, args, opts) overload and tracks the child', async () => {
    installChildTracker();
    // sleep 30s — we kill it ourselves below; if the kill fails the child
    // would linger for the test run, so also rely on afterAll cleanup.
    const child = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    expect(child.pid).toBeTruthy();
    expect(__trackedChildrenForTests()).toBe(1);
    // The ORIGINAL overload shape still works (spawn(cmd, opts)).
    const child2 = cp.spawn(process.execPath, { stdio: 'ignore' });
    expect(child2.pid).toBeTruthy();
    expect(__trackedChildrenForTests()).toBe(2);
    const killed = killAllChildren();
    expect(killed).toBe(2);
    // Bookkeeping clears after the kill sweep.
    expect(__trackedChildrenForTests()).toBe(0);
  });

  it('kills a child that already exited is a no-op (exit removes it from the set)', async () => {
    installChildTracker();
    const child = cp.spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
    // The 'close' bookkeeping already dropped it.
    expect(__trackedChildrenForTests()).toBe(0);
    expect(killAllChildren()).toBe(0);
  });
});

describe('setChildrenListener (worker → main pid reports)', () => {
  it('reports the live pid set after a spawn and after an exit (coalesced per loop turn)', async () => {
    installChildTracker();
    const reports: number[][] = [];
    setChildrenListener((pids) => reports.push(pids));

    const child = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    expect(child.pid).toBeTruthy();
    // setImmediate coalescing: the report lands on the NEXT loop turn.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.waitFor(() => expect(reports.length).toBeGreaterThan(0));
    expect(reports[reports.length - 1]).toEqual([child.pid]);

    // Child exits → the set update is reported too (empty set).
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
    await vi.waitFor(() => expect(reports[reports.length - 1]).toEqual([]));
    killAllChildren();
  });

  it('coalesces a burst of spawns into few reports, not one per spawn', async () => {
    installChildTracker();
    const reports: number[][] = [];
    setChildrenListener((pids) => reports.push(pids));

    const children = Array.from({ length: 8 }, () =>
      cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' }));
    // All 8 spawns happen within one macrotask chain — setImmediate should
    // coalesce them into 1-2 reports (≤ 3 is a generous bound).
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.waitFor(() => expect(reports.length).toBeGreaterThan(0));
    expect(reports.length).toBeLessThanOrEqual(3);
    expect(reports[reports.length - 1]).toEqual(
      expect.arrayContaining(children.map((c) => c.pid)),
    );
    killAllChildren();
  });

  it('null clears the listener — spawning stays silent', async () => {
    installChildTracker();
    let calls = 0;
    setChildrenListener(() => { calls++; });
    setChildrenListener(null);
    const child = cp.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(0);
    killAllChildren();
    expect(child.pid).toBeTruthy();
  });
});
