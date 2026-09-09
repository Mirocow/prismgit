import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { DiffPage } from '../../src/pages/DiffPage';
import { useSelectionStore } from '../../src/stores/selectionStore';

// Mock the git API so we control what changedFiles / diff look like.
// DiffPage calls api.git.raw, api.git.branches, api.git.log, api.git.diff.
// We want to simulate the "multi-file" case (changedFiles.length > 0) so the
// file-list panel renders and we can verify the splitter is present.
const mockRaw = vi.fn();
const mockBranches = vi.fn();
const mockLog = vi.fn();
const mockDiff = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      raw: (...args: unknown[]) => mockRaw(...args),
      branches: (...args: unknown[]) => mockBranches(...args),
      log: (...args: unknown[]) => mockLog(...args),
      diff: (...args: unknown[]) => mockDiff(...args),
    },
  },
}));

// Mock the toast store so it doesn't crash (no toast container needed for tests)
vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock repository store — DiffPage needs a current repo
vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: () => ({
    currentRepo: { path: '/test/repo', name: 'test-repo' },
  }),
}));

function renderDiffPage() {
  return render(
    <HashRouter>
      <DiffPage />
    </HashRouter>
  );
}

describe('DiffPage — splitter between file list and diff viewer', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
    mockBranches.mockResolvedValue([]);
    mockLog.mockResolvedValue([]);
    mockDiff.mockResolvedValue({
      oldContent: '', newContent: '',
      oldPath: 'test.ts', newPath: 'test.ts',
      hunks: [], binary: false,
      newFile: false, deletedFile: false, renamedFile: false,
    });
  });

  it('renders a ResizableSplitter between file list and diff viewer when files exist', async () => {
    // Simulate multi-file diff: api.git.raw returns a name-status list
    // First call (file list): returns "M\tfile1.ts\nA\tfile2.ts\n"
    // Subsequent calls (per-file diff): return empty diff text
    mockRaw.mockImplementation(async (_repoPath: string, args: string[]) => {
      // The first call from computeDiff is `git diff --name-status --no-color <base>`
      // or `git diff --name-status --no-color <base>..<compare>`
      if (args.includes('--name-status')) {
        return 'M\tfile1.ts\nA\tfile2.ts\n';
      }
      // Other raw calls (per-file diff content) — return an empty diff
      return '';
    });

    const { container } = renderDiffPage();

    // Wait for the async computeDiff to run (300ms debounce + tick)
    await new Promise(resolve => setTimeout(resolve, 400));

    // The file list should be rendered
    expect(await screen.findByText('Changed Files (2)')).toBeInTheDocument();
    expect(screen.getByText('file1.ts')).toBeInTheDocument();
    expect(screen.getByText('file2.ts')).toBeInTheDocument();

    // The splitter is rendered as a div with class split-divider
    // (ResizableSplitter renders <div class="split-divider">)
    const splitters = container.querySelectorAll('.split-divider');
    expect(splitters.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT render a splitter when there is only a single file (no list)', async () => {
    // Single-file mode: filePath is not '.' (default is '.', but DiffPage only
    // shows the file list when changedFiles.length > 0)
    mockRaw.mockImplementation(async () => '');
    mockDiff.mockResolvedValue({
      oldContent: '', newContent: '',
      oldPath: 'test.ts', newPath: 'test.ts',
      hunks: [], binary: false,
      newFile: false, deletedFile: false, renamedFile: false,
    });

    const { container } = renderDiffPage();
    await new Promise(resolve => setTimeout(resolve, 400));

    // No file list, no splitter in the body
    const bodySplitters = container.querySelectorAll('.split-divider');
    // Could be 0 — the only splitter is the sidebar one which lives in App,
    // not inside DiffPage. Inside DiffPage, the splitter is only rendered
    // when changedFiles.length > 0.
    expect(bodySplitters.length).toBe(0);
  });
});

describe('DiffPage — consumes diffRequest on mount', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
    mockBranches.mockResolvedValue([]);
    mockLog.mockResolvedValue([]);
    mockDiff.mockResolvedValue({
      oldContent: '', newContent: '',
      oldPath: 'test.ts', newPath: 'test.ts',
      hunks: [], binary: false,
      newFile: false, deletedFile: false, renamedFile: false,
    });
    mockRaw.mockImplementation(async () => '');
  });

  it('applies diffRequest base/compare/filePath on mount, then clears it', async () => {
    // Simulate what StashesPage.handleViewStash does before navigating to /diff
    useSelectionStore.getState().setDiffRequest({
      baseRef: 'deadbeef^',
      compareRef: 'deadbeef',
      filePath: '.',
    });

    expect(useSelectionStore.getState().diffRequest).not.toBeNull();

    renderDiffPage();
    await new Promise(resolve => setTimeout(resolve, 50));

    // The request must be consumed (cleared) after DiffPage mounts
    expect(useSelectionStore.getState().diffRequest).toBeNull();
  });

  it('uses .. (double-dot) not ... (triple-dot) for ref comparison', async () => {
    useSelectionStore.getState().setDiffRequest({
      baseRef: 'abc^',
      compareRef: 'abc',
      filePath: '.',
    });

    const calls: string[][] = [];
    mockRaw.mockImplementation(async (_repoPath: string, args: string[]) => {
      calls.push(args);
      return '';
    });

    renderDiffPage();
    await new Promise(resolve => setTimeout(resolve, 400));

    // Find the call that does `diff --name-status` — it should use `..`
    const diffCalls = calls.filter(args =>
      args.includes('diff') && args.includes('--name-status')
    );
    expect(diffCalls.length).toBeGreaterThan(0);
    // The arg should contain `abc^..abc` (double-dot), NOT `abc^...abc` (triple-dot)
    const refArg = diffCalls[0].find(a => a.includes('..'));
    expect(refArg).toBeDefined();
    expect(refArg).toBe('abc^..abc');
    expect(refArg).not.toContain('...'); // triple-dot is forbidden
  });
});
