/**
 * ONB-1 — First-run tour steps + persistence helpers.
 *
 * Each step targets a CSS selector that we tag with `data-tour="..."` in
 * the corresponding component. The TourOverlay positions a spotlight
 * rectangle over the matched element and renders the step content
 * (title + description) in a popover.
 *
 * Steps are intentionally short — 5 steps × ~10 sec reading = ~1 min tour.
 *
 * ── Persistence strategy ─────────────────────────────────────────────
 * The "tour completed" flag is persisted in BOTH places:
 *   1. localStorage (`prismgit-tour-completed` = '1') — fast synchronous
 *      read on app launch, used as a fallback for instant startup check.
 *   2. AppSettings store (`tourCompleted` = true) — survives localStorage
 *      wipes (Tauri webview partition resets, "Clear site data", cache
 *      cleaning). This is the source of truth.
 *
 * `isTourCompletedSync()` checks localStorage only — fast, no IPC. Used
 * for the very first paint on app launch to avoid the tour flashing
 * briefly before settings load.
 *
 * `isTourCompleted()` (async) checks the settings store, with localStorage
 * as a one-time migration fallback. If the localStorage value is '1' but
 * the settings store has no `tourCompleted` flag yet, we write it back
 * (legacy migration) and return true.
 *
 * `markTourCompleted()` writes to BOTH localStorage (sync, immediate) and
 * the settings store (async, fire-and-forget). This way the next launch
 * sees the flag regardless of which storage survives.
 */

import { api } from './api';

export interface TourStep {
  /** CSS selector for the element to spotlight. */
  selector: string;
  /** i18n key for the title (resolved via t()). */
  titleKey: string;
  /** i18n key for the description body. */
  descKey: string;
  /**
   * Preferred placement of the popover relative to the spotlight.
   * 'auto' picks the side with more viewport space.
   */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

export const TOUR_STEPS: TourStep[] = [
  {
    selector: '[data-tour="sidebar-changes"]',
    titleKey: 'tour.changes.title',
    descKey: 'tour.changes.desc',
    placement: 'right',
  },
  {
    selector: '[data-tour="sidebar-history"]',
    titleKey: 'tour.history.title',
    descKey: 'tour.history.desc',
    placement: 'right',
  },
  {
    selector: '[data-tour="sidebar-branches"]',
    titleKey: 'tour.branches.title',
    descKey: 'tour.branches.desc',
    placement: 'right',
  },
  {
    selector: '[data-tour="toolbar-command-palette"]',
    titleKey: 'tour.commandPalette.title',
    descKey: 'tour.commandPalette.desc',
    placement: 'bottom',
  },
  {
    selector: '[data-tour="toolbar-global-search"]',
    titleKey: 'tour.globalSearch.title',
    descKey: 'tour.globalSearch.desc',
    placement: 'bottom',
  },
];

/** localStorage key — set once the user has seen (or skipped) the tour. */
export const TOUR_COMPLETED_KEY = 'prismgit-tour-completed';

/**
 * Synchronous check — reads localStorage ONLY. Use this for the very first
 * paint decision (before settings store has loaded) so the tour doesn't
 * flash on screen. Returns false on any error (SSR, disabled storage).
 */
export function isTourCompletedSync(): boolean {
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Async check — reads `tourCompleted` from the settings store (source of
 * truth). Falls back to localStorage as a one-time migration: if the
 * localStorage flag is set but the settings store flag isn't, we write
 * the settings store flag and return true.
 *
 * Use this for the authoritative decision before auto-showing the tour.
 */
export async function isTourCompleted(): Promise<boolean> {
  // 1. Fast path — localStorage is set → already completed at some point.
  //    This also covers the case where the settings store isn't loaded yet
  //    (e.g., test env without a working IPC layer).
  const localDone = isTourCompletedSync();

  // 2. Ask the settings store — survives localStorage wipes.
  try {
    const stored = await api.settings.get<boolean>('tourCompleted');
    if (stored === true) return true;
    // 3. Migration: localStorage says done, but settings store doesn't.
    //    Write it back so the next launch doesn't depend on localStorage.
    if (localDone) {
      try { await api.settings.set('tourCompleted', true); } catch { /* ignore */ }
      return true;
    }
    return false;
  } catch {
    // Settings store unavailable — fall back to localStorage result.
    return localDone;
  }
}

/**
 * Mark the tour as completed. Writes to BOTH localStorage (sync,
 * immediate — so the very next launch's `isTourCompletedSync()` returns
 * true even before the settings store loads) and the settings store
 * (async, fire-and-forget — survives localStorage wipes).
 *
 * Safe to call multiple times — both writes are idempotent.
 */
export function markTourCompleted(): void {
  // 1. localStorage — synchronous, survives until the next origin wipe.
  try {
    localStorage.setItem(TOUR_COMPLETED_KEY, '1');
  } catch { /* localStorage unavailable */ }

  // 2. Settings store — async, survives localStorage wipes. Fire-and-forget;
  //    we don't need to await this for the UI to dismiss. The next launch
  //    will see the persisted value via `isTourCompleted()`.
  try {
    void api.settings.set('tourCompleted', true);
  } catch { /* settings store unavailable — localStorage still has us covered */ }
}

/**
 * Reset the tour (re-show on next launch). Used by Help → Restart Tour.
 * Clears BOTH localStorage and the settings store.
 */
export async function resetTour(): Promise<void> {
  try {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
  } catch { /* localStorage unavailable */ }
  try {
    await api.settings.set('tourCompleted', false);
  } catch { /* settings store unavailable */ }
}
