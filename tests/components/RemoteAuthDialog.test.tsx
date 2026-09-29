/**
 * RemoteAuthDialog — the HTTP-authentication REACTION surface.
 *
 * Pins the contract:
 *  1. Renders the kind-specific explanation (host chip from the classified
 *     failure), the remote/username/password fields, the storage-security
 *     note and the raw git output; loads the repo's remotes on open.
 *  2. Remote preselect: ctx.remoteName when known, otherwise the remote
 *     whose URL matches the FAILING HOST (pull from a second remote of the
 *     same server picks the right one).
 *  3. «Save and retry» → setRemoteAuth (repo+remote+cred) → invalidateCache
 *     (the main-process credential cache must re-read FRESH credentials,
 *     not the 5 s stale map) → retry(cred) → close.
 *  4. A retry failure → error toast + close (no re-offer dead loop).
 *  5. No retry closure → "credentials saved" toast.
 *  6. Blank password + stored password → the STORED password is kept (a
 *     username-only edit must not silently erase the saved password).
 *  7. Cancel → close, nothing written.
 *  8. CLONE contexts: api.git.remotes fails (repo does not exist) — the
 *     dialog still works with the fallback 'origin' remote.
 *  9. offerAuthBypass — the catch-site contract (true + dialog for the
 *     REPORTED auth error; false for anything else).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const remotes = vi.fn();
const invalidateCache = vi.fn().mockResolvedValue(undefined);
const getRemoteAuth = vi.fn().mockReturnValue({});
const setRemoteAuth = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      remotes: (...a: unknown[]) => remotes(...a),
      invalidateCache: (...a: unknown[]) => invalidateCache(...a),
    },
  },
}));

vi.mock('../../src/lib/remoteAuth', () => ({
  getRemoteAuth: (...a: unknown[]) => getRemoteAuth(...a),
  setRemoteAuth: (...a: unknown[]) => setRemoteAuth(...a),
  getAllRemoteAuth: vi.fn().mockReturnValue({}),
  clearRemoteAuth: vi.fn(),
  hasRemoteAuth: vi.fn().mockReturnValue(false),
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

vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (k: string, p?: Record<string, unknown>) => {
      const dict: Record<string, string> = {
        'dialogs.remoteAuth.title': 'Authentication required',
        'dialogs.remoteAuth.body.noCredentials': 'The server {host} requires a username and password/token, but none are stored for this repository.',
        'dialogs.remoteAuth.body.badCredentials': 'The stored username/password for {host} was REJECTED by the server.',
        'dialogs.remoteAuth.body.forbidden': '{host} accepted the authentication but denied access (403).',
        'dialogs.remoteAuth.body.other': 'Authentication for {host} failed.',
        'dialogs.remoteAuth.hostLabel': 'Server:',
        'dialogs.remoteAuth.remoteLabel': 'Remote',
        'dialogs.remoteAuth.usernameLabel': 'Username',
        'dialogs.remoteAuth.passwordLabel': 'Password / token',
        'dialogs.remoteAuth.securityNote': 'The password is stored in the encrypted application vault.',
        'dialogs.remoteAuth.apply': 'Save and retry',
        'dialogs.remoteAuth.applyHint': 'Saves the credentials and retries',
        'dialogs.remoteAuth.savedNoRetry': 'Credentials saved',
        'dialogs.remoteAuth.retryFailed': 'Retry failed',
        'dialogs.pushRejection.rawLabel': 'git output:',
        'common.cancel': 'Cancel',
      };
      let s = dict[k] ?? k;
      if (p) for (const [key, v] of Object.entries(p)) s = s.replace(`{${key}}`, String(v));
      return s;
    },
  }),
}));

import { RemoteAuthDialog } from '../../src/components/RemoteAuthDialog';
import { useAuthBypassStore, offerAuthBypass } from '../../src/stores/authBypassStore';

const REPORTED = `Authentication failed — enter Username + Password/token. fatal: could not read Username for 'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled`;

const CORP_REMOTES = [
  { name: 'upstream', refs: { fetch: 'https://github.com/owner/repo.git' } },
  { name: 'origin', refs: { fetch: 'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git' } },
];

function openDialog(extra: Record<string, unknown> = {}) {
  useAuthBypassStore.getState().open({
    repoPath: '/test/repo',
    failure: {
      kind: 'no-credentials',
      host: 'git.nbgi.cloud.rt-dc.ru',
      url: 'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git',
      message: REPORTED,
    },
    ...extra,
  } as never);
}

function typeInto(labelText: string, value: string) {
  const input = screen.getByLabelText(labelText);
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthBypassStore.getState().close();
  remotes.mockResolvedValue(CORP_REMOTES);
  getRemoteAuth.mockReturnValue({});
  invalidateCache.mockResolvedValue(undefined);
});

afterEach(() => {
  useAuthBypassStore.getState().close();
});

describe('RemoteAuthDialog — rendering', () => {
  it('shows the kind-specific explanation, host chip, fields, security note and raw output', async () => {
    openDialog();
    render(<RemoteAuthDialog />);
    expect(screen.getByText('Authentication required')).toBeTruthy();
    expect(
      screen.getByText(/The server git\.nbgi\.cloud\.rt-dc\.ru requires a username and password\/token/)
    ).toBeTruthy();
    expect(screen.getByText('git.nbgi.cloud.rt-dc.ru')).toBeTruthy();
    expect(screen.getByText('Remote')).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Password / token')).toBeTruthy();
    expect(screen.getByText(/encrypted application vault/)).toBeTruthy();
    expect(screen.getByText('git output:')).toBeTruthy();
    expect(screen.getByText('Save and retry')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    await waitFor(() => expect(remotes).toHaveBeenCalledWith('/test/repo'));
  });

  it('preselects the remote whose URL matches the failing host (no remoteName given)', async () => {
    openDialog(); // no remoteName — host-match must pick 'origin', not the first 'upstream'
    render(<RemoteAuthDialog />);
    await waitFor(() => {
      const select = screen.getByLabelText('Remote') as HTMLSelectElement;
      expect(select.value).toBe('origin');
    });
  });

  it('renders nothing while the store is closed', () => {
    render(<RemoteAuthDialog />);
    expect(screen.queryByText('Authentication required')).toBeNull();
  });

  it('refines the body when a STORED credential exists: «could not read Username» after a 401 means REJECTED, not absent', () => {
    // git prints the same «could not read Username … terminal prompts disabled»
    // both when nothing was stored AND when the stored header came back 401
    // (git then re-prompts). With a stored credential prefilled, the dialog
    // must tell the user to FIX it, not claim nothing is stored.
    getRemoteAuth.mockReturnValue({ username: 'ivan', password: 'expired-token' });
    openDialog();
    render(<RemoteAuthDialog />);
    expect(
      screen.getByText(/stored username\/password for git\.nbgi\.cloud\.rt-dc\.ru was REJECTED/)
    ).toBeTruthy();
    expect(
      screen.queryByText(/none are stored for this repository/)
    ).toBeNull();
  });
});

describe('RemoteAuthDialog — «Save and retry»', () => {
  it('saves the credentials, drops the main-process cache, retries with them and closes', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    openDialog({ remoteName: 'origin', retry });
    render(<RemoteAuthDialog />);
    typeInto('Username', 'ivan.petrov');
    typeInto('Password / token', 's3cret-token');
    fireEvent.click(screen.getByText('Save and retry'));
    await waitFor(() => {
      expect(setRemoteAuth).toHaveBeenCalledWith('/test/repo', 'origin', {
        username: 'ivan.petrov',
        password: 's3cret-token',
      });
      expect(invalidateCache).toHaveBeenCalledWith('/test/repo');
      expect(retry).toHaveBeenCalledWith({ username: 'ivan.petrov', password: 's3cret-token' });
    });
    expect(useAuthBypassStore.getState().ctx).toBeNull();
    // Retry handled its own success toast — the dialog adds nothing.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('a FAILED retry → error toast, dialog closes (no re-offer loop)', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('Authentication failed again'));
    openDialog({ retry });
    render(<RemoteAuthDialog />);
    typeInto('Username', 'u');
    typeInto('Password / token', 'p');
    fireEvent.click(screen.getByText('Save and retry'));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Retry failed', expect.stringContaining('Authentication failed again'));
    });
    expect(useAuthBypassStore.getState().ctx).toBeNull();
  });

  it('without a retry closure → "credentials saved" toast (the GitFlow case)', async () => {
    openDialog(); // no retry — the finish flow is not idempotent
    render(<RemoteAuthDialog />);
    typeInto('Username', 'u');
    typeInto('Password / token', 'p');
    fireEvent.click(screen.getByText('Save and retry'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Credentials saved'));
    expect(setRemoteAuth).toHaveBeenCalledTimes(1);
    expect(useAuthBypassStore.getState().ctx).toBeNull();
  });

  it('a stored credential prefills the fields — a username-only edit keeps the (masked) password', async () => {
    getRemoteAuth.mockReturnValue({ username: 'old.user', password: 'kept-pass' });
    const retry = vi.fn().mockResolvedValue(undefined);
    openDialog({ retry });
    render(<RemoteAuthDialog />);
    // BOTH fields prefilled (masked) — what you see is what gets saved.
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('old.user');
    expect((screen.getByLabelText('Password / token') as HTMLInputElement).value).toBe('kept-pass');
    // Fix ONLY the username; the password field keeps the stored value.
    typeInto('Username', 'new.user');
    fireEvent.click(screen.getByText('Save and retry'));
    await waitFor(() => {
      expect(setRemoteAuth).toHaveBeenCalledWith('/test/repo', 'origin', {
        username: 'new.user',
        password: 'kept-pass',
      });
      expect(retry).toHaveBeenCalled();
    });
  });

  it('Save stays disabled until both username and password are filled', () => {
    openDialog();
    render(<RemoteAuthDialog />);
    const save = screen.getByText('Save and retry') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    typeInto('Username', 'user');
    expect(save.disabled).toBe(true); // username alone is not enough
    typeInto('Password / token', 'pass');
    expect(save.disabled).toBe(false);
  });
});

describe('RemoteAuthDialog — CLONE mode (the repo does not exist yet)', () => {
  it('api.git.remotes failure falls back to the future origin remote; save+retry still work', async () => {
    remotes.mockRejectedValue(new Error('not a repository'));
    const retry = vi.fn().mockResolvedValue(undefined);
    openDialog({ repoPath: '/target/new-repo', remoteName: 'origin', retry });
    render(<RemoteAuthDialog />);
    typeInto('Username', 'clone-user');
    typeInto('Password / token', 'clone-pass');
    fireEvent.click(screen.getByText('Save and retry'));
    await waitFor(() => {
      // Keyed by the TARGET path — clone() reads the credential from there.
      expect(setRemoteAuth).toHaveBeenCalledWith('/target/new-repo', 'origin', {
        username: 'clone-user',
        password: 'clone-pass',
      });
      expect(retry).toHaveBeenCalledWith({ username: 'clone-user', password: 'clone-pass' });
    });
    expect(useAuthBypassStore.getState().ctx).toBeNull();
  });
});

describe('RemoteAuthDialog — Cancel', () => {
  it('closes without writing anything', () => {
    openDialog();
    render(<RemoteAuthDialog />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(setRemoteAuth).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
    expect(useAuthBypassStore.getState().ctx).toBeNull();
  });
});

describe('offerAuthBypass — the catch-site contract', () => {
  it('opens the dialog for the REPORTED pull error and returns true', () => {
    const retry = vi.fn();
    const offered = offerAuthBypass(new Error(REPORTED), { repoPath: '/test/repo', retry });
    expect(offered).toBe(true);
    expect(useAuthBypassStore.getState().ctx?.failure.kind).toBe('no-credentials');
    expect(useAuthBypassStore.getState().ctx?.failure.host).toBe('git.nbgi.cloud.rt-dc.ru');
    useAuthBypassStore.getState().close();
  });

  it('returns false for non-auth errors — the caller keeps its toast', () => {
    expect(
      offerAuthBypass(new Error('fatal: unable to access: SSL certificate problem: certificate has expired'), {
        repoPath: '/x',
      })
    ).toBe(false);
    expect(offerAuthBypass(new Error('Connection timed out'), { repoPath: '/x' })).toBe(false);
    expect(offerAuthBypass(new Error('remote: error: GH006: Protected branch update failed.'), { repoPath: '/x' })).toBe(false);
    expect(useAuthBypassStore.getState().ctx).toBeNull();
  });
});
