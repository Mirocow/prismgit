import { useEffect, useRef } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';

/** Default cadence for the repository-list remote check (SmartGit ~5min; we poll faster). */
export const DEFAULT_REMOTE_CHECK_INTERVAL_SEC = 120;
/** Lower bound so a typo in settings can't hammer every remote every second. */
export const MIN_REMOTE_CHECK_INTERVAL_SEC = 30;

/**
 * Periodically checks every repository in the sidebar list against its
 * remotes: `git fetch --all`, then computes incoming/outgoing/dirty counters
 * (see pollRemoteSummary in the main process). The sidebar shows ↓N / ↑N
 * badges from these results.
 *
 * - Master gate: runs only when Settings → "Auto refresh" is enabled
 *   (default true). With autoRefresh disabled there is NO initial check and
   * NO timer; the sidebar "Check now" button still works.
 * - Runs once as soon as the repo list is loaded, then on a self-rescheduling
 *   timer so a changed interval (Settings → Git) takes effect on the next tick
 *   without re-subscribing.
 * - Interval 0 (or negative) disables the periodic check; "Check now" in the
 *   sidebar still works.
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

    const getIntervalMs = (): number | null => {
      const sec = useSettingsStore.getState().settings.repoRemoteCheckIntervalSec
        ?? DEFAULT_REMOTE_CHECK_INTERVAL_SEC;
      if (!Number.isFinite(sec) || sec <= 0) return null; // disabled by user
      return Math.max(MIN_REMOTE_CHECK_INTERVAL_SEC, sec) * 1000;
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
        if (autoRefreshRef.current) checkNow();
        schedule();
      }, ms);
    };

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
    };
  }, [repoListKey, autoRefresh]);
}
