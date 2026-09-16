import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AppSettings, RepositoryEntry, RepositoryMetadata, RepoGroup } from '../types/settings-api.js';
import simpleGit from 'simple-git';
import { SimpleStore } from './simpleStore.js';
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
      theme: 'dark',
      fontSize: 14,
      sidebarWidth: 280,
      defaultCloneDir: '',
      showReflogInHistory: false,
      maxHistoryLoad: 500,
      enableTelemetry: false,
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
  return (store.get('repositories') || []) as RepositoryEntry[];
}

export function addRepo(repo: { path: string; name: string }): void {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const existingIdx = repos.findIndex((r) => r.path === repo.path);
  const existing = existingIdx >= 0 ? repos[existingIdx] : null;
  // PRESERVE existing fields (pinned, groupId) when re-adding a repo.
  // Previously, clicking a repo in the sidebar called addRepo() which
  // overwrote the entry with a fresh object — losing groupId and dropping
  // the repo out of its folder. Now we merge: keep pinned + groupId from
  // the existing entry, only bump lastOpened.
  const entry: RepositoryEntry = {
    path: repo.path,
    name: repo.name,
    lastOpened: Date.now(),
    pinned: existing?.pinned,
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
    // Use the same LFS-skipping env as the main git service — without this,
    // simpleGit creates a fresh instance WITHOUT GIT_LFS_SKIP_SMUDGE and
    // GIT_CONFIG overrides, so git-lfs smudge filters run on EVERY file.
    // This was a hidden cost: refreshRepoStats ran on repo open + every
    // sidebar refresh, spawning git-lfs processes that took 5-10s each.
    const { GIT_UNSAFE_OPTIONS } = await import('./git.js');
    const git = simpleGit({ baseDir: repoPath, ...GIT_UNSAFE_OPTIONS });

    // Run all reads in parallel — they are independent.
    const [logResult, branchResult, remotes, commitCountStr, headHash] = await Promise.all([
      git.log({ maxCount: 1 }).catch(() => ({ latest: null })),
      git.branchLocal().catch(() => ({ all: [] as string[] })),
      git.getRemotes(true).catch(() => []),
      // Total commit count reachable from HEAD. May fail on empty repos
      // (no HEAD yet) — fall back to 0.
      git.raw(['rev-list', '--count', 'HEAD']).catch(() => '0'),
      git.revparse('HEAD').catch(() => undefined),
    ]);

    const latest = (logResult as { latest: { hash: string; date: string; message: string } | null }).latest;
    const origin = (remotes as Array<{ name: string; refs: { fetch: string } }>).find(r => r.name === 'origin') ||
      (remotes as Array<{ name: string; refs: { fetch: string } }>)[0];
    const url = origin?.refs.fetch;
    const commitCount = parseInt((commitCountStr || '0').trim(), 10) || 0;

    // Detect provider
    let provider: RepositoryMetadata['provider'] = 'unknown';
    let owner: string | undefined;
    let repo: string | undefined;
    let webUrl: string | undefined;

    if (url) {
      const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
      const httpsMatch = url.match(/https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/);
      const match = sshMatch || httpsMatch;
      if (match) {
        const [, host, ownerName, repoName] = match;
        webUrl = `https://${host}/${ownerName}/${repoName}`;
        if (host.includes('github.com')) { provider = 'github'; owner = ownerName; repo = repoName; }
        else if (host.includes('gitlab')) { provider = 'gitlab'; owner = ownerName; repo = repoName; }
        else if (host.includes('bitbucket.org')) { provider = 'bitbucket'; owner = ownerName; repo = repoName; }
      }
    }

    const updates: Partial<RepositoryMetadata> = {
      // Prefer revparse for the hash (always available even when log is empty
      // for a fresh repo with one unborn commit) but fall back to log's hash.
      lastCommitHash: (headHash && headHash.trim()) || latest?.hash,
      lastCommitDate: latest?.date,
      lastCommitMessage: latest?.message,
      branchCount: (branchResult as { all: string[] }).all.length,
      commitCount,
      remoteUrl: url,
      provider,
      owner,
      repo,
      webUrl,
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
 * Runs each refresh sequentially to avoid spawning N concurrent git
 * subprocesses (would saturate the system on large repo lists).
 */
export async function refreshAllRepoStats(): Promise<{ refreshed: number; errors: Record<string, string> }> {
  const repos = (store.get('repositories') || []) as RepositoryEntry[];
  const errors: Record<string, string> = {};
  let refreshed = 0;
  for (const r of repos) {
    try {
      await refreshRepoStats(r.path);
      refreshed++;
    } catch (e) {
      errors[r.path] = e instanceof Error ? e.message : String(e);
    }
  }
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
  if (idx < 0) throw new Error(`Repository not found: ${repoPath}`);
  const parent = groupId ?? null;
  if (parent !== null && !getGroups().some((g) => g.id === parent)) {
    throw new Error(`Group not found: ${parent}`);
  }
  repos[idx] = { ...repos[idx], groupId: parent };
  store.set('repositories', repos);
}
