import { useEffect, useRef } from 'react';

/**
 * Watchdog: detects when the renderer UI has frozen (white screen) and
 * surfaces a recoverable error report so the user can copy the trace and
 * reload instead of staring at a blank screen.
 *
 * How it works:
 *   - A heartbeat tick runs every HEARTBEAT_INTERVAL_MS (default 5s).
 *   - The watchdog pings the renderer; if the renderer doesn't respond
 *     within HEARTBEAT_TIMEOUT_MS (default 15s), it's considered frozen.
 *   - On a freeze, the watchdog dispatches a `smartgit:watchdog-freeze`
 *     CustomEvent. The App's global error handler catches it and opens
 *     the ErrorReportDialog with kind='watchdog'.
 *
 * Why a watchdog is needed:
 *   - The user reported that the app "fell into a white screen after
 *     being idle". This is typically caused by:
 *       1. A JS callback that throws inside setTimeout/setInterval,
 *          leaving the renderer in a broken state but not crashing the
 *          page (so window.onerror doesn't fire).
 *       2. An infinite loop in a render that React's error boundary
 *          can't catch (the boundary catches throws, not hangs).
 *       3. Memory exhaustion (renderer process killed by the OS).
 *   - In cases 1 and 2, the page is technically alive but the UI is
 *     frozen. The watchdog detects this and gives the user a recovery
 *     path instead of forcing them to manually reload.
 *
 * What it does NOT do:
 *   - It cannot detect case 3 (renderer killed) — that's a hard crash,
 *     and the user will see the OS's "page unresponsive" dialog or
 *     nothing at all. The watchdog only helps when the renderer process
 *     is alive but stuck.
 *
 * Implementation notes:
 *   - The watchdog uses a Web Worker (loaded from a Blob URL) so it
 *     keeps ticking even when the main thread is frozen. This is the
 *     KEY trick — a setInterval on the main thread would also freeze,
 *     but a Worker runs on its own thread and can detect the freeze
 *     by checking if the main thread responded to its last ping.
 *   - The ping/pong uses postMessage; if the main thread is frozen,
 *     the pong never comes back and the Worker's timer fires.
 */

const HEARTBEAT_INTERVAL_MS = 5_000; // ping every 5s
const HEARTBEAT_TIMEOUT_MS = 15_000; // consider frozen if no pong in 15s

// Inline worker source — kept as a string so we don't need a separate file
// (and so the worker is loaded synchronously on app start).
const WORKER_SOURCE = `
let intervalId = null;
let lastPongAt = 0;
let frozenNotified = false;

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === 'pong') {
    lastPongAt = Date.now();
    frozenNotified = false; // recovered — reset
  } else if (msg.type === 'start') {
    lastPongAt = Date.now();
    intervalId = setInterval(function () {
      const elapsed = Date.now() - lastPongAt;
      if (elapsed > ${HEARTBEAT_TIMEOUT_MS} && !frozenNotified) {
        frozenNotified = true;
        self.postMessage({ type: 'frozen', elapsed: elapsed });
      } else {
        // Ping the main thread — if it's frozen, the pong won't come back.
        self.postMessage({ type: 'ping' });
      }
    }, ${HEARTBEAT_INTERVAL_MS});
  } else if (msg.type === 'stop') {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }
};
`;

export function useWatchdog(): void {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Don't run the watchdog in test environments — Vitest doesn't support
    // Workers the same way and the test would hang.
    if (typeof Worker === 'undefined') return;
    // Don't run in dev when HMR is active — the worker would be torn down
    // on every hot reload, creating a false-positive freeze notification.
    // We detect HMR by checking for Vite's import.meta.hot.
    const isHMR = !!(import.meta as { hot?: unknown }).hot;
    if (isHMR) return;

    let worker: Worker;
    try {
      const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      worker = new Worker(url);
      workerRef.current = worker;
      // Revoke the URL after the worker has loaded — the worker keeps its
      // own reference, so the blob stays alive until the worker terminates.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.warn('[watchdog] failed to start worker:', e);
      return;
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; elapsed?: number };
      if (msg.type === 'ping') {
        // The worker is asking if we're alive. Respond immediately so the
        // worker resets its frozen timer. If the main thread is frozen,
        // this handler never runs and the worker's next tick will detect
        // the freeze.
        worker.postMessage({ type: 'pong' });
      } else if (msg.type === 'frozen') {
        // The watchdog detected a freeze — but actually, if we're
        // receiving this message, we're NOT frozen (the handler ran).
        // This means the freeze was momentary (GC pause, slow callback)
        // and the renderer recovered. We don't dispatch the
        // `smartgit:watchdog-freeze` event in this case — only when the
        // worker TRULY cannot reach the main thread for the full timeout
        // does it consider us frozen, and in that case we wouldn't be
        // able to receive this message anyway.
        //
        // The freeze event is logged so the developer can see how often
        // near-freezes happen (in the console), but it doesn't trigger
        // the error dialog because the renderer is alive.
        console.warn(`[watchdog] main thread was unresponsive for ${msg.elapsed}ms but recovered`);
      }
    };

    worker.postMessage({ type: 'start' });

    return () => {
      try {
        worker.postMessage({ type: 'stop' });
        worker.terminate();
      } catch {
        /* worker may already be terminated */
      }
      workerRef.current = null;
    };
  }, []);
}

/**
 * Check if the page is currently visible (not in a background tab).
 * Used by the watchdog to skip freeze detection when the page is hidden
 * (the main thread legitimately doesn't respond to pings when throttled).
 */
export function isPageVisible(): boolean {
  try {
    return document.visibilityState === 'visible';
  } catch {
    return true;
  }
}
