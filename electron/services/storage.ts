import Store from 'electron-store';
import type { AppSettings, RepositoryEntry } from '../types/settings-api.js';

interface StoreSchema {
  settings: Partial<AppSettings>;
  repositories: RepositoryEntry[];
}

const store = new Store<StoreSchema>({
  name: 'smartgit-settings',
  defaults: {
    settings: {
      theme: 'dark',
      fontSize: 14,
      sidebarWidth: 280,
      defaultCloneDir: '',
      showReflogInHistory: false,
      maxHistoryLoad: 500,
      enableTelemetry: false,
    },
    repositories: [],
  },
});

export function getSetting<T = unknown>(key: string): T | undefined {
  return store.get('settings')[key as keyof AppSettings] as T | undefined;
}

export function setSetting(key: string, value: unknown): void {
  const settings = store.get('settings');
  (settings as Record<string, unknown>)[key] = value;
  store.set('settings', settings);
}

export function getAllSettings(): Partial<AppSettings> {
  return store.get('settings');
}

export function getRepos(): RepositoryEntry[] {
  return store.get('repositories');
}

export function addRepo(repo: { path: string; name: string }): void {
  const repos = store.get('repositories');
  const existing = repos.findIndex((r) => r.path === repo.path);
  const entry: RepositoryEntry = {
    path: repo.path,
    name: repo.name,
    lastOpened: Date.now(),
  };
  if (existing >= 0) {
    repos[existing] = entry;
  } else {
    repos.push(entry);
  }
  store.set('repositories', repos);
}

export function removeRepo(path: string): void {
  const repos = store.get('repositories').filter((r) => r.path !== path);
  store.set('repositories', repos);
}

export function updateRepo(path: string, updates: Record<string, unknown>): void {
  const repos = store.get('repositories');
  const idx = repos.findIndex((r) => r.path === path);
  if (idx >= 0) {
    repos[idx] = { ...repos[idx], ...updates, lastOpened: Date.now() };
    store.set('repositories', repos);
  }
}

export function touchRepo(path: string): void {
  updateRepo(path, {});
}
