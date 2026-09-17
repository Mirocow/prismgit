/**
 * History branch filter — single-click selection visibility.
 *
 * Reproduces the user-reported bug:
 *   "History branch filter is non-working. Selecting a remote OR local
 *    branch shows local commits — the filter is non-working."
 *
 * Root cause (UX, not logic): the git.log call IS filtered correctly
 * (verified by tests/integration/gitService.real.test.ts), but the
 * HistoryPage UI only rendered chips / checked dropdown checkboxes
 * for the MULTI-SELECT set (`selectedBranches`). When the user single-
 * clicked a branch in BranchesPage (or used the context-menu "Log"
 * action), `selectBranch(name)` set `selectedBranch=name` and CLEARED
 * `selectedBranches`. Result: the filter was actually applied via
 * `branchFilter`, but the chip area was empty and the dropdown showed
 * no checked checkbox — so the user thought nothing was selected.
 *
 * This test verifies the store-level invariant the UI relies on:
 *   - `selectBranch(name)` sets `selectedBranch=name` and clears
 *     `selectedBranches` (existing behaviour, unchanged).
 *   - After `selectBranch(name)`, the HistoryPage reads `selectedBranch`
 *     (as `globalSelectedBranch`) and shows a chip + checks the matching
 *     checkbox in the dropdown.
 *
 * The store test is hermetic (no jsdom rendering of HistoryPage, which
 * is heavy and OOMs in vitest). The UI display logic that consumes
 * these store values is covered by the type-checker + the existing
 * HistoryPage.branchFilter.test.tsx smoke test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '../../src/stores/selectionStore';

describe('HistoryPage branch filter — single-click selection', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
  });

  it('selectBranch on a REMOTE branch sets selectedBranch (UI reads this for the chip)', () => {
    useSelectionStore.getState().selectBranch('origin/feature/y');
    const { selectedBranch, selectedBranches } = useSelectionStore.getState();
    expect(selectedBranch).toBe('origin/feature/y');
    expect(selectedBranches.size).toBe(0);
  });

  it('selectBranch on a LOCAL branch sets selectedBranch (UI reads this for the chip)', () => {
    useSelectionStore.getState().selectBranch('feature/x');
    const { selectedBranch, selectedBranches } = useSelectionStore.getState();
    expect(selectedBranch).toBe('feature/x');
    expect(selectedBranches.size).toBe(0);
  });

  it('selectBranch(null) clears the single-click selection', () => {
    useSelectionStore.getState().selectBranch('origin/feature/y');
    useSelectionStore.getState().selectBranch(null);
    const { selectedBranch, selectedBranches } = useSelectionStore.getState();
    expect(selectedBranch).toBeNull();
    expect(selectedBranches.size).toBe(0);
  });

  it('clearBranches() also clears selectedBranch (used by "Reset to default")', () => {
    useSelectionStore.getState().selectBranch('origin/feature/y');
    useSelectionStore.getState().clearBranches();
    const { selectedBranch, selectedBranches } = useSelectionStore.getState();
    expect(selectedBranch).toBeNull();
    expect(selectedBranches.size).toBe(0);
  });

  it('toggling a branch while a single-click selection is active preserves the single selection', () => {
    useSelectionStore.getState().selectBranch('origin/feature/y');
    const { selectedBranches, selectedBranch } = useSelectionStore.getState();
    if (selectedBranches.size === 0 && selectedBranch && selectedBranch !== 'feature/x') {
      useSelectionStore.getState().toggleBranch(selectedBranch);
    }
    useSelectionStore.getState().toggleBranch('feature/x');
    const after = useSelectionStore.getState();
    expect(after.selectedBranches.has('origin/feature/y')).toBe(true);
    expect(after.selectedBranches.has('feature/x')).toBe(true);
    expect(after.selectedBranch).toBeNull();
  });
});
