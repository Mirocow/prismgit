/**
 * ONB-1 — First-run tour steps.
 *
 * Each step targets a CSS selector that we tag with `data-tour="..."` in
 * the corresponding component. The TourOverlay positions a spotlight
 * rectangle over the matched element and renders the step content
 * (title + description) in a popover.
 *
 * Steps are intentionally short — 5 steps × ~10 sec reading = ~1 min tour.
 */

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

export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourCompleted(): void {
  try {
    localStorage.setItem(TOUR_COMPLETED_KEY, '1');
  } catch { /* localStorage unavailable */ }
}

export function resetTour(): void {
  try {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
  } catch { /* localStorage unavailable */ }
}
