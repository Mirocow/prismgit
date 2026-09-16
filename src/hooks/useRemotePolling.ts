import { useEffect, useRef } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGitStore } from '../stores/gitStore';

/** Default cadence for the repository-list remote check (SmartGit ~5min; we poll faster). */
export const DEFAULT_REMOTE_CHECK_INTERVAL_SEC = 120;
/** Lower bound so a typo in settings can't hammer every remote every second. */
export const MIN_REMOTE_CHECK_INTERVAL_SEC = 30;
/**
 * PERF-2 — how long the polling stays in "boost" mode after a git
 * mutation (commit/push/fetch/stage). During boost the interval is
 * BOOST_INTERVAL_MS instead of the baseline.
 */
export const BOOST_DURATION_MS = 120_000; // 2 min
export const BOOST_INTERVAL_MS = 30_000;   // 30s during boost (was 15s — too aggressive on LFS repos)
/**
 * PERF-2 — pause-polling timestamp. While pauseUntil > Date.now(), the
 * scheduler skips ticks. Set when the window blurs (no point fetching
 * if the user isn't looking), cleared on focus + immediate checkNow.
 */
let pauseUntil = 0;
export function pauseRemotePolling(untilMs = Date.now() + 5 * 60_000): void {
  pauseUntil = Math.max(pauseUntil, untilMs);
}
export function resumeRemotePolling(): void {
  pauseUntil = 0;
}

/**
 * PERF-2 — bump the polling into boost mode for BOOST_DURATION_MS.
 * Called by gitStore actions after commit/push/fetch/stage/etc so the
 * sidebar counter refreshes faster in the moments the user is most
 * likely to be watching it.
 */
let boostUntil = 0;
export function bumpPolling(_reason: string): void {
  boostUntil = Math.max(boostUntil, Date.now() + BOOST_DURATION_MS);
}

/**
 * Periodically checks every repository in the sidebar list against its
 * remotes: `git fetch --all`, then computes incoming/outgoing/dirty counters
 * (see pollRemoteSummary in the main process). The sidebar shows ↓N / ↑N
 * badges from these results.
 *
 * - Master gate: runs only when Settings → "Auto refresh" is enabled
 *   (default true). With autoRefresh disabled there is NO initial check and
 *   NO timer; the sidebar "Check now" button still works.
 * - Runs once as soon as the repo list is loaded, then on a self-rescheduling
 *   timer so a changed interval (Settings → Git) takes effect on the next tick
 *   without re-subscribing.
 * - Interval 0 (or negative) disables the periodic check; "Check now" in the
 *   sidebar still works.
 * - PERF-2: adaptive cadence. After a git mutation (commit/push/fetch/stage)
 *   the gitStore calls bumpPolling() which sets a 2-min boost window where
 *   the timer fires every 15s instead of the baseline 120s. Also pauses
 *   while the window is blurred (so background fetches don't drain battery).
 * - Silent by design: network failures land in each summary's `error` field,
 *   never as toasts.
 */
export function useRemotePolling(): void {
  // Master gate (Settings → Auto refresh). Defaults to enabled.
  const autoRefresh = useSettingsStore((s) => s.settings.autoRefresh ?? true);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  // Track the repo list as a single string so the effect only reacts to real
  // membership changes, not to new array identities on every store update.
  const repoListKey = useRepositoryStore((s) => s.repos.map((r) => r.path).join('\n'));
  const repoListKeyRef = useRef(repoListKey);
  repoListKeyRef.current = repoListKey;

  // PERF-2 — subscribe to gitStore's lastRefresh so that whenever a git
  // mutation completes (commit/push/fetch/etc. all call refreshStatus),
  // we bump the polling into boost mode. This re-renders the hook with
  // the new lastRefresh, but the effect below is keyed on the same
  // deps so it doesn't re-subscribe.
  const lastRefresh = useGitStore((s) => s.lastRefresh);
  useEffect(() => {
    if (lastRefresh > 0) bumpPolling('git-mutation');
  }, [lastRefresh]);

  // StrictMode double-invocation guard: in dev React runs mount → cleanup →
  // mount on the same component, which fired the initial checkNow() TWICE
  // (duplicate `git fetch --all` per repo at every app start — user-reported).
  // The ref persists across the double-invocation; the key (autoRefresh state
  // + repo list) means a REAL re-subscription (list grew, auto refresh toggled)
  // still performs its fresh initial check.
  const lastInitialGateRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const getBaselineMs = (): number | null => {
      const sec = useSettingsStore.getState().settings.repoRemoteCheckIntervalSec
        ?? DEFAULT_REMOTE_CHECK_INTERVAL_SEC;
      if (!Number.isFinite(sec) || sec <= 0) return null; // disabled by user
      return Math.max(MIN_REMOTE_CHECK_INTERVAL_SEC, sec) * 1000;
    };

    /**
     * PERF-2 — adaptive interval:
     *  - If boost window is active (recent git mutation) → BOOST_INTERVAL_MS.
     *  - Otherwise → the user's baseline interval (default 120s).
     *  - Always respect MIN_REMOTE_CHECK_INTERVAL_SEC as a floor (so a typo
     *    in settings still can't hammer every remote every second).
     */
    const getIntervalMs = (): number | null => {
      const baseline = getBaselineMs();
      if (baseline === null) return null;
      if (Date.now() < boostUntil) return Math.max(MIN_REMOTE_CHECK_INTERVAL_SEC * 1000, BOOST_INTERVAL_MS);
      return baseline;
    };

    const checkNow = () => {
      const paths = repoListKeyRef.current.split('\n').filter(Boolean);
      if (paths.length > 0) {
        void useRepositoryStore.getState().checkRemotes(paths).catch(() => {});
      }
    };

    const schedule = () => {
      if (disposed) return;
      if (!autoRefreshRef.current) return; // Auto refresh off — no polling
      const ms = getIntervalMs();
      if (ms === null) return; // periodic check disabled
      timer = setTimeout(async () => {
        timer = null;
        if (disposed) return;
        // PERF-2 — pause when window is blurred (no fetches while user
        // isn't looking). The window-focus listener below will resume
        // AND trigger an immediate checkNow on focus.
        if (Date.now() < pauseUntil) {
          schedule();
          return;
        }
        if (autoRefreshRef.current) checkNow();
        schedule();
      }, ms);
    };

    // PERF-2 — pause polling while the window is blurred; on focus,
    // immediately check (so the sidebar shows fresh counters as soon as
    // the user comes back) and resume normal scheduling.
    const onWindowBlur = () => { pauseRemotePolling(); };
    const onWindowFocus = () => {
      resumeRemotePolling();
      if (autoRefreshRef.current) checkNow();
    };
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('focus', onWindowFocus);

    // Initial check as soon as there is something to check — only with
    // Auto refresh enabled, and only once per (autoRefresh, repoList) state —
    // the StrictMode remount replays the same state and must not re-check.
    // Re-run when the list grows so a freshly added repo is checked without
    // waiting a tick.
    const gateKey = `${autoRefreshRef.current ? 'on' : 'off'}|${repoListKeyRef.current}`;
    if (autoRefreshRef.current && lastInitialGateRef.current !== gateKey) {
      lastInitialGateRef.current = gateKey;
      checkNow();
    }
    schedule();

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [repoListKey, autoRefresh]);
}
