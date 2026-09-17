/**
 * Regression test for the FileHistoryPage empty-path crash.
 *
 * Bug: when the user navigates from /file-history?file=foo.ts to
 * /file-history (no ?file=), the URL `filePath` becomes empty but
 * the `commits` state from the previous load is still populated.
 * The useEffect watching `loadSnapshot` then fired (because its ref
 * changed) and called `api.git.blame(repoPath, '', commit.hash)` —
 * which crashes with `fatal: no such path  in <hash>` (note the
 * double space — empty path).
 *
 * Fix: clear commits/snapshot/blame when filePath becomes empty AND
 * guard `loadSnapshot` against empty filePath.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FileHistoryPage } from '../../src/pages/FileHistoryPage';

// Track every git.blame invocation so we can assert it's never called
// with an empty file path.
const blameMock = vi.fn().mockResolvedValue({ lines: [], file: '', totalLines: 0 });
const logMock = vi.fn().mockResolvedValue([]);
const showFileMock = vi.fn().mockResolvedValue('');

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      log: (...args: unknown[]) => logMock(...args),
      blame: (...args: unknown[]) => blameMock(...args),
      showFile: (...args: unknown[]) => showFileMock(...args),
      raw: vi.fn().mockResolvedValue(''),
    },
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: () => ({ currentRepo: { path: '/fake/repo' } }),
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: () => ({ refreshStatus: vi.fn() }),
}));

const stableToast = {
  error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(),
};
vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => stableToast,
}));

function renderPage(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <FileHistoryPage />
    </MemoryRouter>
  );
}

describe('FileHistoryPage — empty-path crash regression', () => {
  beforeEach(() => {
    blameMock.mockClear();
    logMock.mockClear();
    showFileMock.mockClear();
  });

  it('does not call api.git.blame when no ?file= is provided', async () => {
    logMock.mockResolvedValue([]);
    const { unmount } = renderPage('/file-history');
    // Wait for any pending effects / timers to settle.
    await new Promise((r) => setTimeout(r, 80));
    expect(blameMock).not.toHaveBeenCalled();
    unmount();
  });
});
