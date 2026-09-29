import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import type { AppSettings, RepositoryEntry, RepositoryMetadata, RepoGroup } from '../types/settings-api.js';
import { SimpleStore } from './simpleStore.js';
import { runStatsJobExternal } from './gitPollProcess.js';
import {
  splitSettingSecrets,
  rehydrateSettingSecrets,
  NS_TOKENS,
  NS_AI,
  NS_REMOTE_AUTH,
  remoteAuthVaultKey,
} from './credentialKeys.js';
import { setSecret, deleteSecret, getSecret } from './secrets.js';

interface StoreSchema {
  settings: Partial<AppSettings>;
  repositories: RepositoryEntry[];
  repoMetadata: Record<string, RepositoryMetadata>;
  repoGroups: RepoGroup[];
}

const store = new SimpleStore({
  name: 'prismgit-settings',
  defaults: {
    settings: {
      // Curated default (registry DEFAULT_THEME). Legacy 'dark' values in
      // existing installs migrate to 'one-dark' on load.
      theme: 'light',
      fontSize: 14,
      sidebarWidth: 280,
      defaultCloneDir: '',
      showReflogInHistory: false,
      maxHistoryLoad: 500,
    },
    repositories: [],
    repoMetadata: {},
    repoGroups: [],
  },
});

// ============= Settings =============

/** Write one split secret (vaultKey → value) into the vault; undefined deletes. */
function applySplitSecrets(secrets: Record<string, string | undefined>): void {
  for (const [vk, value] of Object.entries(secrets)) {
    if (value === undefined) deleteSecretByVaultKey(vk);
    else setSecretByVaultKey(vk, value);
  }
}

/**
 * Route a composite vaultKey (as produced by splitSettingSecrets) to the
 * right vault namespace. Vault keys for scalars are the setting name
 * (e.g. "githubPAT" → tokens), remoteAuth keys are "<repo>|<remote>",
 * AI provider keys are "provider:<id>".
 */
function setSecretByVaultKey(vk: string, value: string): void {
  if (vk.startsWith('provider:')) {
    setSecret(NS_AI, vk, value);
  } else if (vk.includes('|')) {
    setSecret(NS_REMOTE_AUTH, vk, value);
  } else {
    setSecret(NS_TOKENS, vk, value);
  }
}

function deleteSecretByVaultKey(vk: string): void {
  if (vk.startsWith('provider:')) {
    deleteSecret(NS_AI, vk);
  } else if (vk.includes('|')) {
    deleteSecret(NS_REMOTE_AUTH, vk);
  } else {
    deleteSecret(NS_TOKENS, vk);
  }
}

/** Vault lookup for rehydration (storage key → original value). */
function lookupSecret(key: string, vk: string): string | undefined {
  if (vk.startsWith('provider:')) return getSecret(NS_AI, vk);
  if (vk.includes('|')) return getSecret(NS_REMOTE_AUTH, vk);
  if (key === 'remoteAuth') return getSecret(NS_REMOTE_AUTH, vk);
  return getSecret(NS_TOKENS, vk);
}

export function getSetting<T = unknown>(key: string): T | undefined {
  const settings = store.get('settings') as Partial<AppSettings> | undefined;
  if (!settings) return undefined;
  const raw = settings[key as keyof AppSettings] as T;
  // Secrets never live in the JSON — rehydrate from the vault so every
  // reader (git.ts, AI services, renderer) sees the original shape.
  return rehydrateSettingSecrets(key, raw, (vk) => lookupSecret(key, vk)) as T | undefined;
}

export function setSetting(key: string, value: unknown): void {
  const settings = (store.get('settings') || {}) as Partial<AppSettings>;
  const split = splitSettingSecrets(key, value);
  if (split) {
    // Secrets → encrypted vault; sanitized structure → settings JSON.
    applySplitSecrets(split.secrets);
    (settings as Record<string, unknown>)[key] = split.sanitized;
  } else {
    (settings as Record<string, unknown>)[key] = value;
  }
  store.set('settings', settings);
}

export function getAllSettings(): Partial<AppSettings> {
  const settings = (store.get('settings') || {}) as Partial<AppSettings>;
  const out: Record<string, unknown> = { ...settings };
  for (const key of Object.keys(out)) {
    out[key] = rehydrateSettingSecrets(key, out[key], (vk) => lookupSecret(key, vk));
  }
  return out as Partial<AppSettings>;
}

// ============= Legacy secret migration =============

/**
 * One-time migration: move plaintext secrets from old installs out of
 * prismgit-settings.json into the encrypted vault. Idempotent — after the
 * first run the JSON contains only placeholders, so this is a no-op.
 * Called from main.ts after app ready, BEFORE any IPC handler can read
 * settings.
 */
export function migratePlaintextSecrets(): void {
  const settings = (store.get('settings') || {}) as Record<string, unknown>;
  let changed = false;

  // 1. Scalar tokens (githubPAT, aiApiKey, jenkins/teamcity/gitlab tokens)
  for (const key of ['githubPAT', 'aiApiKey', 'jenkinsToken', 'teamcityToken', 'gitlabToken']) {
    const v = settings[key];
    if (typeof v === 'string' && v && v !== '') {
      setSecret(NS_TOKENS, key, v);
      settings[key] = '';
      changed = true;
    }
  }

  // 2. remoteAuth passwords
  const remoteAuth = settings['remoteAuth'] as
    | Record<string, Record<string, { username?: string; password?: string }>>
    | undefined;
  if (remoteAuth && typeof remoteAuth === 'object') {
    for (const [repoPath, remotes] of Object.entries(remoteAuth)) {
      if (!remotes || typeof remotes !== 'object') continue;
      for (const [remoteName, cred] of Object.entries(remotes)) {
        const password = cred?.password;
        if (typeof password === 'string' && password) {
          setSecret(NS_REMOTE_AUTH, remoteAuthVaultKey(repoPath, remoteName), password);
          const username = cred?.username?.trim() || undefined;
          remotes[remoteName] = username ? { username, password: '' } : { password: '' };
          changed = true;
        }
      }
    }
  }

  // 3. aiProviderConfigs apiKeys
  const providerConfigs = settings['aiProviderConfigs'] as
    | Record<string, { url?: string; apiKey?: string; model?: string }>
    | undefined;
  if (providerConfigs && typeof providerConfigs === 'object') {
    for (const [providerId, cfg] of Object.entries(providerConfigs)) {
      const apiKey = cfg?.apiKey;
      if (typeof apiKey === 'string' && apiKey) {
        setSecret(NS_AI, `provider:${providerId}`, apiKey);
        providerConfigs[providerId] = {
          ...(cfg.url ? { url: cfg.url } : {}),
          ...(cfg.model ? { model: cfg.model } : {}),
          apiKey: '',
        };
        changed = true;
      }
    }
  }

  // 4. aiProviders registry (multi-provider grid) — vault each entry key
  const aiProviders = settings['aiProviders'] as
    | Array<{ id?: string; apiKey?: string; [k: string]: unknown }>
    | undefined;
  if (Array.isArray(aiProviders)) {
    for (const entry of aiProviders) {
      if (!entry || typeof entry !== 'object' || !entry.id) continue;
      const apiKey = entry.apiKey;
      if (typeof apiKey === 'string' && apiKey) {
        setSecret(NS_AI, `provider:${entry.id}`, apiKey);
        entry.apiKey = '';
        changed = true;
      }
    }
  }

  if (changed) store.set('settings', settings);
}

// ============= Repositories =============

export function getRepos(): RepositoryEntry[] {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  // Auto-remove repos whose directory no longer exists on disk.
  // The user may have deleted a repo folder via the OS file manager
  // (Finder/Explorer) without removing it from the app's store.
  // Without this, the repo stays in the sidebar and clicking it shows
  // "Not a Git repository". We filter them out here AND persist the
  // cleanup to the store so the change survives a restart.
  // This check runs in the MAIN process where fs is available — the
  // renderer cannot use fs.existsSync (contextIsolation: true).
  const existing = repos.filter((r) => {
    try { return fs.existsSync(r.path); } catch { return true; }
  });
  if (existing.length < repos.length) {
    store.set('repositories', existing);
  }
  return existing;
}

export function addRepo(repo: { path: string; name: string }): void {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const existingIdx = repos.findIndex((r) => r.path === repo.path);
  const existing = existingIdx >= 0 ? repos[existingIdx] : null;
  // PRESERVE existing fields (groupId) when re-adding a repo.
  // Previously, clicking a repo in the sidebar called addRepo() which
  // overwrote the entry with a fresh object — losing groupId and dropping
  // the repo out of its folder. Now we merge: keep groupId from the
  // existing entry, only bump lastOpened. (The legacy `pinned` flag was
  // removed from the schema — stale JSON fields are simply ignored.)
  const entry: RepositoryEntry = {
    path: repo.path,
    name: repo.name,
    lastOpened: Date.now(),
    groupId: existing?.groupId,
  };
  if (existingIdx >= 0) {
    repos[existingIdx] = entry;
  } else {
    repos.push(entry);
  }
  store.set('repositories', repos);

  // Also create metadata entry if it doesn't exist
  const metadata = (store.get('repoMetadata') || {}) as Record<string, RepositoryMetadata>;
  if (!metadata[repo.path]) {
    metadata[repo.path] = {
      path: repo.path,
      name: repo.name,
      tags: [],
      favorite: false,
      lastOpened: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.set('repoMetadata', metadata);
  }
}

export function removeRepo(repoPath: string): void {
  const repos = ((store.get('repositories') || []) as RepositoryEntry[]).filter((r) => r.path !== repoPath);
  store.set('repositories', repos);
  const metadata = (store.get('repoMetadata') || {}) as Record<string, RepositoryMetadata>;
  delete metadata[repoPath];
  store.set('repoMetadata', metadata);
}

export function updateRepo(repoPath: string, updates: Record<string, unknown>): void {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const idx = repos.findIndex((r) => r.path === repoPath);
  if (idx >= 0) {
    repos[idx] = { ...repos[idx], ...updates, lastOpened: Date.now() };
    store.set('repositories', repos);
  }
}

export function touchRepo(repoPath: string): void {
  updateRepo(repoPath, {});
}

// ============= Repository Metadata =============

export function getRepoMetadata(repoPath: string): RepositoryMetadata | null {
  const metadata = (store.get('repoMetadata') || {}) as Record<string, RepositoryMetadata>;
  return metadata[repoPath] || null;
}

export function getRepoMetadataAll(): RepositoryMetadata[] {
  const metadata = (store.get('repoMetadata') || {}) as Record<string, RepositoryMetadata>;
  return Object.values(metadata);
}

export function setRepoMetadata(repoPath: string, updates: Partial<RepositoryMetadata>): void {
  const metadata = (store.get('repoMetadata') || {}) as Record<string, RepositoryMetadata>;
  const existing = metadata[repoPath] || {
    path: repoPath,
    name: path.basename(repoPath),
    tags: [],
    favorite: false,
    lastOpened: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  metadata[repoPath] = {
    ...existing,
    ...updates,
    path: repoPath, // ensure path doesn't get overwritten
    updatedAt: Date.now(),
  };
  store.set('repoMetadata', metadata);
}

export function updateRepoMetadata(repoPath: string, updates: Partial<RepositoryMetadata>): void {
  setRepoMetadata(repoPath, updates);
}

export function deleteRepoMetadata(repoPath: string): void {
  const metadata = (store.get('repoMetadata') || {}) as Record<string, RepositoryMetadata>;
  delete metadata[repoPath];
  store.set('repoMetadata', metadata);
}

export function toggleFavorite(repoPath: string): void {
  const meta = getRepoMetadata(repoPath);
  if (meta) {
    setRepoMetadata(repoPath, { favorite: !meta.favorite });
  }
}

export function addTag(repoPath: string, tag: string): void {
  const meta = getRepoMetadata(repoPath);
  if (meta && !meta.tags.includes(tag)) {
    setRepoMetadata(repoPath, { tags: [...meta.tags, tag] });
  }
}

export function removeTag(repoPath: string, tag: string): void {
  const meta = getRepoMetadata(repoPath);
  if (meta) {
    setRepoMetadata(repoPath, { tags: meta.tags.filter(t => t !== tag) });
  }
}

/**
 * Refresh auto-collected stats from the actual Git repository.
 * This is called when a repo is opened or manually refreshed.
 *
 * CRITICAL: must read EVERY field fresh from git — never trust the cached
 * metadata values, otherwise the row shows stale "last commit 3 weeks ago"
 * even after the user just pushed a fresh one. The UI used to look cached
 * precisely because commitCount was never recomputed and lastCommitDate was
 * derived from a single log entry that was only updated on openRepository.
 *
 * We now also rev-parse the HEAD commit (cheap, never fails), count total
 * commits reachable from HEAD (`git rev-list --count HEAD`), and re-read
 * the local branch list. This makes a manual refresh actually refresh.
 */
export async function refreshRepoStats(repoPath: string): Promise<Partial<RepositoryMetadata>> {
  try {
    // PERF (v3.4): the four git reads (log -1 / branch list / remotes /
    // rev-list --count) now run in the DEDICATED background git worker
    // process (runStatsJobExternal → gitStatsCore), NOT on the main event
    // loop. This function is fired per repo on every repo open (deferred
    // stats fan-out) and for EVERY repo by the sidebar's "Check all
    // repositories" button — 4 spawns × N repos on the main loop was the
    // "UI goes fully unresponsive after clicking Check all" report, exactly
    // the pattern the poll/status jobs were already moved out for. The
    // metadata WRITE stays here in main (settings store). In non-Electron
    // hosts (vitest) the job runs in-process — same results, same contract.
    const stats = await runStatsJobExternal({ repoPath });

    // NOT-A-REPO guard: keep the pre-worker behavior of returning {} (and
    // NOT writing) when the directory is not a git repository — the old
    // simpleGit path threw here. Writing zeros would OVERWRITE good cached
    // metadata (lastCommit etc.) with empty values whenever the repo vanished
    // from disk (deleted externally) instead of preserving it. An UNBORN repo
    // (.git exists, no commits) legitimately reports zeros — isRepo stays
    // true there, matching the old behavior.
    if (!stats.isRepo) return {};

    const updates: Partial<RepositoryMetadata> = {
      lastCommitHash: stats.lastCommitHash,
      lastCommitDate: stats.lastCommitDate,
      lastCommitMessage: stats.lastCommitMessage,
      branchCount: stats.branchCount,
      remoteBranchCount: stats.remoteBranchCount,
      commitCount: stats.commitCount,
      remoteUrl: stats.remoteUrl,
      provider: stats.provider,
      owner: stats.owner,
      repo: stats.repo,
      webUrl: stats.webUrl,
      // Touch updatedAt so callers can verify the metadata was actually
      // recomputed (used by the Sidebar's "refresh" tooltip + tests).
      updatedAt: Date.now(),
    };

    setRepoMetadata(repoPath, updates);
    return updates;
  } catch {
    return {};
  }
}

/**
 * Refresh metadata for ALL configured repositories in a single sweep.
 * Used by the Sidebar's "refresh" button so the user can force-refresh the
 * whole list at once (previously the button only refreshed remote checks —
 * incoming/outgoing counters — but NOT the cached branch count / last
 * commit / commit count / provider info, which made the row look "stuck").
 *
 * PERF (v3): used to run each repo SEQUENTIALLY — with 10 repos that's 10
 × ~150-400ms serialized spawn chains (1.5-4s of wall time the sidebar
 * blocks). Now a bounded worker pool of 3 keeps concurrency safe (the old
 * comment's concern about saturating the process table) while cutting wall
 * time to ~⌈N/3⌉ rounds.
 * PERF (v3.4): since refreshRepoStats now dispatches to the background git
 * worker, this sweep keeps the MAIN loop free — main only awaits per-repo
 * job results and writes metadata (fast, in-memory + debounced flush).
 */
const REPO_STATS_CONCURRENCY = 3;

export async function refreshAllRepoStats(): Promise<{ refreshed: number; errors: Record<string, string> }> {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const errors: Record<string, string> = {};
  let refreshed = 0;
  const queue = repos.slice();
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const r = queue.shift()!;
      try {
        await refreshRepoStats(r.path);
        refreshed++;
      } catch (e) {
        errors[r.path] = e instanceof Error ? e.message : String(e);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(REPO_STATS_CONCURRENCY, repos.length) }, () => worker())
  );
  return { refreshed, errors };
}

// ============= Repository Groups (tree in the sidebar) =============

function getGroups(): RepoGroup[] {
  return ((store.get('repoGroups') || []) as RepoGroup[]).slice();
}

/**
 * True when `maybeDescendantId` equals `ancestorId` or lives somewhere in its
 * subtree. Also tolerates corrupt data (cycles) via a visited-set guard.
 */
export function isDescendantGroup(groups: RepoGroup[], ancestorId: string, maybeDescendantId: string): boolean {
  let cur = groups.find((g) => g.id === maybeDescendantId);
  const seen = new Set<string>();
  while (cur) {
    if (cur.id === ancestorId) return true;
    if (seen.has(cur.id)) return false; // corrupt data: cycle in parents
    seen.add(cur.id);
    cur = cur.parentId ? groups.find((g) => g.id === cur!.parentId) : undefined;
  }
  return false;
}

export function getRepoGroups(): RepoGroup[] {
  return getGroups();
}

export function createRepoGroup(name: string, parentId: string | null = null): RepoGroup {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Group name must not be empty');
  const groups = getGroups();
  const parent = parentId ?? null;
  if (parent !== null && !groups.some((g) => g.id === parent)) {
    throw new Error(`Parent group not found: ${parent}`);
  }
  const group: RepoGroup = {
    id: randomUUID(),
    name: trimmed,
    parentId: parent,
    expanded: true,
    order: Date.now(),
    createdAt: Date.now(),
  };
  groups.push(group);
  store.set('repoGroups', groups);
  return group;
}

export function renameRepoGroup(id: string, name: string): void {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Group name must not be empty');
  const groups = getGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`Group not found: ${id}`);
  group.name = trimmed;
  store.set('repoGroups', groups);
}

/**
 * Delete a group. Child groups AND repositories are promoted to the deleted
 * group's parent (nothing is ever destroyed along with the group) — the safe,
 * predictable behaviour for a folder tree.
 */
export function deleteRepoGroup(id: string): void {
  const groups = getGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) return;
  const parentId = group.parentId;
  for (const other of groups) {
    if (other.parentId === id) other.parentId = parentId;
  }
  store.set('repoGroups', groups.filter((g) => g.id !== id));

  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  let changed = false;
  for (const repo of repos) {
    if (repo.groupId === id) {
      repo.groupId = parentId;
      changed = true;
    }
  }
  if (changed) store.set('repositories', repos);
}

export function moveRepoGroup(id: string, newParentId: string | null): void {
  const groups = getGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) throw new Error(`Group not found: ${id}`);
  const parent = newParentId ?? null;
  if (parent === id) throw new Error('Cannot move a group into itself');
  if (parent !== null) {
    const target = groups.find((g) => g.id === parent);
    if (!target) throw new Error(`Parent group not found: ${parent}`);
    if (isDescendantGroup(groups, id, parent)) {
      throw new Error('Cannot move a group into its own subtree');
    }
  }
  group.parentId = parent;
  store.set('repoGroups', groups);
}

export function setRepoGroupExpanded(id: string, expanded: boolean): void {
  const groups = getGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) return;
  group.expanded = !!expanded;
  store.set('repoGroups', groups);
}

export function setRepoGroup(repoPath: string, groupId: string | null): void {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const idx = repos.findIndex((r) => r.path === repoPath);
  if (idx < 0) {
    // Bug fix: the repo may have been cloned into a path that differs in
    // trailing slash or case (macOS HFS+ is case-insensitive). Try a
    // normalized comparison before giving up. If still not found, AUTO-ADD
    // the repo so the group assignment succeeds instead of throwing.
    const normalized = repoPath.replace(/\/+$/, '');
    const idxNorm = repos.findIndex((r) => r.path.replace(/\/+$/, '') === normalized);
    if (idxNorm < 0) {
      // Auto-add the repo to the store with the given path. The group
      // will be set below. This handles the race where cloneRepository()
      // calls setRepoGroup() BEFORE openRepository() has had a chance to
      // call addRepo() (the clone just finished, the store hasn't been
      // updated yet).
      const name = repoPath.split('/').pop() || repoPath;
      repos.push({ path: repoPath, name, lastOpened: Date.now(), groupId: null });
      const newIdx = repos.length - 1;
      const parent = groupId ?? null;
      if (parent !== null && !getGroups().some((g) => g.id === parent)) {
        throw new Error(`Group not found: ${parent}`);
      }
      repos[newIdx] = { ...repos[newIdx], groupId: parent };
      store.set('repositories', repos);
      return;
    }
    // Found via normalized path — use it.
    const parent = groupId ?? null;
    if (parent !== null && !getGroups().some((g) => g.id === parent)) {
      throw new Error(`Group not found: ${parent}`);
    }
    repos[idxNorm] = { ...repos[idxNorm], groupId: parent };
    store.set('repositories', repos);
    return;
  }
  const parent = groupId ?? null;
  if (parent !== null && !getGroups().some((g) => g.id === parent)) {
    throw new Error(`Group not found: ${parent}`);
  }
  repos[idx] = { ...repos[idx], groupId: parent };
  store.set('repositories', repos);
}

/**
 * Flush pending debounced writes (call on app quit). Without this, the last
 * 100 ms of settings/repo-list changes can be lost when the app quits
 * before the debounce timer fires.
 */
export function flushSettings(): void {
  store.flush();
}

// ============= Folder repository scan (v2.3) =============
//
// «Репозитории из папок должны добавляться рекурсивно — все, что есть в
// папке и подпапках, образуя группы по названию папок».
//
// A directory is a Git repository when it contains a `.git` entry (a real
// directory for plain repos, a FILE for worktrees/submodules — both count).
// The walk starts at the picked root and descends into every subfolder
// EXCEPT: the found repos' own trees (their contents belong to them) and a
// short skip-list of dependency/cache dirs that never contain user repos.

export interface ScannedRepository {
  path: string;
  name: string;
  /**
   * CONTAINER folder chain from the scan ROOT (exclusive) to the repo's
   * parent folder — e.g. scanning /home/dev with /home/dev/libs/ui/.git
   * yields groupPath ['libs'] (the repo "ui" is the leaf, not a group).
   * An empty chain means the repo sits directly in the picked folder.
   */
  groupPath: string[];
}

export interface AddFolderRepositoriesResult {
  /** Everything the scan found (added + already known). */
  scanned: ScannedRepository[];
  /** Repos newly added to the sidebar list. */
  added: number;
  /** Repos that were already in the list (moved into their group). */
  existing: number;
  /** Groups created by this run (existing matching groups are reused). */
  groupsCreated: number;
  /** Name of the top-level group created for the picked folder. */
  rootGroupName: string;
}

/** Directories never worth descending into while hunting for repos. */
const SCAN_SKIP_DIRS = new Set([
  '.git', 'node_modules', 'venv', '.venv', '__pycache__', '.cache',
  '.npm', '.cargo', '.rustup', '.m2', '.gradle', '.idea', '.vscode',
  'dist-electron', 'coverage', '.pytest_cache', '.tox', '.next',
]);

const DEFAULT_SCAN_MAX_DEPTH = 8;

/** Does `dir` contain a `.git` entry (plain repo, worktree or submodule)? */
function isGitRepositoryDir(dir: string): boolean {
  try {
    // existsSync is true for BOTH files and directories — exactly the
    // shapes `.git` can take.
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

/**
 * Walk `rootPath` recursively and collect every Git repository found in
 * it and its subfolders. Symlinked directories are not followed (cycle
 * guard); depth is capped at `maxDepth` to stay snappy on huge trees.
 */
export function scanFolderForRepositories(
  rootPath: string,
  opts: { maxDepth?: number } = {},
): ScannedRepository[] {
  const root = path.resolve(rootPath);
  const maxDepth = Math.max(1, Math.min(16, opts.maxDepth ?? DEFAULT_SCAN_MAX_DEPTH));
  const found: ScannedRepository[] = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return found;

  // The picked root is ALWAYS opened as a container: even when it is a
  // repository itself, its subfolders are still scanned (that's what
  // "все что есть в папке и подпапках" means).
  if (isGitRepositoryDir(root)) {
    found.push({ path: root, name: path.basename(root), groupPath: [] });
  }

  const walk = (dir: string, chain: string[], depth: number): void => {
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable (permissions) — skip silently
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      // Symlink guard: lstat detects links without following them; a
      // linked folder would risk infinite loops and double-counting.
      try {
        if (fs.lstatSync(child).isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const isRepo = isGitRepositoryDir(child);
      if (isRepo) {
        // groupPath = the CONTAINER folder chain (repo's own name is NOT a
        // group — the repo itself is the leaf): /dev/libs/ui/.git scanned
        // from /dev lands in the "libs" group with groupPath ['libs'].
        found.push({ path: child, name: entry.name, groupPath: [...chain] });
        // Do NOT descend into the found repository — its subfolders
        // belong to it (submodules are part of the parent's tree).
      } else {
        walk(child, [...chain, entry.name], depth + 1);
      }
    }
  };
  walk(root, [], 0);
  // Deterministic order: breadth of the folder tree, alphabetical.
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

/**
 * Find an existing group by (name, parent) — makes re-adding the same
 * folder IDEMPOTENT: a second scan reuses its groups instead of piling
 * up "work (2)" duplicates.
 */
function findOrCreateGroup(name: string, parentId: string | null): { group: RepoGroup; created: boolean } {
  const groups = getGroups();
  const existing = groups.find(
    (g) => g.name === name && (g.parentId ?? null) === parentId,
  );
  if (existing) return { group: existing, created: false };
  const group = createRepoGroup(name, parentId);
  return { group, created: true };
}

/**
 * Scan a folder and add EVERY repository found in it and its subfolders,
 * building a group tree that mirrors the folder structure. Re-running on
 * the same folder is safe: groups are reused, known repos only move into
 * their group.
 */
export function addFolderRepositories(
  rootPath: string,
  opts: { maxDepth?: number } = {},
): AddFolderRepositoriesResult {
  const root = path.resolve(rootPath);
  const scanned = scanFolderForRepositories(root, opts);
  const rootGroupName = path.basename(root) || root;
  let groupsCreated = 0;
  let added = 0;
  let existing = 0;

  // Picking a folder that is ITSELF the only repository → no group wrapper
  // (a group named after the repo containing that same repo is noise):
  // the repo is added plainly, exactly like the single-repo flow.
  const onlyRootRepoItself =
    scanned.length === 1 && scanned[0].path === root && scanned[0].groupPath.length === 0;

  // Root group (or a subgroup when a parent is given by future callers).
  let rootGroupId: string | null = null;
  if (!onlyRootRepoItself) {
    const rootGroup = findOrCreateGroup(rootGroupName, null);
    if (rootGroup.created) groupsCreated++;
    rootGroupId = rootGroup.group.id;
  }

  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const known = new Set(repos.map((r) => r.path));

  for (const repo of scanned) {
    // Build/locate the group chain: root → seg1 → seg2 → …
    let parentId: string | null = rootGroupId;
    if (parentId !== null) {
      for (const segment of repo.groupPath) {
        const g = findOrCreateGroup(segment, parentId!);
        if (g.created) groupsCreated++;
        parentId = g.group.id;
      }
    }
    if (!known.has(repo.path)) {
      addRepo({ path: repo.path, name: repo.name });
      known.add(repo.path);
      added++;
    } else {
      existing++;
    }
    // setRepoGroup handles both fresh and existing entries; fresh ones
    // were just added above so the index lookup succeeds. null → the repo
    // stays at the sidebar root (only-root-repo case).
    setRepoGroup(repo.path, parentId);
  }

  return { scanned, added, existing, groupsCreated, rootGroupName };
}
