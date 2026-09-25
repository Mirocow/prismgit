/**
 * Polling boost state — kept in a dependency-free module so BOTH sides can
 * import it without cycles:
 *  - hooks/useRemotePolling.ts reads it when computing the next tick's interval;
 *  - stores/gitStore.ts calls bumpPolling() after REAL git mutations
 *    (commit/push/pull/fetch).
 *
 * PERF-2 design: after a git mutation the sidebar's ↓/↑ badges should refresh
 * sooner, so the poller runs at BOOST_INTERVAL_MS for BOOST_DURATION_MS.
 *
 * v3.2 CRITICAL FIX — the boost used to be re-armed by a gitStore.subscribe
 * listener on EVERY `lastRefresh` change, i.e. on EVERY status refresh. That
 * included refreshes triggered by the poll's OWN background `git fetch`
 * (fetch updates .git/refs → watcher event → refreshStatus → bump → 2-min
 * boost at a 30s interval → new poll → new fetch → …) and by ordinary
 * watcher events (every IDE auto-save re-armed the boost). The result was a
 * self-sustaining fetch storm: the poller NEVER returned to its 120s baseline
 * while any background-fetch remote was enabled — the reported
 * "проверка удаленных репозиториев тормозит приложение". Now ONLY real
 * mutations (gitStore actions, auto-push) bump the boost.
 */

/** How long the polling stays in "boost" mode after a git mutation. */
export const BOOST_DURATION_MS = 120_000; // 2 min

let boostUntil = 0;

/** Bump the polling into boost mode for BOOST_DURATION_MS. */
export function bumpPolling(_reason: string): void {
  boostUntil = Math.max(boostUntil, Date.now() + BOOST_DURATION_MS);
}

/** Is a boost window currently active? (tested by the interval scheduler) */
export function isPollingBoosted(): boolean {
  return Date.now() < boostUntil;
}

/** Test hook: the raw boost-until timestamp. */
export function __boostUntilForTests(): number {
  return boostUntil;
}
