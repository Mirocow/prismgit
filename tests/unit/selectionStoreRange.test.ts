import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '../../src/stores/selectionStore';

describe('QW-4 selectionStore range methods', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearBranches();
    useSelectionStore.setState({ selectedBranch: null });
  });

  it('toggleBranch adds one branch to the selection', () => {
    useSelectionStore.getState().toggleBranch('feature/x');
    expect(useSelectionStore.getState().selectedBranches.has('feature/x')).toBe(true);
    expect(useSelectionStore.getState().selectedBranches.size).toBe(1);
  });

  it('toggleBranch removes the branch on second click', () => {
    useSelectionStore.getState().toggleBranch('feature/x');
    useSelectionStore.getState().toggleBranch('feature/x');
    expect(useSelectionStore.getState().selectedBranches.size).toBe(0);
  });

  it('addBranches adds all names without toggling existing ones', () => {
    useSelectionStore.getState().toggleBranch('feature/x');
    useSelectionStore.getState().addBranches(['feature/y', 'feature/z']);
    const selected = useSelectionStore.getState().selectedBranches;
    expect(selected.has('feature/x')).toBe(true);
    expect(selected.has('feature/y')).toBe(true);
    expect(selected.has('feature/z')).toBe(true);
    expect(selected.size).toBe(3);
  });

  it('addBranches is a no-op for an empty array', () => {
    useSelectionStore.getState().toggleBranch('feature/x');
    useSelectionStore.getState().addBranches([]);
    expect(useSelectionStore.getState().selectedBranches.size).toBe(1);
  });

  it('selectBranchRange REPLACES the selection (not add)', () => {
    useSelectionStore.getState().toggleBranch('feature/old');
    useSelectionStore.getState().selectBranchRange(['main', 'develop', 'release']);
    const selected = useSelectionStore.getState().selectedBranches;
    expect(selected.size).toBe(3);
    expect(selected.has('feature/old')).toBe(false);
    expect(selected.has('main')).toBe(true);
    expect(selected.has('develop')).toBe(true);
    expect(selected.has('release')).toBe(true);
  });

  it('selectBranchRange with empty array clears the selection', () => {
    useSelectionStore.getState().toggleBranch('feature/x');
    useSelectionStore.getState().selectBranchRange([]);
    expect(useSelectionStore.getState().selectedBranches.size).toBe(0);
  });

  it('multi-selection sets selectedBranch to null (as branch toggles do)', () => {
    useSelectionStore.getState().selectBranch('feature/x');
    expect(useSelectionStore.getState().selectedBranch).not.toBeNull();
    useSelectionStore.getState().addBranches(['feature/y']);
    expect(useSelectionStore.getState().selectedBranch).toBeNull();
  });

  it('clearBranches empties the set', () => {
    useSelectionStore.getState().selectBranchRange(['a', 'b', 'c']);
    useSelectionStore.getState().clearBranches();
    expect(useSelectionStore.getState().selectedBranches.size).toBe(0);
    expect(useSelectionStore.getState().selectedBranch).toBeNull();
  });
});
