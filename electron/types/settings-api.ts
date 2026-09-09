export interface RepositoryEntry {
  path: string;
  name: string;
  lastOpened: number;
  pinned?: boolean;
}

export interface RepositoryMetadata {
  path: string;
  name: string;
  description?: string;
  tags: string[];
  notes?: string;
  favorite: boolean;
  color?: string;
  customIcon?: string;
  lastOpened: number;
  createdAt: number;
  updatedAt: number;
  // Auto-collected metadata
  lastCommitHash?: string;
  lastCommitDate?: string;
  lastCommitMessage?: string;
  branchCount?: number;
  commitCount?: number;
  remoteUrl?: string;
  provider?: 'github' | 'gitlab' | 'bitbucket' | 'unknown';
  owner?: string;
  repo?: string;
  webUrl?: string;
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
  pullStrategy: 'merge' | 'rebase';
}

export interface SettingsApi {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
  getAll: () => Promise<Partial<AppSettings>>;
  getRepos: () => Promise<RepositoryEntry[]>;
  addRepo: (repo: { path: string; name: string }) => Promise<void>;
  removeRepo: (path: string) => Promise<void>;
  updateRepo: (path: string, updates: Record<string, unknown>) => Promise<void>;

  // Repository metadata
  getRepoMetadata: (path: string) => Promise<RepositoryMetadata | null>;
  getRepoMetadataAll: () => Promise<RepositoryMetadata[]>;
  setRepoMetadata: (path: string, metadata: Partial<RepositoryMetadata>) => Promise<void>;
  updateRepoMetadata: (path: string, updates: Partial<RepositoryMetadata>) => Promise<void>;
  deleteRepoMetadata: (path: string) => Promise<void>;
  toggleFavorite: (path: string) => Promise<void>;
  addTag: (path: string, tag: string) => Promise<void>;
  removeTag: (path: string, tag: string) => Promise<void>;
  refreshRepoStats: (path: string) => Promise<Partial<RepositoryMetadata>>;
}
