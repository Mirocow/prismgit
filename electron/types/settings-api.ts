export interface RepositoryEntry {
  path: string;
  name: string;
  lastOpened: number;
  pinned?: boolean;
  /** Repository group (folder) this repo belongs to; null/undefined = root level. */
  groupId?: string | null;
}

/**
 * A user-defined group (folder) in the repository list, forming a tree via
 * parentId. Repositories reference groups by `RepositoryEntry.groupId`.
 */
export interface RepoGroup {
  id: string;
  name: string;
  /** Parent group id, or null for a top-level group. */
  parentId: string | null;
  /** Persisted UI expand/collapse state. */
  expanded?: boolean;
  /** Stable creation order used for sorting siblings. */
  order: number;
  createdAt: number;
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
  fontSize: number;          // Global base font size
  fontSizeTree: number;      // File tree / directory tree font size
  fontSizeList: number;      // Commit lists, branch lists, tag lists
  fontSizeDiff: number;      // Diff viewer (code)
  fontSizeMonospace: number; // Monospace elements (hashes, paths)
  sidebarWidth: number;
  /**
   * UI contrast level — 100 = default, lower = softer, higher = punchier.
   * Range 50–150. Applied as `filter: contrast(N%)` on the root element via
   * a CSS variable. Useful for low-vision users or for high-glare environments.
   */
  contrast: number;
  defaultCloneDir: string;
  showReflogInHistory: boolean;
  maxHistoryLoad: number;
  enableTelemetry: boolean;
  githubPAT?: string;
  pullStrategy: 'merge' | 'rebase';
  /**
   * SmartGit-style "Perform background Poll or Fetch" — per repo, the list of
   * remote names that should be fetched quietly in the background on an
   * interval while the repository is open. Key = absolute repo path.
   */
  backgroundFetchRemotes?: Record<string, string[]>;
  // === SmartGit Manual: Preferences → Commands ===
  /** Allow modifying pushed commits (e.g. amend, squash, rebase) without blocking. */
  allowModifyingPushedCommits?: boolean;
  /** Detect renames in refresh (pair added + deleted files). */
  detectRenames?: boolean;
  /** Distinguish between content changes and EOL-only changes. */
  distinguishEolChanges?: boolean;
  /** Auto-stash local changes before merge/rebase/pull, then pop after. */
  autoStashOnCommonCommands?: boolean;
  /** Include untracked files when stashing (-u flag). */
  includeUntrackedInStash?: boolean;
  // === SmartGit Manual: External Tools ===
  /** git config diff.tool value (e.g., "vscode-diff"). */
  diffTool?: string;
  /** git config merge.tool value (e.g., "vscode-merge"). */
  mergeTool?: string;
  // === SmartGit Manual: Low-Level Properties ===
  /** Contents of smartgit.properties file (UTF-8, key=value, # for comments). */
  lowLevelProperties?: string;
  // === SmartGit Manual: AI Commit Messages ===
  /** Enable AI commit message generation in Changes view. */
  aiCommitMessagesEnabled?: boolean;
  /** LLM provider id (e.g., "openai", "anthropic", "ollama"). */
  aiProvider?: string;
  /** API key for the LLM provider. */
  aiApiKey?: string;
  /** Model name (e.g., "gpt-4o-mini", "claude-3-5-sonnet", "llama3.2"). */
  aiModel?: string;
  /** Provider URL (for Ollama: http://localhost:11434). */
  aiUrl?: string;
  /** Custom AI system prompt template with {{branch}}, {{author}}, etc. */
  aiCustomPrompt?: string;
  // === SmartGit Manual v25/26: Force Push policies ===
  /** Force-push policy: 'deny' | 'feature-only' | 'allow'. */
  forcePushPolicy?: 'deny' | 'feature-only' | 'allow';
  /** Branches protected from force-push (glob patterns). */
  protectedBranches?: string[];
  // === CI/CD integration ===
  /** Jenkins URL for CI status badges. */
  jenkinsUrl?: string;
  /** Jenkins API token (user:token). */
  jenkinsToken?: string;
  /** TeamCity URL for CI status badges. */
  teamcityUrl?: string;
  /** TeamCity access token. */
  teamcityToken?: string;
  /** GitLab URL for CI status (default https://gitlab.com). */
  gitlabUrl?: string;
  /** GitLab personal access token. */
  gitlabToken?: string;
  /** GitLab project ID (numeric). */
  gitlabProjectId?: number;
  // === Repository list: periodic remote check ===
  /**
   * How often (in seconds) to poll every repository in the list: fetch all
   * remotes and compute incoming/outgoing counters. Default 120, min 30.
   * 0 disables the periodic check (manual "Check now" still works).
   */
  repoRemoteCheckIntervalSec?: number;
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

  // Repository groups (tree in the sidebar)
  getRepoGroups: () => Promise<RepoGroup[]>;
  createRepoGroup: (name: string, parentId?: string | null) => Promise<RepoGroup>;
  renameRepoGroup: (id: string, name: string) => Promise<void>;
  deleteRepoGroup: (id: string) => Promise<void>;
  /** Move a group under a new parent (null = root). Rejects cycles. */
  moveRepoGroup: (id: string, newParentId: string | null) => Promise<void>;
  setRepoGroupExpanded: (id: string, expanded: boolean) => Promise<void>;
  /** Assign a repository to a group (null = ungrouped / root level). */
  setRepoGroup: (repoPath: string, groupId: string | null) => Promise<void>;
}
