/**
 * PushRejectionDialog — the remote-conflict REACTION surface.
 *
 * Pins the contract for every recoverable push rejection:
 *   1. non-fast-forward → pull&merge / pull&rebase / force buttons; the
 *      pull recovery RETRIES the push; a conflicted pull hands over to the
 *      Changes resolver (dialog closes, no error toast); a SECOND
 *      rejection re-opens the dialog with the fresh failure.
 *   2. force button hidden when the local policy denies it.
 *   3. lease-stale → fetch & retry pushes with the SAME force mode.
 *   4. protected → Create MR opens the pre-filled provider URL; copy branch.
 *   5. policy → explanation only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pullSpy = vi.fn().mockResolvedValue(undefined);
const pushSpy = vi.fn().mockResolvedValue({});
const fetchSpy = vi.fn().mockResolvedValue(undefined);
const surfaceSpy = vi.fn().mockResolvedValue(false);
const toastSuccess = vi.fn();
const toastError = vi.fn();
const openExternal = vi.fn();
const extractRepoInfo = vi.fn();
const isForcePushAllowed = vi.fn().mockResolvedValue({ allowed: true, reason: '' });
const clipboardSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      isForcePushAllowed: (...a: unknown[]) => isForcePushAllowed(...a),
      extractRepoInfo: (...a: unknown[]) => extractRepoInfo(...a),
    },
    app: { openExternal: (...a: unknown[]) => openExternal(...a) },
  },
}));

vi.mock('../../src/stores/gitStore', () => ({
  useGitStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { status: { current: 'main' } };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        status: { current: 'main' },
        pull: pullSpy,
        push: pushSpy,
        fetch: fetchSpy,
      }),
    },
  ),
  surfaceConflictedState: (...a: unknown[]) => surfaceSpy(...a),
}));

vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: (selector?: (s: unknown) => unknown) => {
    const state = { warning: vi.fn(), success: toastSuccess, error: toastError };
    return selector ? selector(state) : state;
  },
  useToastActions: () => ({
    warning: vi.fn(), success: toastSuccess, error: toastError, info: vi.fn(),
    show: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: unknown) => unknown) => {
      const state = { settings: {} };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ settings: {} }) },
  ),
}));

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (k: string, p?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'dialogs.pushRejection.nonFFTitle': 'Push rejected — the remote branch moved ahead',
        'dialogs.pushRejection.nonFFBody': 'The remote branch "{branch}" has commits you do not have locally.',
        'dialogs.pushRejection.leaseTitle': 'Force push rejected — stale lease',
        'dialogs.pushRejection.leaseBody': 'The remote branch "{branch}" changed since your last fetch.',
        'dialogs.pushRejection.protectedTitle': 'Push rejected — branch is protected',
        'dialogs.pushRejection.protectedBody': 'The server refuses direct pushes to "{branch}".',
        'dialogs.pushRejection.policyTitle': 'Force push denied by policy',
        'dialogs.pushRejection.policyBody': 'Local policy denies force push to this branch.',
        'dialogs.pushRejection.branchLabel': 'Branch:',
        'dialogs.pushRejection.rawLabel': 'git output:',
        'dialogs.pushRejection.pullAndMerge': 'Pull and merge',
        'dialogs.pushRejection.pullAndRebase': 'Pull with rebase',
        'dialogs.pushRejection.forceLease': 'Overwrite (--force-with-lease)',
        'dialogs.pushRejection.fetchAndRetry': 'Fetch and retry push',
        'dialogs.pushRejection.createMr': 'Create Merge Request / Pull Request',
        'dialogs.pushRejection.copyBranch': 'Copy branch name',
        'dialogs.pushRejection.recovered': 'Push completed after recovery',
        'dialogs.pushRejection.branchCopied': 'Branch name copied',
        'shell.pushFailed': 'Push failed',
        'shell.noRemoteUrl': 'No remote URL',
        'shell.openInBrowserFailed': 'Open in browser failed',
        'common.cancel': 'Cancel',
      };
      let s = dict[k] ?? k;
      if (p) for (const [key, v] of Object.entries(p)) s = s.replace(`{${key}}`, String(v));
      return s;
    },
  }),
}));

vi.mock('../../src/lib/utils', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/utils')>();
  return { ...orig, copyToClipboard: (...a: unknown[]) => clipboardSpy(...a) };
});

import { PushRejectionDialog } from '../../src/components/PushRejectionDialog';
import { usePushRejectionStore } from '../../src/stores/pushRejectionStore';
import { offerPushRejection } from '../../src/stores/pushRejectionStore';

const NON_FF = `To origin
 ! [rejected]        main -> main (fetch first)
error: failed to push some refs to 'origin'
hint: Updates were rejected because the tip of your current branch is behind`;

function openDialog(failure: { kind: string; message?: string; remoteBranch?: string }, extra: Record<string, unknown> = {}) {
  usePushRejectionStore.getState().open({
    repoPath: '/test/repo',
    failure: {
      kind: failure.kind as never,
      message: failure.message ?? NON_FF,
      remoteBranch: failure.remoteBranch ?? 'main',
    },
    ...extra,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePushRejectionStore.getState().close();
  isForcePushAllowed.mockResolvedValue({ allowed: true, reason: '' });
});

afterEach(() => {
  usePushRejectionStore.getState().close();
});

describe('PushRejectionDialog — non-fast-forward', () => {
  it('renders title, branch, raw output and the three recovery actions', () => {
    openDialog({ kind: 'non-fast-forward' });
    render(<PushRejectionDialog />);
    expect(screen.getByText('Push rejected — the remote branch moved ahead')).toBeTruthy();
    expect(screen.getByText('main')).toBeTruthy();
    expect(screen.getByText('git output:')).toBeTruthy();
    expect(screen.getByText('Pull and merge')).toBeTruthy();
    expect(screen.getByText('Pull with rebase')).toBeTruthy();
    expect(screen.getByText('Overwrite (--force-with-lease)')).toBeTruthy();
  });

  it('«Pull and merge» → pull with the merge override, then the push RETRIES; success toast; dialog closes', async () => {
    openDialog({ kind: 'non-fast-forward' }, { remote: 'origin' });
    render(<PushRejectionDialog />);
    fireEvent.click(screen.getByText('Pull and merge'));
    await waitFor(() => {
      expect(pullSpy).toHaveBeenCalledWith('/test/repo', 'origin', undefined, 'merge');
      expect(pushSpy).toHaveBeenCalledWith('/test/repo', 'origin', undefined, undefined, undefined, undefined, undefined);
      expect(toastSuccess).toHaveBeenCalledWith('Push completed after recovery');
    });
    // Dialog closed itself.
    expect(usePushRejectionStore.getState().ctx).toBeNull();
    expect(screen.queryByText('Push rejected — the remote branch moved ahead')).toBeNull();
  });

  it('«Pull with rebase» passes the rebase override', async () => {
    openDialog({ kind: 'non-fast-forward' });
    render(<PushRejectionDialog />);
    fireEvent.click(screen.getByText('Pull with rebase'));
    await waitFor(() => expect(pullSpy).toHaveBeenCalledWith('/test/repo', undefined, undefined, 'rebase'));
  });

  it('a CONFLICTED pull hands over to the Changes resolver — no raw error toast', async () => {
    pullSpy.mockRejectedValueOnce(new Error('Automatic merge failed; fix conflicts and then commit the result.'));
    surfaceSpy.mockResolvedValueOnce(true);
    openDialog({ kind: 'non-fast-forward' });
    render(<PushRejectionDialog />);
    fireEvent.click(screen.getByText('Pull and merge'));
    await waitFor(() => expect(surfaceSpy).toHaveBeenCalledWith('/test/repo'));
    expect(toastError).not.toHaveBeenCalled();
    expect(usePushRejectionStore.getState().ctx).toBeNull();
  });

  it('a SECOND push rejection re-opens the dialog with the fresh failure', async () => {
    pushSpy.mockRejectedValueOnce(new Error(NON_FF));
    openDialog({ kind: 'non-fast-forward' });
    render(<PushRejectionDialog />);
    fireEvent.click(screen.getByText('Pull and merge'));
    // Still open — with the SAME kind, ready for the user's next decision.
    await waitFor(() => expect(usePushRejectionStore.getState()?.ctx?.failure.kind).toBe('non-fast-forward'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('hides the destructive recovery when the local force-push policy denies it', async () => {
    isForcePushAllowed.mockResolvedValue({ allowed: false, reason: 'protected by policy' });
    openDialog({ kind: 'non-fast-forward' });
    render(<PushRejectionDialog />);
    await waitFor(() => expect(screen.queryByText('Overwrite (--force-with-lease)')).toBeNull());
    expect(screen.getByText('Pull and merge')).toBeTruthy();
  });
});

describe('PushRejectionDialog — lease-stale', () => {
  it('«Fetch and retry» → fetch, then the SAME force push (force-with-lease)', async () => {
    openDialog({ kind: 'lease-stale' }, { remote: 'origin', branch: 'main', force: true, forceMode: 'lease' });
    render(<PushRejectionDialog />);
    expect(screen.getByText('Force push rejected — stale lease')).toBeTruthy();
    fireEvent.click(screen.getByText('Fetch and retry push'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/test/repo', 'origin', true);
      expect(pushSpy).toHaveBeenCalledWith('/test/repo', 'origin', 'main', undefined, true, undefined, 'lease');
    });
  });
});

describe('PushRejectionDialog — protected branch', () => {
  it('«Create MR» opens the pre-filled provider page; «Copy branch name» copies', async () => {
    extractRepoInfo.mockResolvedValueOnce({
      webUrl: 'http://gitlab.example.com/web/git/prismgit',
      provider: 'gitlab',
      owner: 'web',
      repo: 'prismgit',
    });
    openDialog({ kind: 'protected' });
    render(<PushRejectionDialog />);
    expect(screen.getByText('Push rejected — branch is protected')).toBeTruthy();
    // No pull/rebase/force buttons — the server route is an MR, not a retry.
    expect(screen.queryByText('Pull and merge')).toBeNull();
    expect(screen.queryByText('Overwrite (--force-with-lease)')).toBeNull();

    fireEvent.click(screen.getByText('Copy branch name'));
    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledWith('main'));
    expect(toastSuccess).toHaveBeenCalledWith('Branch name copied');

    fireEvent.click(screen.getByText('Create Merge Request / Pull Request'));
    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith(
        'http://gitlab.example.com/web/git/prismgit/-/merge_requests/new?merge_request[source_branch]=main',
      ),
    );
    expect(usePushRejectionStore.getState().ctx).toBeNull();
  });
});

describe('PushRejectionDialog — local policy', () => {
  it('explains the setting and offers no git recovery', () => {
    openDialog({ kind: 'policy', message: 'fatal: force-push denied by PrismGit policy' });
    render(<PushRejectionDialog />);
    expect(screen.getByText('Force push denied by policy')).toBeTruthy();
    expect(screen.queryByText('Pull and merge')).toBeNull();
    expect(screen.queryByText('Create Merge Request / Pull Request')).toBeNull();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});

describe('offerPushRejection — the catch-site contract', () => {
  it('opens the dialog for recoverable kinds and returns true', () => {
    const offered = offerPushRejection(new Error(NON_FF), { repoPath: '/test/repo' });
    expect(offered).toBe(true);
    expect(usePushRejectionStore.getState().ctx?.failure.kind).toBe('non-fast-forward');
    usePushRejectionStore.getState().close();
  });

  it('returns false (no dialog) for network/auth noise — caller keeps its toast', () => {
    expect(offerPushRejection(new Error('fatal: unable to access: Connection refused'), { repoPath: '/x' })).toBe(false);
    expect(offerPushRejection(new Error('remote: HTTP Basic: Access denied'), { repoPath: '/x' })).toBe(false);
    expect(usePushRejectionStore.getState().ctx).toBeNull();
  });
});
