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
  /**
   * UI theme id. Stored as a string; validated at runtime against the registry
   * in src/lib/themes.ts. Old installs may have 'light' / 'dark' / 'system'
   * — these are still accepted (light/dark map to default Ayu themes).
   * New values: 'github-light', 'github-dark', 'dracula', 'monokai',
   * 'solarized-light', 'solarized-dark', 'nord', 'tokyo-night',
   * 'catppuccin-mocha', 'one-dark', 'gruvbox-dark'.
   */
  theme: string;
  fontSize: number;          // Global base font size
  fontSizeTree: number;      // File tree / directory tree font size
  fontSizeList: number;      // Commit lists, branch lists, tag lists
  fontSizeDiff: number;      // Diff viewer (code)
  fontSizeMonospace: number; // Monospace elements (hashes, paths)
  sidebarWidth: number;
  /**
   * Sidebar visual mode — Discord/Slack-style dim sidebar.
   */
  sidebarMode?: 'default' | 'dim' | 'light';
  /**
   * Settings redesign — UI density: Compact (less padding, IDE feel)
   * or Comfortable (default, more breathing room). Affects list rows
   * and toolbars. Compact = py-0.5 → py-1; Comfortable = py-1.5.
   */
  uiDensity?: 'compact' | 'comfortable';
  /**
   * Settings redesign — date format: Relative (e.g. "5m ago"),
   * Absolute (e.g. "2024-09-12"), or Both (relative + tooltip).
   */
  dateFormat?: 'relative' | 'absolute' | 'both';
  /**
   * Settings redesign — zoom level (60-240%). Stored as integer
   * percentage. Maps to document.documentElement.style.zoom.
   * Keyboard shortcuts: Ctrl+= / Ctrl+- / Ctrl+0.
   */
  zoomLevel?: number;
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
  /**
   * Task 18 — VSCode-style footer display settings. Each key toggles
   * a StatusBar footer section. Missing keys default to visible (true).
   */
  footerVisible?: {
    head?: boolean;
    inProgress?: boolean;
    selectedCommit?: boolean;
    stagedChanged?: boolean;
    aheadBehind?: boolean;
    recyclable?: boolean;
    stashes?: boolean;
    submodules?: boolean;
    lfs?: boolean;
    updatedAt?: boolean;
    outputToggle?: boolean;
  };
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
  /** Custom VS Code CLI path (auto-detected from platform paths / PATH when empty). */
  vscodePath?: string;
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
  /** Max AI Assistant chat messages to persist per-project (default: 100). */
  aiChatHistoryLimit?: number;
  /**
   * AI request timeout in seconds. Applied to:
   *   - commit-message generation (ai:generateCommitMessage IPC)
   *   - AI Assistant chat (ai:chat IPC proxy)
   * Default 300 (5 min). Increase for slow local models (Ollama with large
   * models running on CPU), decrease for fast cloud APIs (OpenAI/Anthropic).
   * Min 10, max 3600. Value of 0 disables the timeout (not recommended).
   */
  aiRequestTimeoutSec?: number;
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
   * Master "Auto refresh" switch (SmartGit-style). When disabled, the app
   * stops ALL automatic remote polling for the repository list — no periodic
   * fetch of every listed repository, no ↓/↑ badge updates. Manual "Check
   * now" in the sidebar still works. Default: true.
   */
  autoRefresh?: boolean;
  /**
   * Tour completion flag. When true, the first-run Tour overlay is NOT
   * auto-shown on next app launch. Persisted in the settings store (in
   * ADDITION to localStorage) so it survives localStorage wipes —
   * e.g. Tauri webview partition resets, browser devtools "Clear site data",
   * or any cache-cleaning flow that targets the renderer origin.
   * User can still re-trigger the tour via Help → Restart Tour.
   */
  tourCompleted?: boolean;
  /**
   * How often (in seconds) to poll every repository in the list: fetch all
   * remotes and compute incoming/outgoing counters. Default 120, min 30.
   * 0 disables the periodic check (manual "Check now" still works).
   */
  repoRemoteCheckIntervalSec?: number;
  /** Max number of commands shown in the Output panel (default 20). */
  commandLogLimit?: number;
  // === Per-remote authorization (Repository Settings → Remotes) ===
  /**
   * HTTP(S) credentials used for push/pull/fetch per remote.
   * Key 1 = absolute repo path, key 2 = remote name.
   * Stored in the app settings file (userData) — same store for the
   * Repository Settings dialog and the Remotes tool. Never written to
   * .git/config or the remote URL; applied per-command via http.extraHeader.
   */
  remoteAuth?: Record<string, Record<string, RemoteCredential>>;
}

/** Credentials for one remote of one repository (HTTP(S) basic auth). */
export interface RemoteCredential {
  username?: string;
  /** Password or personal access token. */
  password?: string;
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
