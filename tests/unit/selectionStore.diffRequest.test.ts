import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '@/stores/selectionStore';

/**
 * Tests for the `diffRequest` field — a one-shot diff configuration that
 * tools (like Stashes) can set to ask the Diff page to switch to a specific
 * base/compare/file configuration.
 *
 * The original bug: Stashes page used `selectCommit(stash.hash)` which DiffPage
 * interpreted as `baseRef = stash.hash`, then computed diff(baseRef, working tree).
 * This showed the wrong diff — working-tree changes instead of stash content.
 *
 * Fix: Stashes page now uses `setDiffRequest({ baseRef: stash^, compareRef: stash,
 * filePath: '.' })`, and DiffPage consumes it on first render.
 */
describe('selectionStore.diffRequest', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
  });

  it('is null by default', () => {
    expect(useSelectionStore.getState().diffRequest).toBeNull();
  });

  it('setDiffRequest stores base/compare/filePath', () => {
    useSelectionStore.getState().setDiffRequest({
      baseRef: 'abc123^',
      compareRef: 'abc123',
      filePath: '.',
    });
    const req = useSelectionStore.getState().diffRequest;
    expect(req).not.toBeNull();
    expect(req!.baseRef).toBe('abc123^');
    expect(req!.compareRef).toBe('abc123');
    expect(req!.filePath).toBe('.');
  });

  it('setDiffRequest(null) clears the request', () => {
    useSelectionStore.getState().setDiffRequest({
      baseRef: 'x^', compareRef: 'x', filePath: '.',
    });
    expect(useSelectionStore.getState().diffRequest).not.toBeNull();
    useSelectionStore.getState().setDiffRequest(null);
    expect(useSelectionStore.getState().diffRequest).toBeNull();
  });

  it('supports requests without filePath', () => {
    useSelectionStore.getState().setDiffRequest({
      baseRef: 'main', compareRef: 'feature/x',
    });
    const req = useSelectionStore.getState().diffRequest;
    expect(req).not.toBeNull();
    expect(req!.baseRef).toBe('main');
    expect(req!.compareRef).toBe('feature/x');
    expect(req!.filePath).toBeUndefined();
  });

  it('clearAll() also clears diffRequest', () => {
    useSelectionStore.getState().setDiffRequest({
      baseRef: 'x^', compareRef: 'x', filePath: '.',
    });
    useSelectionStore.getState().clearAll();
    expect(useSelectionStore.getState().diffRequest).toBeNull();
  });

  it('Stashes-style call sets up stash^ vs stash comparison', () => {
    // Simulate exactly what StashesPage.handleViewStash does
    const stashHash = 'deadbeefcafebabe1234567890abcdef12345678';
    useSelectionStore.getState().setDiffRequest({
      baseRef: `${stashHash}^`,
      compareRef: stashHash,
      filePath: '.',
    });
    const req = useSelectionStore.getState().diffRequest;
    expect(req).not.toBeNull();
    // Critical assertions: baseRef must be stash^ (parent), not stash itself,
    // and not HEAD — the original bug was using stash.hash as baseRef.
    expect(req!.baseRef).toBe(`${stashHash}^`);
    expect(req!.baseRef).not.toBe(stashHash);
    expect(req!.baseRef).not.toBe('HEAD');
    expect(req!.compareRef).toBe(stashHash);
    expect(req!.filePath).toBe('.');
  });
});
