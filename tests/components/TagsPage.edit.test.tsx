/**
 * Component test — TagsPage tag EDIT dialog.
 *
 * User request: "теги на комите можно как создавать так и удалять и
 * редактировать" — tags must be creatable, deletable AND editable. The
 * inline rename-only input was replaced by a full edit dialog (name +
 * message). These tests pin:
 *
 *   1. The pencil (edit) button opens the dialog.
 *   2. The dialog prefills with the FULL multi-line message from tagShow
 *      (NOT the subject from tags() — that truncated multi-line messages).
 *   3. Save with the SAME name → createTag(force=true) message update,
 *      deleteTag NOT called.
 *   4. Save with a NEW name → createTag(new, message preserved) +
 *      deleteTag(old) — rename semantics that keep the annotation.
 *   5. tagShow rejection → dialog still opens with the tags()-derived
 *      prefill (graceful degradation, never a crash).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TagsPage } from '../../src/pages/TagsPage';

const apiGitMock = vi.hoisted(() => ({
  tags: vi.fn(),
  tagShow: vi.fn(),
  checkout: vi.fn().mockResolvedValue(undefined),
  deleteTag: vi.fn().mockResolvedValue(undefined),
  createTag: vi.fn().mockResolvedValue(undefined),
  addAnnotatedTag: vi.fn().mockResolvedValue('taghash'),
  raw: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    git: apiGitMock,
    fs: {},
    commandLog: { onEntry: () => () => {}, list: vi.fn().mockResolvedValue([]), clear: vi.fn() },
    clipboard: { writeText: vi.fn() },
    app: { openExternal: vi.fn(), getVersion: vi.fn().mockResolvedValue('test') },
    settings: { getAll: vi.fn().mockResolvedValue({}), set: vi.fn() },
  },
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (sel: any) => sel({
    currentRepo: { path: '/test/repo', name: 'test-repo' },
  }),
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: (sel: any) => sel({
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    status: null,
  }),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => toastMock,
  useToastActions: () => toastMock,
}));

vi.mock('../../src/stores/selectionStore', () => ({
  useSelectionStore: (sel?: any) => sel
    ? sel({ selectedTag: null, selectedCommitHash: null })
    : ({
        selectedTag: null,
        selectedCommitHash: null,
        getState: () => ({ selectTag: vi.fn(), selectCommit: vi.fn() }),
      }),
}));

const logOpMock = vi.hoisted(() => ({
  startOp: vi.fn().mockReturnValue('op-1'),
  finishOp: vi.fn(),
  failOp: vi.fn(),
  logOperation: vi.fn(async (_action: string, _repo: string, _cmd: string, fn: () => Promise<any>) => {
    return await fn();
  }),
}));
vi.mock('../../src/stores/operationLogStore', () => {
  const storeObj = {
    getState: () => logOpMock,
    startOp: logOpMock.startOp,
    finishOp: logOpMock.finishOp,
    failOp: logOpMock.failOp,
    logOperation: logOpMock.logOperation,
  };
  const hook = (sel?: any) => sel ? sel(storeObj) : storeObj;
  (hook as any).getState = () => logOpMock;
  (hook as any).setState = () => {};
  (hook as any).subscribe = () => () => {};
  return { useOperationLogStore: hook };
});

vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
  promptDialog: vi.fn(() => Promise.resolve(null)),
  ConfirmDialogHost: () => null,
}));

vi.mock('../../src/components/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../../src/components/StatusBar', () => ({
  CommitHashLink: ({ hash }: { hash: string }) => <span>{String(hash).slice(0, 7)}</span>,
}));

vi.mock('../../src/hooks/useEscapeKey', () => ({
  useEscapeKey: () => {},
}));

vi.mock('../../src/lib/useContextMenu', () => ({
  useContextMenu: () => vi.fn(),
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
}));

const ANNOTATED_HASH = 'abcdef1234567890abcdef1234567890abcdef12';
const FULL_MESSAGE = 'Release 1.0.0\n\n- feature one\n- feature two';

const TEST_TAGS = [
  {
    name: 'v1.0.0',
    hash: ANNOTATED_HASH,
    hashAbbrev: 'abcdef1',
    annotation: 'Release 1.0.0', // subject ONLY — the full message has a body
    date: '2026-09-13T10:00:00',
    author: 'Alice',
    lightweight: false,
    targetHash: ANNOTATED_HASH,
  },
  {
    name: 'lw',
    hash: 'bbcdcef1234567890abcdef1234567890abcdef12',
    hashAbbrev: 'bbcdcef',
    annotation: undefined,
    date: undefined,
    author: undefined,
    lightweight: true,
    targetHash: undefined,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiGitMock.tags.mockResolvedValue(TEST_TAGS);
  apiGitMock.tagShow.mockResolvedValue({
    name: 'v1.0.0',
    annotated: true,
    message: FULL_MESSAGE,
    tagger: 'Alice',
    date: '2026-09-13T10:00:00.000Z',
    targetHash: ANNOTATED_HASH,
  });
});

function clickEditButton() {
  // The pencil button has title "common.edit" (mocked i18n returns the key).
  const editBtn = screen.getAllByTitle('common.edit')[0];
  fireEvent.click(editBtn);
}

/** The edit-dialog message textarea — NOTE: getByDisplayValue does not see
 *  React's post-render value updates for <textarea> in this jsdom/React
 *  combination (the DOM .value IS correct — verified), so queries go via
 *  the mocked i18n placeholder and the .value property is asserted. */
function getEditTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('tags.messagePlaceholder') as HTMLTextAreaElement;
}

function getEditNameInput(): HTMLInputElement {
  return screen.getByPlaceholderText('v2.0.0') as HTMLInputElement;
}

describe('TagsPage — tag EDIT dialog', () => {
  it('pencil button opens the edit dialog and prefills the FULL multi-line message via tagShow', async () => {
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    clickEditButton();
    await waitFor(() => {
      expect(apiGitMock.tagShow).toHaveBeenCalledWith('/test/repo', 'v1.0.0');
    });
    // Dialog title shows the tag name
    await waitFor(() => {
      expect(screen.getByText(/tags\.editTitle/)).toBeInTheDocument();
    });
    // The textarea holds the FULL message (with the body lines) — NOT the
    // truncated subject from tags().
    await waitFor(() => expect(getEditTextarea().value).toBe(FULL_MESSAGE));
    // Name input prefilled with the tag name.
    expect(getEditNameInput().value).toBe('v1.0.0');
  });

  it('save with the SAME name → createTag(force=true) update, deleteTag NOT called', async () => {
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    clickEditButton();
    await waitFor(() => expect(screen.getByText(/tags\.editTitle/)).toBeInTheDocument());
    await waitFor(() => expect(getEditTextarea().value).toBe(FULL_MESSAGE));

    // Change the message only — keep the name.
    fireEvent.change(getEditTextarea(), { target: { value: 'Edited message body' } });

    fireEvent.click(screen.getByText('common.save'));
    await waitFor(() => {
      expect(apiGitMock.createTag).toHaveBeenCalledWith(
        '/test/repo',
        'v1.0.0',
        'Edited message body',
        ANNOTATED_HASH,
        true, // force — same-name edit re-creates the tag object
        true, // annotated
      );
    });
    expect(apiGitMock.deleteTag).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('tags.updated');
  });

  it('save with a NEW name → createTag(new name, message preserved) + deleteTag(old) — rename keeps the annotation', async () => {
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    clickEditButton();
    await waitFor(() => expect(getEditTextarea().value).toBe(FULL_MESSAGE));

    // Rename: change the name, keep the message.
    fireEvent.change(getEditNameInput(), { target: { value: 'v2.0.0' } });

    fireEvent.click(screen.getByText('common.save'));
    await waitFor(() => {
      expect(apiGitMock.createTag).toHaveBeenCalledWith(
        '/test/repo',
        'v2.0.0',
        FULL_MESSAGE, // message preserved — the OLD code lost it here
        ANNOTATED_HASH,
        false, // no force — the new name does not exist yet
        true, // annotated
      );
    });
    await waitFor(() => {
      expect(apiGitMock.deleteTag).toHaveBeenCalledWith('/test/repo', 'v1.0.0');
    });
    expect(toastMock.success).toHaveBeenCalledWith('tags.renamed');
  });

  it('tagShow failure → dialog still opens with the tags()-derived prefill (graceful degradation)', async () => {
    apiGitMock.tagShow.mockRejectedValueOnce(new Error('ipc gone'));
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    clickEditButton();
    // Dialog opens (title), prefill falls back to tags().annotation (subject).
    await waitFor(() => {
      expect(screen.getByText(/tags\.editTitle/)).toBeInTheDocument();
    });
    // Subject-only fallback, not empty.
    await waitFor(() => expect(getEditTextarea().value).toBe('Release 1.0.0'));
    // No crash toast for the prefill failure.
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('lightweight tag edit → comment textarea is SHOWN so a comment can be added', async () => {
    // BUGFIX («При редактировании тега если ранее тег не содержал комментарий
    // то окно ввода комментария не отображается»): lightweight tags used to
    // open with editAnnotated=false, hiding the message textarea entirely —
    // there was no way to ADD a comment. Now the annotated checkbox defaults
    // to ON and the textarea is visible (unchecking keeps it lightweight).
    apiGitMock.tagShow.mockResolvedValueOnce({
      name: 'lw',
      annotated: false,
      message: '',
      targetHash: 'bbcdcef1234567890abcdef1234567890abcdef12',
    });
    render(<TagsPage />);
    await screen.findByText('v1.0.0');
    // The FIRST row's pencil targets v1.0.0 — use the second row's pencil.
    const editButtons = screen.getAllByTitle('common.edit');
    fireEvent.click(editButtons[1]);
    await waitFor(() => {
      expect(apiGitMock.tagShow).toHaveBeenCalledWith('/test/repo', 'lw');
    });
    await waitFor(() => {
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });
    // The comment input is present (empty) — ready for a new comment.
    expect(getEditTextarea()).toBeInTheDocument();
    expect(getEditTextarea().value).toBe('');
  });
});
