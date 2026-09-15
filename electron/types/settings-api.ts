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

/**
 * One configured AI provider instance — the unit of the multi-provider
 * registry (settings.aiProviders). Unlike the legacy per-preset config
 * (one slot per preset id), entries are UNLIMITED: the user can register
 * any number of Ollama servers (e.g. home GPU box + work workstation) and
 * OpenAI-compatible endpoints (OpenAI, Groq, OpenRouter, vLLM, LM Studio,
 * corporate gateways...), each with its own URL, key and model.
 */
export interface AiProviderEntry {
  /** Stable unique id ("prov-<random>"), referenced by aiActiveProviderId. */
  id: string;
  /**
   * Protocol/preset flavor — an LLMProvider type id ('ollama',
   * 'openai-compatible', 'anthropic', 'openai', 'groq', ...). Determines
   * which API protocol the caller uses and which icon/label the UI shows.
   */
  kind: string;
  /** User-editable display name ("Home Ollama", "Groq free", ...). */
  name: string;
  /** Base URL (Ollama: http://host:11434; OpenAI-compatible: .../v1). */
  url: string;
  /** API key — vault-backed placeholder on disk (see credentialKeys.ts). */
  apiKey?: string;
  /** Default model for this provider ("llama3.2", "gpt-4o-mini", ...). */
  model: string;
  /** Soft switch — disabled entries stay configured but are not offered. */
  enabled: boolean;
  /** Creation timestamp (epoch ms) — used to sort the grid. */
  createdAt?: number;
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
  /**
   * 4.2 — SmartGit "Automatically select light/dark". When 'auto', the
   * effective theme follows the OS `prefers-color-scheme`: the light/dark
   * PAIR of the saved `theme` family is picked on system changes (fallback
   * DEFAULT_THEME / 'dark' for families without a pair). 'manual' keeps
   * the explicit `theme`. Default: 'manual'.
   */
  themeMode?: 'manual' | 'auto';
  fontSize: number;          // Global base font size
  fontSizeTree: number;      // File tree / directory tree font size
  fontSizeList: number;      // Commit lists, branch lists, tag lists
  fontSizeDiff: number;      // Diff viewer (code)
  fontSizeMonospace: number; // Monospace elements (hashes, paths)
  /**
   * Left bar (Sidebar) font size in px — controls the sidebar's PRIMARY
   * text (navigation items, repo switcher). Secondary text inside the
   * sidebar (repo tree rows, badges, counts) follows at −1.5px. When
   * unset the sidebar keeps its default rem-based sizing (zero change).
   * Range 10–18. Applied live via --font-size-sidebar CSS variables.
   */
  fontSizeSidebar?: number;
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
  /**
   * Default commit author (Settings → Git → "Default commit author").
   * Written into a NEW repository's local user.name/user.email config
   * right after git init / git clone, and used as a -c fallback when a
   * commit fails with "Please tell me who you are". Empty → not applied.
   */
  gitUserName?: string;
  gitUserEmail?: string;
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
  // === SmartGit Manual: Preferences → Commands → Commit message handling ===
  /**
   * How to handle lines that look like comments (start with core.commentChar)
   * in the commit message. 'as-is' — commit untouched; 'ask' — confirm before
   * stripping; 'strip' — always remove such lines. Default 'ask' (SmartGit).
   */
  commitCommentsMode?: 'as-is' | 'ask' | 'strip';
  /**
   * What to commit when NOTHING is staged but the working tree has changes:
   * 'ask' — show the 3-button dialog; 'all-except-untracked' — git add -u;
   * 'all-including-untracked' — git add -A. Default 'ask' (SmartGit).
   */
  commitNothingStaged?: 'ask' | 'all-except-untracked' | 'all-including-untracked';
  /** Suggest "Add untracked files" banner in the commit panel (default false). */
  commitSuggestAddUntracked?: boolean;
  /** Suggest "Stage deletions of missing files" banner (default true). */
  commitSuggestRemoveMissing?: boolean;
  /** Commit-message line length guides (SmartGit 50/72). Default 'none'. */
  commitLineGuides?: 'none' | '50' | '72' | '50+72';
  // === SmartGit Manual: Preferences → Commands (phase 2) ===
  /**
   * Warn before checkout when the target branch changes .gitmodules
   * (submodule URLs/paths differ). Default true (SmartGit behavior).
   */
  warnSubmoduleChangesOnCheckout?: boolean;
  /**
   * Show a one-time toast when working-tree rename detection is slow
   * (threshold: low-level `renames.warnMs`, default 3000). Suggests
   * disabling "Detect renames". Default true.
   */
  warnSlowRenameDetection?: boolean;
  // === SmartGit Manual: Preferences → User Interface → Confirmation dialogs (4.5) ===
  /**
   * Confirmation registry — per dialog id: 'ask' | 'always' | 'never'.
   * When the user checks "Don't ask again" in a confirmation:
   *   Confirm  → 'always' (the dialog never shows again, auto-confirm)
   *   Cancel   → 'never'  (the action is silently skipped)
   * Settings → Appearance → "Restore all confirmation dialogs" clears the
   * map so every dialog asks again. Ids live in src/lib/confirmations.ts.
   */
  confirmations?: Record<string, 'ask' | 'always' | 'never'>;
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
  /**
   * Multi-provider registry — an UNLIMITED list of configured AI providers
   * (several Ollama servers on different hosts, multiple OpenAI-compatible
   * endpoints, cloud presets, ...). Replaces the old "one config per preset
   * id" aiProviderConfigs model while keeping it in sync (see mirror logic
   * in src/lib/aiProviders.ts).
   *
   * The active entry is referenced by aiActiveProviderId; its url/apiKey/
   * model are mirrored into the legacy flat aiUrl/aiApiKey/aiModel fields
   * so every existing reader (ChangesPage, AiChatPage, AiAssistant)
   * keeps working unchanged.
   *
   * NOTE: apiKey values are vault-backed — on disk each entry stores only
   * an empty placeholder; the real key lives in the encrypted vault under
   * ns 'ai', key 'provider:<entryId>' (see credentialKeys.ts).
   */
  aiProviders?: AiProviderEntry[];
  /** Id of the currently active entry in aiProviders (empty/undefined = none). */
  aiActiveProviderId?: string;
  /**
   * @deprecated Legacy per-preset config (one slot per preset id). Kept in
   * sync for backward compatibility; new code should read aiProviders.
   */
  aiProviderConfigs?: Record<string, { url?: string; apiKey?: string; model?: string }>;
  /** Custom AI system prompt template with {{branch}}, {{author}}, etc. */
  aiCustomPrompt?: string;
  /** Max AI Assistant chat messages to persist per-project (default: 100). */
  aiChatHistoryLimit?: number;
  /**
   * AI context compression threshold in CHARACTERS (not messages).
   * When the total character count of prior conversation history exceeds
   * this limit, old messages are compressed into a text summary. This is
   * more accurate than a message-count limit — a single get_status result
   * with 500 lines takes more context than 10 short chat messages.
   * Default: 20,000 chars (~5,000 tokens). User-configurable via
   * Settings → AI → Context Size.
   */
  aiContextMaxChars?: number;
  /**
   * AI tool limits — control how much data the AI tools return, keeping
   * the conversation context manageable. All configurable via Settings → AI.
   *
   * Default values are tuned for a balance between usefulness and context
   * size. Increase for deep analysis, decrease for speed.
   */
  /** Max commits returned by get_log verbose mode (default: 50). */
  aiMaxLogCount?: number;
  /** Max files shown in get_status summary preview (default: 10). */
  aiMaxStatusPreview?: number;
  /** Max files shown in get_diff --stat output (default: 50). */
  aiMaxDiffFiles?: number;
  /** Max commits shown in get_log collapsed mode summary (default: 5). */
  aiLogSummaryCount?: number;
  /** Max diff size in bytes for AI commit message generation (default: 131072 = 128KB). */
  aiMaxDiffSizeBytes?: number;
  /** Max tokens for AI commit message response (default: 256). */
  aiMaxTokensCommit?: number;
  /** Max tokens for AI Assistant chat response (default: 1024). */
  aiMaxTokensChat?: number;
  /** Max tool-use iterations in runWithTools (default: 5). */
  aiMaxToolIterations?: number;
  /** Diff truncation limit in characters (default: 48000). */
  aiDiffTruncateChars?: number;
  /**
   * AI Guard — control which destructive actions the AI is allowed to perform.
   * When a guard is 'deny', the tool refuses to execute and returns a message
   * telling the AI to ask the user to do it manually.
   */
  aiGuard?: {
    /** Allow discard_changes (git reset --hard + clean). Default: 'confirm'. */
    discard?: 'allow' | 'confirm' | 'deny';
    /** Allow sync_with_remote (reset --hard origin). Default: 'confirm'. */
    syncWithRemote?: 'allow' | 'confirm' | 'deny';
    /** Allow push with --force. Default: 'confirm'. */
    forcePush?: 'allow' | 'confirm' | 'deny';
    /** Allow commit --amend. Default: 'allow'. */
    amend?: 'allow' | 'confirm' | 'deny';
    /** Allow clean (delete untracked files). Default: 'confirm'. */
    clean?: 'allow' | 'confirm' | 'deny';
    /** Allow stash drop. Default: 'confirm'. */
    stashDrop?: 'allow' | 'confirm' | 'deny';
  };
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
   * SECURITY: passwords/tokens are stored in the ENCRYPTED vault
   * (secrets.ts / OS keychain via Electron safeStorage) — this JSON only
   * keeps usernames. Read paths rehydrate from the vault transparently.
   */
  remoteAuth?: Record<string, Record<string, RemoteCredential>>;
  // === SSH support (Settings → Security → SSH keys) ===
  /** Managed SSH keys — METADATA only; passphrases live in the encrypted vault. */
  sshKeys?: import('./ssh-api.js').SshKeyMeta[];
  /** Key used when a repo has no per-repo override. undefined → system ssh config. */
  sshDefaultKeyId?: string;
  /** Per-repository SSH key override: absolute repo path → SshKeyMeta.id. */
  sshRepoKeys?: Record<string, string>;
  /**
   * Strict host key checking for SSH remotes. false (default) →
   * StrictHostKeyChecking=accept-new (first connect trusts, mismatches fail);
   * true → StrictHostKeyChecking=yes (unknown hosts are rejected outright).
   */
  sshStrictHostKeyChecking?: boolean;
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
