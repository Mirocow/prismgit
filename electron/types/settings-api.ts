export interface RepositoryEntry {
  path: string;
  name: string;
  lastOpened: number;
  pinned?: boolean;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  fontSize: number;
  sidebarWidth: number;
  defaultCloneDir: string;
  showReflogInHistory: boolean;
  maxHistoryLoad: number;
  enableTelemetry: boolean;
  githubPAT?: string;
}

export interface SettingsApi {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  getAll: () => Promise<Partial<AppSettings>>;
  getRepos: () => Promise<RepositoryEntry[]>;
  addRepo: (repo: { path: string; name: string }) => Promise<void>;
  removeRepo: (path: string) => Promise<void>;
  updateRepo: (path: string, updates: Record<string, unknown>) => Promise<void>;
}
