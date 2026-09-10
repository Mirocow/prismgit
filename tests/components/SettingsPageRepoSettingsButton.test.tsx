import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from '../../src/pages/SettingsPage';

// Minimal store mocks: SettingsPage is a large page; here we only verify the
// "Repository Settings..." header button (visibility + event dispatch).
const toastMock = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() };

vi.mock('../../src/stores/toastStore', () => ({ useToastStore: () => toastMock }));

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
  },
}));

// Mock i18n — SettingsPage imports useI18n
vi.mock('../../src/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
  LOCALES: [{ id: 'en', label: 'English', flag: '🇬🇧' }],
}));

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
