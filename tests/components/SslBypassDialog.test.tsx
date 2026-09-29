/**
 * SslBypassDialog — the TLS-certificate REACTION surface.
 *
 * Pins the contract:
 *  1. Renders the kind-specific explanation (host from the classified
 *     failure), the security-consequence warning and the raw git output.
 *  2. «Continue without certificate verification» writes
 *     http.sslVerify=false via configSetMany, registers the host through
 *     the dedicated addInsecureSslHost channel, RETRIES the original
 *     operation, and closes.
 *  3. A retry failure → error toast (verification is already off at that
 *     point, so re-offering the dialog would be a dead loop, not a
 *     reaction).
 *  4. No retry closure → success toast "verification disabled".
 *  5. Cancel → close, nothing written.
 *  6. http.sslVerify already 'false' → the "already disabled" note shows.
 *  7. offerSslBypass — the catch-site contract (true + dialog for a
 *     certificate error; false for anything else).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const configGetMany = vi.fn().mockResolvedValue({ 'http.sslVerify': undefined });
const configSetMany = vi.fn().mockResolvedValue(undefined);
const addInsecureSslHost = vi.fn().mockResolvedValue(undefined);
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      configGetMany: (...a: unknown[]) => configGetMany(...a),
      configSetMany: (...a: unknown[]) => configSetMany(...a),
    },
    settings: {
      addInsecureSslHost: (...a: unknown[]) => addInsecureSslHost(...a),
    },
  },
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
        'dialogs.ssl.title': 'SSL certificate problem',
        'dialogs.ssl.body.expired': 'The TLS certificate of {host} has EXPIRED — the server operator must renew it.',
        'dialogs.ssl.body.selfSigned': 'The server {host} uses a self-signed certificate.',
        'dialogs.ssl.hostLabel': 'Server:',
        'dialogs.ssl.warning': 'Continuing disables certificate verification ONLY for this repository.',
        'dialogs.ssl.alreadyOff': 'Certificate verification is already disabled for this repository.',
        'dialogs.ssl.apply': 'Continue without certificate verification',
        'dialogs.ssl.applyHint': 'Writes http.sslVerify=false and retries',
        'dialogs.ssl.bypassApplied': 'Certificate verification disabled for this repository',
        'dialogs.ssl.retryFailed': 'Retry failed',
        'dialogs.pushRejection.rawLabel': 'git output:',
        'common.cancel': 'Cancel',
      };
      let s = dict[k] ?? k;
      if (p) for (const [key, v] of Object.entries(p)) s = s.replace(`{${key}}`, String(v));
      return s;
    },
  }),
}));

import { SslBypassDialog } from '../../src/components/SslBypassDialog';
import { useSslBypassStore, offerSslBypass } from '../../src/stores/sslBypassStore';

const EXPIRED = `fatal: unable to access 'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git/': SSL certificate problem: certificate has expired`;

function openDialog(extra: Record<string, unknown> = {}) {
  useSslBypassStore.getState().open({
    repoPath: '/test/repo',
    failure: {
      kind: 'expired',
      host: 'git.nbgi.cloud.rt-dc.ru',
      url: 'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git/',
      message: EXPIRED,
    },
    ...extra,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSslBypassStore.getState().close();
  configGetMany.mockResolvedValue({ 'http.sslVerify': undefined });
});

afterEach(() => {
  useSslBypassStore.getState().close();
});

describe('SslBypassDialog — rendering', () => {
  it('shows the kind-specific explanation, host chip, warning and raw output', async () => {
    openDialog();
    render(<SslBypassDialog />);
    expect(screen.getByText('SSL certificate problem')).toBeTruthy();
    expect(screen.getByText(/The TLS certificate of git\.nbgi\.cloud\.rt-dc\.ru has EXPIRED/)).toBeTruthy();
    expect(screen.getByText('git.nbgi.cloud.rt-dc.ru')).toBeTruthy();
    expect(screen.getByText('Server:')).toBeTruthy();
    expect(screen.getByText(/disables certificate verification ONLY/)).toBeTruthy();
    expect(screen.getByText('git output:')).toBeTruthy();
    expect(screen.getByText('Continue without certificate verification')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    // Reads the current repo verification state on open.
    await waitFor(() => expect(configGetMany).toHaveBeenCalledWith('/test/repo', ['http.sslVerify']));
  });

  it('shows the "already disabled" note when http.sslVerify is false', async () => {
    configGetMany.mockResolvedValue({ 'http.sslVerify': 'false' });
    openDialog();
    render(<SslBypassDialog />);
    await waitFor(() =>
      expect(screen.getByText('Certificate verification is already disabled for this repository.')).toBeTruthy(),
    );
  });

  it('renders nothing while the store is closed', () => {
    render(<SslBypassDialog />);
    expect(screen.queryByText('SSL certificate problem')).toBeNull();
  });
});

describe('SslBypassDialog — «Continue without certificate verification»', () => {
  it('writes http.sslVerify=false, registers the host, retries and closes', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    openDialog({ retry });
    render(<SslBypassDialog />);
    fireEvent.click(screen.getByText('Continue without certificate verification'));
    await waitFor(() => {
      expect(configSetMany).toHaveBeenCalledWith('/test/repo', [{ key: 'http.sslVerify', value: 'false' }]);
      expect(addInsecureSslHost).toHaveBeenCalledWith('git.nbgi.cloud.rt-dc.ru');
      expect(retry).toHaveBeenCalledTimes(1);
    });
    // Retry handled its own success toast — the dialog adds nothing.
    expect(toastSuccess).not.toHaveBeenCalledWith('Certificate verification disabled for this repository');
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });

  it('a FAILED retry → error toast, dialog closes (no re-offer loop)', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('Connection refused'));
    openDialog({ retry });
    render(<SslBypassDialog />);
    fireEvent.click(screen.getByText('Continue without certificate verification'));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Retry failed', expect.stringContaining('Connection refused'));
    });
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });

  it('without a retry closure → bypass toast (the GitFlow case)', async () => {
    openDialog(); // no retry — the finish flow is not idempotent
    render(<SslBypassDialog />);
    fireEvent.click(screen.getByText('Continue without certificate verification'));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Certificate verification disabled for this repository'));
    expect(configSetMany).toHaveBeenCalledTimes(1);
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });

  it('host registration failure is non-fatal — the git bypass still applies', async () => {
    addInsecureSslHost.mockRejectedValueOnce(new Error('ipc gone'));
    const retry = vi.fn().mockResolvedValue(undefined);
    openDialog({ retry });
    render(<SslBypassDialog />);
    fireEvent.click(screen.getByText('Continue without certificate verification'));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });
});

describe('SslBypassDialog — CLONE mode (skipConfigWrite — the repo does not exist yet)', () => {
  it('skips the config probe AND the config write; registers the host and retries', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    openDialog({ skipConfigWrite: true, retry });
    render(<SslBypassDialog />);
    // No alreadyOff probe — configGetMany would fail on a non-existent repo.
    expect(configGetMany).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Continue without certificate verification'));
    await waitFor(() => {
      // The retried clone carries -c http.sslVerify=false itself — the
      // dialog must NOT write a config into a repo that isn't there yet.
      expect(configSetMany).not.toHaveBeenCalled();
      expect(addInsecureSslHost).toHaveBeenCalledWith('git.nbgi.cloud.rt-dc.ru');
      expect(retry).toHaveBeenCalledTimes(1);
    });
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });

  it('a failed clone retry → error toast (same as the repo case)', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('repository exists'));
    openDialog({ skipConfigWrite: true, retry });
    render(<SslBypassDialog />);
    fireEvent.click(screen.getByText('Continue without certificate verification'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Retry failed', expect.stringContaining('repository exists')));
    expect(configSetMany).not.toHaveBeenCalled();
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });
});

describe('SslBypassDialog — Cancel', () => {
  it('closes without writing anything', () => {
    openDialog();
    render(<SslBypassDialog />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(configSetMany).not.toHaveBeenCalled();
    expect(addInsecureSslHost).not.toHaveBeenCalled();
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });
});

describe('offerSslBypass — the catch-site contract', () => {
  it('opens the dialog for the REPORTED pull error and returns true', () => {
    const retry = vi.fn();
    const offered = offerSslBypass(new Error(EXPIRED), { repoPath: '/test/repo', retry });
    expect(offered).toBe(true);
    expect(useSslBypassStore.getState().ctx?.failure.kind).toBe('expired');
    expect(useSslBypassStore.getState().ctx?.failure.host).toBe('git.nbgi.cloud.rt-dc.ru');
    useSslBypassStore.getState().close();
  });

  it('returns false for non-certificate errors — the caller keeps its toast', () => {
    expect(offerSslBypass(new Error('fatal: unable to access: Failed to connect'), { repoPath: '/x' })).toBe(false);
    expect(offerSslBypass(new Error('remote: HTTP Basic: Access denied'), { repoPath: '/x' })).toBe(false);
    expect(useSslBypassStore.getState().ctx).toBeNull();
  });
});
