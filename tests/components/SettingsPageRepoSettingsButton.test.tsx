import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../../src/pages/SettingsPage';

// Minimal store mocks: SettingsPage is a large page; here we only verify the
// "Repository Settings..." header button (visibility + event dispatch).
const toastMock = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn(), show: vi.fn(), dismiss: vi.fn() };

vi.mock('../../src/stores/toastStore', () => ({
  useToastStore: () => toastMock,
  useToastActions: () => toastMock,
}));

const settingsMock = {
  settings: {},
  theme: 'dark' as const,
  setSetting: vi.fn().mockResolvedValue(undefined),
  toggleTheme: vi.fn(),
};
vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: () => settingsMock,
}));

const authMock = {
  user: null,
  authenticated: false,
  loginWithPAT: vi.fn(),
  logout: vi.fn(),
  loadAuthState: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../src/stores/authStore', () => ({ useAuthStore: () => authMock }));

let currentRepo: { path: string; name: string } | null = null;
const repoState = {
  get currentRepo() { return currentRepo; },
  repos: [] as Array<{ path: string; name: string }>,
  removeRepo: vi.fn(),
  loadRepos: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../src/stores/repositoryStore', () => ({
  // Support both selector and whole-store usage in SettingsPage
  useRepositoryStore: (sel?: (s: typeof repoState) => unknown) =>
    sel ? sel(repoState as typeof repoState) : repoState,
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    fs: { openDirectoryPicker: vi.fn().mockResolvedValue(null) },
    git: { configList: vi.fn().mockResolvedValue([]) },
    // VS Code integration surface used by SettingsPage effects/handlers
    vscode: {
      detect: vi.fn().mockResolvedValue({ available: false, source: 'none', path: '', version: '' }),
      diffToolStatus: vi.fn().mockResolvedValue({ diffTool: '', mergeTool: '', vscodeConfigured: false }),
      open: vi.fn().mockResolvedValue({ ok: true, via: 'none' }),
      openFileDiff: vi.fn().mockResolvedValue({ ok: true }),
      openMerge: vi.fn().mockResolvedValue({ ok: true }),
      installDiffTool: vi.fn().mockResolvedValue({ ok: true }),
      removeDiffTool: vi.fn().mockResolvedValue({ ok: true }),
    },
  },
}));

// Mock i18n — same English dictionary + interpolation as the real t(), so
// localized labels still render the expected visible English text.
vi.mock('../../src/lib/i18n', async () => {
  const { en } = await import('../../src/i18n/locales');
  return {
    useI18n: () => ({
      t: (key: string, params?: Record<string, string | number>): string => {
        let str = en[key] ?? key;
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
    LOCALES: [{ id: 'en' as const, label: 'English', flag: '🇬🇧' }],
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>
  );
}

describe('SettingsPage — Repository Settings header button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRepo = null;
  });

  it('is visible when a repository is open and dispatches the shared repo-settings event', () => {
    currentRepo = { path: '/test/repo', name: 'test-repo' };
    const listener = vi.fn();
    window.addEventListener('prismgit:repo-settings', listener);

    renderPage();
    const btn = screen.getByRole('button', { name: /Repository Settings/i });
    fireEvent.click(btn);

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('prismgit:repo-settings', listener);
  });

  it('is hidden when no repository is open', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /Repository Settings/i })).toBeNull();
  });
});
