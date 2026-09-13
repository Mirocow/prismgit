import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from '@/stores/selectionStore';

// Full behavioral coverage of the global selection store — the single source
// of truth for cross-page state (History <-> Tags <-> Blame <-> Changes ...).
describe('selectionStore', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
    // Reset non-clearAll fields too
    useSelectionStore.setState({
      fileViewMode: 'flat',
      compressFilePaths: true,
      fileExtensionFilter: null,
      fileStatusFilter: 'all',
      fileStatusFilterSet: new Set(),
      fileScope: 'all',
      fileSort: { key: 'name', dir: 1 },
      fileFilterRegex: false,
      dirTreeVisible: true,
      colWidths: { state: 70, dir: 120 },
    });
  });

  it('selectCommit sets and clears the hash', () => {
    useSelectionStore.getState().selectCommit('abc123');
    expect(useSelectionStore.getState().selectedCommitHash).toBe('abc123');
    useSelectionStore.getState().selectCommit(null);
    expect(useSelectionStore.getState().selectedCommitHash).toBeNull();
  });

  it('selectBranch sets branch and clears multi-select', () => {
    useSelectionStore.getState().toggleBranch('feature/a');
    useSelectionStore.getState().toggleBranch('feature/b');
    expect(useSelectionStore.getState().selectedBranches.size).toBe(2);
    useSelectionStore.getState().selectBranch('main');
    expect(useSelectionStore.getState().selectedBranch).toBe('main');
    expect(useSelectionStore.getState().selectedBranches.size).toBe(0);
  });

  it('selectFile / selectTag / selectStash store their values', () => {
    useSelectionStore.getState().selectFile('src/app.ts');
    useSelectionStore.getState().selectTag('v1.2.0');
    useSelectionStore.getState().selectStash(2);
    const s = useSelectionStore.getState();
    expect(s.selectedFilePath).toBe('src/app.ts');
    expect(s.selectedTag).toBe('v1.2.0');
    expect(s.selectedStashIndex).toBe(2);
  });

  it('toggleBranch adds and removes from the multi-select set', () => {
    useSelectionStore.getState().toggleBranch('feature/a');
    expect(useSelectionStore.getState().selectedBranches.has('feature/a')).toBe(true);
    // Selecting a single branch clears the multi-select
    useSelectionStore.getState().selectBranch('main');
    expect(useSelectionStore.getState().selectedBranches.size).toBe(0);
    // Multi-select again — single selection must be cleared
    useSelectionStore.getState().toggleBranch('feature/b');
    expect(useSelectionStore.getState().selectedBranch).toBeNull();
    expect(useSelectionStore.getState().selectedBranches.has('feature/b')).toBe(true);
    // Toggle the same branch again — removes it from the set
    useSelectionStore.getState().toggleBranch('feature/b');
    expect(useSelectionStore.getState().selectedBranches.has('feature/b')).toBe(false);
  });

  it('clearBranches resets both single and multi branch selection', () => {
    useSelectionStore.getState().toggleBranch('feature/a');
    useSelectionStore.getState().clearBranches();
    const s = useSelectionStore.getState();
    expect(s.selectedBranches.size).toBe(0);
    expect(s.selectedBranch).toBeNull();
  });

  it('path and author filters set/clear', () => {
    useSelectionStore.getState().setPathFilter('src/lib');
    useSelectionStore.getState().setAuthorFilter('Alice');
    expect(useSelectionStore.getState().pathFilter).toBe('src/lib');
    expect(useSelectionStore.getState().authorFilter).toBe('Alice');
    useSelectionStore.getState().setPathFilter(null);
    expect(useSelectionStore.getState().pathFilter).toBeNull();
  });

  it('file view mode / compression / extension filter', () => {
    useSelectionStore.getState().setFileViewMode('tree');
    useSelectionStore.getState().setCompressFilePaths(false);
    useSelectionStore.getState().setFileExtensionFilter('.ts');
    const s = useSelectionStore.getState();
    expect(s.fileViewMode).toBe('tree');
    expect(s.compressFilePaths).toBe(false);
    expect(s.fileExtensionFilter).toBe('.ts');
  });

  it('file display flags: toggle adds, removes, and clears to defaults', () => {
    // Default: subdirectories + unversioned
    expect(useSelectionStore.getState().fileDisplayFlags.has('subdirectories')).toBe(true);
    expect(useSelectionStore.getState().fileDisplayFlags.has('unversioned')).toBe(true);
    expect(useSelectionStore.getState().fileDisplayFlags.has('unchanged')).toBe(false);

    // Toggle 'unchanged' ON
    useSelectionStore.getState().toggleFileDisplayFlag('unchanged');
    expect(useSelectionStore.getState().fileDisplayFlags.has('unchanged')).toBe(true);

    // Toggle 'unchanged' OFF
    useSelectionStore.getState().toggleFileDisplayFlag('unchanged');
    expect(useSelectionStore.getState().fileDisplayFlags.has('unchanged')).toBe(false);

    // Toggle 'unversioned' OFF
    useSelectionStore.getState().toggleFileDisplayFlag('unversioned');
    expect(useSelectionStore.getState().fileDisplayFlags.has('unversioned')).toBe(false);

    // Clear resets to defaults
    useSelectionStore.getState().clearFileDisplayFlags();
    expect(useSelectionStore.getState().fileDisplayFlags.has('subdirectories')).toBe(true);
    expect(useSelectionStore.getState().fileDisplayFlags.has('unversioned')).toBe(true);
    expect(useSelectionStore.getState().fileDisplayFlags.size).toBe(2);
  });

  it('file scope, sort, regex flag, dir tree visibility', () => {
    useSelectionStore.getState().setFileScope('top');
    useSelectionStore.getState().setFileScopeDir('src/lib');
    useSelectionStore.getState().setFileSort({ key: 'state', dir: -1 });
    useSelectionStore.getState().toggleFileFilterRegex();
    useSelectionStore.getState().toggleDirTreeVisible();
    const s = useSelectionStore.getState();
    expect(s.fileScope).toBe('top');
    expect(s.fileScopeDir).toBe('src/lib');
    expect(s.fileSort).toEqual({ key: 'state', dir: -1 });
    expect(s.fileFilterRegex).toBe(true);
    expect(s.dirTreeVisible).toBe(false);
  });

  it('setColWidth changes a single column width without touching the other', () => {
    useSelectionStore.getState().setColWidth('state', 100);
    const { colWidths } = useSelectionStore.getState();
    expect(colWidths.state).toBe(100);
    expect(colWidths.dir).toBe(120);
    useSelectionStore.getState().setColWidth('dir', 200);
    expect(useSelectionStore.getState().colWidths.dir).toBe(200);
    expect(useSelectionStore.getState().colWidths.state).toBe(100);
  });

  it('clearAll resets all cross-page selections but keeps view preferences', () => {
    useSelectionStore.getState().selectCommit('deadbeef');
    useSelectionStore.getState().selectBranch('dev');
    useSelectionStore.getState().selectFile('a.ts');
    useSelectionStore.getState().selectTag('v1');
    useSelectionStore.getState().selectStash(0);
    useSelectionStore.getState().toggleBranch('feature/x');
    useSelectionStore.getState().setPathFilter('p');
    useSelectionStore.getState().setAuthorFilter('Bob');
    useSelectionStore.getState().setFileViewMode('tree'); // preference — must survive

    useSelectionStore.getState().clearAll();

    const s = useSelectionStore.getState();
    expect(s.selectedCommitHash).toBeNull();
    expect(s.selectedBranch).toBeNull();
    expect(s.selectedFilePath).toBeNull();
    expect(s.selectedTag).toBeNull();
    expect(s.selectedStashIndex).toBeNull();
    expect(s.selectedBranches.size).toBe(0);
    expect(s.pathFilter).toBeNull();
    expect(s.authorFilter).toBeNull();
    expect(s.fileScopeDir).toBeNull();
    // View preferences survive repo switch
    expect(s.fileViewMode).toBe('tree');
  });
});
