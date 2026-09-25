/**
 * Component tests — RepoSettingsDialog must load through ONE batched
 * configGetMany call (the 19-parallel-configGet burst is what made the
 * dialog read as "the app froze on open") and must never leave the busy
 * spinner stuck when the backend fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RepoSettingsDialog } from '../../src/components/RepoSettingsDialog';

const toastMock = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn(), dismiss: vi.fn() };

vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => toastMock,
  useToastActions: () => toastMock,
}));

vi.mock('../../src/stores/repositoryStore', () => ({
  useRepositoryStore: (sel: (s: { currentRepo: { path: string; name: string } }) => unknown) =>
    sel({ currentRepo: { path: '/tmp/repo-x', name: 'repo-x' } }),
}));

vi.mock('../../src/lib/i18n', async () => {
  const { en } = await import('../../src/i18n/locales');
  return {
    useI18n: () => ({
      t: (key: string, params?: Record<string, string | number>): string => {
        let str: string = (en as Record<string, string>)[key] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
          }
        }
        return str;
      },
      locale: 'en' as const,
      setLocale: vi.fn(),
    }),
  };
});

const configGetMany = vi.fn();
const configSetMany = vi.fn();
const configGet = vi.fn();
const configSet = vi.fn();
const configUnset = vi.fn();

vi.mock('../../src/lib/api', () => ({
  api: {
    git: {
      configGetMany: (...args: unknown[]) => configGetMany(...args),
      configSetMany: (...args: unknown[]) => configSetMany(...args),
      configGet: (...args: unknown[]) => configGet(...args),
      configSet: (...args: unknown[]) => configSet(...args),
      configUnset: (...args: unknown[]) => configUnset(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  configSetMany.mockResolvedValue(undefined);
});

describe('RepoSettingsDialog — batched load', () => {
  it('loads every key through ONE configGetMany call (no per-key configGet burst)', async () => {
    configGetMany.mockResolvedValue({
      'user.name': 'Alice',
      'user.email': 'alice@example.com',
      'pull.rebase': 'input',
      'fetch.prune': 'true',
      'gui.encoding': 'KOI8-R',
    });
    render(<RepoSettingsDialog onClose={() => {}} />);

    await waitFor(() => {
      expect((screen.getByDisplayValue('Alice') as HTMLInputElement).value).toBe('Alice');
    });
    expect(configGetMany).toHaveBeenCalledTimes(1);
    expect(configGet).not.toHaveBeenCalled();

    // the User tab is the default tab — its fields are filled from the batch
    expect((screen.getByPlaceholderText('you@example.com') as HTMLInputElement).value).toBe('alice@example.com');
    // defaults for absent keys (pull.rebase undefined → 'false') are pinned
    // by the configGetMany integration suite; here the dialog fields render.
  });

  it('a rejected backend answers defaults + toast, and the spinner never sticks', async () => {
    configGetMany.mockRejectedValue(new Error('boom'));
    render(<RepoSettingsDialog onClose={() => {}} />);

    // fields must become visible (busy cleared) even though load failed
    await waitFor(() => {
      expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy();
    });
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    // the Save button is enabled — the dialog did not freeze in busy state
    const save = screen.getByRole('button', { name: /save/i });
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('RepoSettingsDialog — batched save', () => {
  it('saves the whole dialog through ONE configSetMany call (set + unset entries)', async () => {
    configGetMany.mockResolvedValue({
      'user.name': 'Alice',
      'user.email': 'alice@example.com',
    });
    const onClose = vi.fn();
    render(<RepoSettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeTruthy());

    // clear the email → must become an UNSET entry (null), not an empty write
    const email = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(email, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(configSetMany).toHaveBeenCalledTimes(1);
    expect(configSet).not.toHaveBeenCalled();
    expect(configUnset).not.toHaveBeenCalled();

    const [repoPath, entries] = configSetMany.mock.calls[0];
    expect(repoPath).toBe('/tmp/repo-x');
    const map = Object.fromEntries((entries as { key: string; value: string | null }[]).map((e) => [e.key, e.value]));
    expect(map['user.name']).toBe('Alice');
    expect(map['user.email']).toBeNull();           // set-or-unset contract
    expect(map['pull.rebase']).toBe('false');       // plain set keeps its value
    expect(map['gui.encoding']).toBe('UTF-8');
    expect(map['submodule.recurse']).toBe('false');
    // tag-grouping empty pattern → all three keys unset
    expect(map['smartgit.tag-grouping.pattern']).toBeNull();
    expect(map['smartgit.tag-grouping.order']).toBeNull();
  });

  it('a failed save keeps the dialog open with a toast (no silent freeze)', async () => {
    configGetMany.mockResolvedValue({ 'user.name': 'Alice' });
    configSetMany.mockRejectedValue(new Error('lock'));
    const onClose = vi.fn();
    render(<RepoSettingsDialog onClose={onClose} />);
    await waitFor(() => expect(screen.getByDisplayValue('Alice')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
    // saving spinner cleared — Save is clickable again
    await waitFor(() => {
      expect((screen.getByRole('button', { name: /save/i }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
