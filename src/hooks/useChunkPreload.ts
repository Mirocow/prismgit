import { useEffect } from 'react';

/**
 * Idle-time chunk preloading.
 * ============================
 *
 * The app code-splits every tool page and the heavy dialogs. That keeps the
 * initial bundle small (fast cold start), but the FIRST open of each tool /
 * dialog used to pay a chunk fetch + parse penalty — perceived as "windows
 * open slowly" the first time.
 *
 * This hook warms those chunks during browser idle time, ONE module per idle
 * slice, starting right after the first render. By the time the user clicks
 * anything, every chunk is already parsed and dialog/page open is instant.
 *
 * Design notes:
 *   - One import() per idle callback: parsing a big page chunk can take
 *     10–30 ms on slow hardware; doing them all at once would jank the UI.
 *   - `timeout` bounds how long the browser may stay busy before we force
 *     the next preload anyway.
 *   - Failures are ignored (a chunk that fails to preload will simply be
 *     fetched again on real navigation).
 *   - The lists are module-level so Vite dedupes these dynamic imports with
 *     the lazy() calls in App.tsx (same chunks, no duplication).
 *   - The queue logic is factored into `runPreloadQueue` (pure, unit-tested);
 *     the hook is a thin useEffect wrapper around it.
 */

/** Pages (mirrors the lazy() list in App.tsx). */
const PAGE_CHUNKS = [
  () => import('../pages/ChangesPage'),
  () => import('../pages/HistoryPage'),
  () => import('../pages/DiffPage'),
  () => import('../pages/AnnotatePage'),
  () => import('../pages/BlamePage'),
  () => import('../pages/InvestigatePage'),
  () => import('../pages/JournalPage'),
  () => import('../pages/GitFlowPage'),
  () => import('../pages/PullRequestsPage'),
  () => import('../pages/ReviewsPage'),
  () => import('../pages/LfsPage'),
  () => import('../pages/BranchesPage'),
  () => import('../pages/StashesPage'),
  () => import('../pages/TagsPage'),
  () => import('../pages/SubmodulesPage'),
  () => import('../pages/SubtreesPage'),
  () => import('../pages/WorktreesPage'),
  () => import('../pages/ReflogPage'),
  () => import('../pages/RecyclablePage'),
  () => import('../pages/RemotesPage'),
  () => import('../pages/BisectPage'),
  () => import('../pages/NotesPage'),
  () => import('../pages/SettingsPage'),
] as Array<() => Promise<unknown>>;

/**
 * Heavy dialogs that are lazy-loaded in App.tsx (not needed for first paint).
 * Preloading them on idle keeps their first open as fast as before the split.
 */
const DIALOG_CHUNKS = [
  () => import('../components/CloneModal'),
  () => import('../components/InitModal'),
  () => import('../components/GitFlowDialog'),
  () => import('../components/InteractiveRebaseDialog'),
  () => import('../components/RepoInfoDialog'),
  () => import('../components/ApplyPatchModal'),
  () => import('../components/IndexEditorDialog'),
  () => import('../components/RepoSettingsDialog'),
  () => import('../components/ConflictSolver'),
] as Array<() => Promise<unknown>>;

export const CHUNK_PRELOADERS: Array<() => Promise<unknown>> = [...PAGE_CHUNKS, ...DIALOG_CHUNKS];

type IdleScheduler = (cb: () => void, timeout: number) => void;

/** requestIdleCallback when available, setTimeout fallback elsewhere. */
export const idleScheduler: IdleScheduler = (cb, timeout) => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    ric(cb, { timeout });
  } else {
    setTimeout(cb, 50);
  }
};

/**
 * Preload `preloaders` one per idle slice. Returns a cancel function.
 * Pure and injectable with a custom scheduler — unit-testable without DOM.
 */
export function runPreloadQueue(
  preloaders: Array<() => Promise<unknown>>,
  scheduleIdle: IdleScheduler = idleScheduler
): () => void {
  // Nothing to warm — don't even schedule an idle callback.
  if (preloaders.length === 0) {
    return () => {};
  }

  let cancelled = false;
  let index = 0;

  const step = (): void => {
    if (cancelled || index >= preloaders.length) return;
    // Fire ONE chunk import per idle slice, then yield back to the browser.
    void preloaders[index++]().catch(() => {
      /* preloading is best-effort — real navigation retries */
    });
    if (index < preloaders.length) {
      scheduleIdle(step, 2000);
    }
  };

  // Start on the first idle slice — i.e. right after first paint, so we
  // never compete with the app's own startup work.
  scheduleIdle(step, 1500);

  return () => {
    cancelled = true;
  };
}

/**
 * Warm all lazy chunks during idle time. `enabled` lets callers skip the
 * preload in tests or constrained environments.
 */
export function useChunkPreload(enabled = true): void {
  useEffect(() => {
    if (!enabled || CHUNK_PRELOADERS.length === 0) return;
    return runPreloadQueue(CHUNK_PRELOADERS);
  }, [enabled]);
}
