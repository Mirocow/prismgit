import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/api', () => ({
  api: {
    settings: {
      getAll: vi.fn(),
      set: vi.fn(),
    },
  },
}));

import { api } from '../../src/lib/api';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.setState({
      settings: {},
      theme: 'dark',
      loading: false,
    });
  });

  describe('loadSettings', () => {
    it('loads settings from API', async () => {
      vi.mocked(api.settings.getAll).mockResolvedValue({
        theme: 'light',
        fontSize: 16,
        sidebarWidth: 300,
      });

      await useSettingsStore.getState().loadSettings();

      const state = useSettingsStore.getState();
      expect(state.settings.fontSize).toBe(16);
      expect(state.settings.sidebarWidth).toBe(300);
      expect(state.theme).toBe('light');
    });

    it('defaults to dark theme', async () => {
      vi.mocked(api.settings.getAll).mockResolvedValue({});

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().theme).toBe('dark');
    });

    it('handles errors gracefully', async () => {
      vi.mocked(api.settings.getAll).mockRejectedValue(new Error('Failed'));

      await useSettingsStore.getState().loadSettings();

      expect(useSettingsStore.getState().loading).toBe(false);
    });
  });

  describe('setSetting', () => {
    it('updates setting via API and store', async () => {
      vi.mocked(api.settings.set).mockResolvedValue(undefined);

      await useSettingsStore.getState().setSetting('fontSize', 18);

      const state = useSettingsStore.getState();
      expect(state.settings.fontSize).toBe(18);
      expect(api.settings.set).toHaveBeenCalledWith('fontSize', 18);
    });

    it('updates theme when setting theme', async () => {
      vi.mocked(api.settings.set).mockResolvedValue(undefined);

      await useSettingsStore.getState().setSetting('theme', 'light');

      expect(useSettingsStore.getState().theme).toBe('light');
    });
  });

  describe('toggleTheme', () => {
    it('switches from dark to light', async () => {
      vi.mocked(api.settings.set).mockResolvedValue(undefined);
      useSettingsStore.setState({ theme: 'dark' });

      await useSettingsStore.getState().toggleTheme();

      expect(useSettingsStore.getState().theme).toBe('light');
    });

    it('switches from light to dark', async () => {
      vi.mocked(api.settings.set).mockResolvedValue(undefined);
      useSettingsStore.setState({ theme: 'light' });

      await useSettingsStore.getState().toggleTheme();

      expect(useSettingsStore.getState().theme).toBe('dark');
    });
  });

  describe('applyTheme', () => {
    it('adds dark class to documentElement', () => {
      useSettingsStore.setState({ theme: 'dark' });
      useSettingsStore.getState().applyTheme();

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    });

    it('adds light class to documentElement', () => {
      useSettingsStore.setState({ theme: 'light' });
      useSettingsStore.getState().applyTheme();

      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });
});
