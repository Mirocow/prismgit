/**
 * Component test — HistoryPage "Tags on this commit" section.
 *
 * User request: "теги на комите можно как создавать так и удалять и
 * редактировать" — tags on a commit must be creatable, deletable AND
 * editable. The details panel now has a visible inline management section
 * (previously annotated-tag cards were read-only and lightweight tags were
 * not shown at all — the only entry points were buried in the right-click
 * menu). These tests pin:
 *
 *   1. The section renders ALL tags on the selected commit (annotated AND
 *      lightweight, with the lightweight badge).
 *   2. The header "+" button opens the Create-Tag dialog targeted at THIS
 *      commit.
 *   3. The per-card pencil opens the Edit dialog prefilled with the FULL
 *      multi-line message from tagShow (not the truncated subject).
 *   4. Edit-in-place save (same name) → createTag(force=true) with the
 *      edited message.
 *   5. The per-card trash → confirm → deleteTag(repo, name).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { HistoryPage } from '../../src/pages/HistoryPage';

// --- Mocks -------------------------------------------------------------

const mockBranches = vi.fn();
const mockLog = vi.fn();
const mockRaw = vi.fn();
const mockConfigGet = vi.fn();
const mockRevParse = vi.fn();
const mockBugtraq = vi.fn();
const mockTagsAt = vi.fn();
const mockTagShow = vi.fn();
const mockCreateTag = vi.fn();
const mockDeleteTag = vi.fn();
const mockTags = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      branches: (...args: unknown[]) => mockBranches(...args),
      log: (...args: unknown[]) => mockLog(...args),
      raw: (...args: unknown[]) => mockRaw(...args),
      configGet: (...args: unknown[]) => mockConfigGet(...args),
      revParse: (...args: unknown[]) => mockRevParse(...args),
      bugtraqConfig: (...args: unknown[]) => mockBugtraq(...args),
      tagsAt: (...args: unknown[]) => mockTagsAt(...args),
      tagShow: (...args: unknown[]) => mockTagShow(...args),
      createTag: (...args: unknown[]) => mockCreateTag(...args),
      deleteTag: (...args: unknown[]) => mockDeleteTag(...args),
      // Methods called by effects that aren't relevant here — safe defaults.
      extractRepoInfo: vi.fn().mockResolvedValue({ webUrl: null }),
      fetchAll: vi.fn().mockResolvedValue(undefined),
      notesShow: vi.fn().mockResolvedValue(null),
      commitFiles: vi.fn().mockResolvedValue([]),
      mergeNestedCommits: vi.fn().mockResolvedValue([]),
      findCommit: vi.fn().mockResolvedValue(null),
      diffCommit: vi.fn().mockResolvedValue({ hunks: [] }),
      cherryPick: vi.fn().mockResolvedValue(undefined),
      revert: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      rebase: vi.fn().mockResolvedValue(undefined),
      splitCommit: vi.fn().mockResolvedValue(undefined),
      splitOffFiles: vi.fn().mockResolvedValue(undefined),
      checkout: vi.fn().mockResolvedValue(undefined),
      editCommitMessage: vi.fn().mockResolvedValue(undefined),
      editCommitAuthor: vi.fn().mockResolvedValue(undefined),
      // Tags list for the "Tagged (N)" chip (repo-wide total).
      tags: (...args: unknown[]) => mockTags(...args),
      // stashList is called INSIDE loadHistory's try block BEFORE the
      // detail-panel selection is set — a missing mock aborts the flow and
      // the panel stays on "Select a commit".
      stashList: vi.fn().mockResolvedValue([]),
    },
    contextMenu: {
      show: vi.fn().mockResolvedValue(undefined),
      onClick: vi.fn(() => () => {}),
    },
  },
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastActions: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
  useToastStore: () => ({
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (selector?: (s: any) => any) => {
    const state = {
      currentRepo: { path: '/test/repo', name: 'test-repo' },
      repos: [],
      groups: [],
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: Object.assign(
    (selector?: (s: any) => any) => {
      const state = { refreshStatus: vi.fn(), status: null };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ status: null, refreshStatus: vi.fn() }) },
  ),
}));

vi.mock('../../src/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    (selector?: (s: any) => any) => {
      const state = {
        selectedCommitHash: null,
        selectedBranches: new Set<string>(),
        authorFilter: null,
        selectCommit: vi.fn(),
        setDiffRequest: vi.fn(),
        selectFile: vi.fn(),
        clearAll: vi.fn(),
      };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ selectedCommitHash: null, selectCommit: vi.fn() }) },
  ),
}));

vi.mock('../../src/stores/authStore', () => ({
  useAuthStore: (selector?: (s: any) => any) => {
    const state = { user: null, isAuthed: () => false };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string, opts?: any) => {
      if (!opts) return key;
      let s = key;
      for (const [k, v] of Object.entries(opts)) {
        s = s.replace(`{${k}}`, String(v));
      }
      return s;
    },
  }),
  t: (key: string) => key,
  // formatDate.currentLocale() reads useI18nStore.getState().locale.
  useI18nStore: Object.assign(
    (selector?: (s: any) => any) => (selector ? selector({ locale: 'en', dictVersion: 0, setLocale: vi.fn() }) : { locale: 'en', dictVersion: 0, setLocale: vi.fn() }),
    { getState: () => ({ locale: 'en', dictVersion: 0, setLocale: vi.fn() }) },
  ),
}));

const confirmMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: (...args: unknown[]) => confirmMock(...args),
  promptDialog: vi.fn(async () => null),
  ConfirmDialogHost: () => null,
}));

function renderHistory() {
  return render(
    <HashRouter>
      <HistoryPage />
    </HashRouter>,
  );
}

// --- Fixtures ----------------------------------------------------------

const COMMIT_HASH = '1234567890abcdef1234567890abcdef12345678';

const LOG_ENTRIES = [
  {
    hash: COMMIT_HASH,
    hashAbbrev: '1234567',
    parents: [],
    parentsAbbrev: [],
    author: { name: 'Alice', email: 'a@a.a', date: '2026-09-13T10:00:00', timestamp: 1757767200 },
    committer: { name: 'Alice', email: 'a@a.a', date: '2026-09-13T10:00:00', timestamp: 1757767200 },
    subject: 'init commit',
    body: '',
    refs: ['HEAD -> main'],
    message: 'init commit',
  },
];

const TAGS_HERE = [
  { name: 'v1.0.0', annotated: true, tagger: 'Alice', date: '2026-09-13T11:00:00', message: 'Release 1.0.0' },
  { name: 'quick', annotated: false },
];

const FULL_MESSAGE = 'Release 1.0.0\n\n- feature one\n- feature two';

beforeEach(() => {
  vi.clearAllMocks();
  // The commit row renders an Avatar which fetches a gravatar via the
  // preload binding — stub it (branchFilter-style tests never hit this
  // because their log fixture is empty).
  (window as unknown as { smartgit: unknown }).smartgit = {
    avatar: { get: vi.fn().mockResolvedValue(null) },
    events: { on: () => () => {}, emit: () => {} },
  };
  mockBranches.mockResolvedValue([]);
  mockLog.mockResolvedValue(LOG_ENTRIES);
  mockRaw.mockResolvedValue('');
  mockConfigGet.mockResolvedValue('Alice');
  mockRevParse.mockResolvedValue(COMMIT_HASH);
  mockBugtraq.mockResolvedValue(null);
  mockTagsAt.mockResolvedValue(TAGS_HERE);
  mockTagShow.mockResolvedValue({
    name: 'v1.0.0',
    annotated: true,
    message: FULL_MESSAGE,
    tagger: 'Alice',
    date: '2026-09-13T11:00:00.000Z',
    targetHash: COMMIT_HASH,
  });
  mockCreateTag.mockResolvedValue(undefined);
  mockDeleteTag.mockResolvedValue(undefined);
  mockTags.mockResolvedValue([]);
  confirmMock.mockResolvedValue(true);
});

// --- Tests -------------------------------------------------------------

describe('HistoryPage — "Tagged (N)" quick-filter chip semantics', () => {
  // The chip's count must be the TAGGED-COMMITS-IN-VIEW count — exactly the
  // rows the filter shows for the loaded history. It used to show the
  // repo-wide tag-refs total: with a tag on a branch outside the view
  // (e.g. feature/b while on head+upstream) «Tagged (6)» disagreed with the
  // 4 rows the filter produced — the user's «подсчет тегов неверен».
  it('chip counts tagged commits IN VIEW, not all tag refs in the repo', async () => {
    mockLog.mockResolvedValue([
      { ...LOG_ENTRIES[0], subject: 'tagged commit', refs: ['HEAD -> main', 'tag: refs/tags/v1.0.0'] },
      { ...LOG_ENTRIES[0], hash: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd', hashAbbrev: 'abcdefa', subject: 'untagged commit', refs: [] },
    ]);
    // Two tags in the REPO, but only one of them points at a commit that is
    // loaded in this view (mark-f lives on feature/b — outside the walk).
    mockTags.mockResolvedValue([
      { name: 'v1.0.0', hash: COMMIT_HASH, hashAbbrev: '1234567' },
      { name: 'mark-f', hash: 'ffffffffffffffffffffffffffffffffffffffff', hashAbbrev: 'fffffff' },
    ]);
    renderHistory();
    await waitFor(() => expect(screen.getByText('untagged commit')).toBeInTheDocument(), { timeout: 8000 });
    // In-view tagged commits = 1 (NOT 2 = repo tag total).
    expect(screen.getByText(/history\.taggedChip \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/history\.taggedChip \(2\)/)).not.toBeInTheDocument();
  });

  it('inactive chip title uses the taggedChipOff key (numbers pinned in i18nPlural.test.ts)', async () => {
    mockLog.mockResolvedValue([
      { ...LOG_ENTRIES[0], subject: 'tagged commit', refs: ['HEAD -> main', 'tag: refs/tags/v1.0.0'] },
    ]);
    mockTags.mockResolvedValue([
      { name: 'v1.0.0', hash: COMMIT_HASH, hashAbbrev: '1234567' },
      { name: 'mark-f', hash: 'ffffffffffffffffffffffffffffffffffffffff', hashAbbrev: 'fffffff' },
    ]);
    renderHistory();
    await waitFor(() => expect(screen.getByText('tagged commit')).toBeInTheDocument(), { timeout: 8000 });
    const chip = screen.getByText(/history\.taggedChip \(1\)/).closest('button');
    expect(chip).toBeTruthy();
    // The mocked t() returns the key — the real interpolation of {inView}/{total}
    // (both numbers rendered) is pinned by tests/unit/i18nPlural.test.ts with
    // the REAL dictionary. Here we pin the KEY choice: the inactive tooltip is
    // the descriptive one, and clicking activates the filter.
    expect(chip!.getAttribute('title')).toContain('history.taggedChipOff');
    fireEvent.click(chip!);
    await waitFor(() => expect(chip!.getAttribute('title')).toContain('history.taggedChipOn'));
  });
});

describe('HistoryPage — "Tags on this commit" section', () => {
  it('renders ALL tags on the selected commit (annotated + lightweight with badge)', async () => {
    renderHistory();
    // Wait for the commit + its tags section to load (tagsAt is debounced 100ms).
    await waitFor(
      () => {
        expect(screen.getByText('history.tagsSectionTitle')).toBeInTheDocument();
        expect(screen.getByText('v1.0.0')).toBeInTheDocument();
        expect(screen.getByText('quick')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    // The lightweight tag gets its badge; the annotated one does not.
    expect(screen.getByText('history.tagLightweightBadge')).toBeInTheDocument();
  });

  it('the "+" button opens the Create-Tag dialog targeted at the selected commit', async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByText('v1.0.0')).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getByTitle('history.addTagTooltip'));
    // Create dialog title includes the target commit's short hash.
    await waitFor(() => {
      expect(screen.getByText(/history\.tagDialogCreateTitle/)).toBeInTheDocument();
    });
    // Create button (not Save) — create mode.
    expect(screen.getByText('history.tagCreateButton')).toBeInTheDocument();
  });

  it('the per-card pencil opens the Edit dialog prefilled with the FULL message from tagShow', async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByText('v1.0.0')).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getAllByTitle('history.editTagTooltip')[0]);
    await waitFor(() => {
      expect(mockTagShow).toHaveBeenCalledWith('/test/repo', 'v1.0.0');
    });
    // Edit-mode dialog.
    await waitFor(() => {
      expect(screen.getByText(/history\.tagDialogEditTitle/)).toBeInTheDocument();
    });
    // Save button (not Create) — edit mode.
    expect(screen.getByText('history.tagSaveButton')).toBeInTheDocument();
    // The textarea holds the FULL multi-line message.
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Release 1.0.0') as HTMLTextAreaElement;
      expect(textarea.value).toBe(FULL_MESSAGE);
    });
  });

  it('edit save (same name) → createTag(force=true) with the edited message', async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByText('v1.0.0')).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getAllByTitle('history.editTagTooltip')[0]);
    await waitFor(() => {
      expect(screen.getByText(/history\.tagDialogEditTitle/)).toBeInTheDocument();
    });
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText('Release 1.0.0') as HTMLTextAreaElement;
      expect(textarea.value).toBe(FULL_MESSAGE);
    });
    fireEvent.change(screen.getByPlaceholderText('Release 1.0.0'), { target: { value: 'EDITED message' } });
    fireEvent.click(screen.getByText('history.tagSaveButton'));
    await waitFor(() => {
      expect(mockCreateTag).toHaveBeenCalledWith(
        '/test/repo',
        'v1.0.0',
        'EDITED message',
        COMMIT_HASH,
        true, // force — same-name edit re-creates the tag object
        true, // annotated
      );
    });
    expect(mockDeleteTag).not.toHaveBeenCalled();
  });

  it('the per-card trash → confirm → deleteTag(repo, name)', async () => {
    renderHistory();
    await waitFor(() => expect(screen.getByText('v1.0.0')).toBeInTheDocument(), { timeout: 8000 });
    fireEvent.click(screen.getAllByTitle('history.deleteTagTooltip')[0]);
    await waitFor(() => {
      expect(mockDeleteTag).toHaveBeenCalledWith('/test/repo', 'v1.0.0');
    });
  });
});
