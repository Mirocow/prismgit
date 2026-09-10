import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AppSettings, RepositoryEntry, RepositoryMetadata, RepoGroup } from '../types/settings-api.js';
import simpleGit from 'simple-git';
import { SimpleStore } from './simpleStore.js';

interface StoreSchema {
  settings: Partial<AppSettings>;
  repositories: RepositoryEntry[];
  repoMetadata: Record<string, RepositoryMetadata>;
  repoGroups: RepoGroup[];
}

const store = new SimpleStore({
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
    repoMetadata: {},
    repoGroups: [],
  },
});

// ============= Settings =============

export function getSetting<T = unknown>(key: string): T | undefined {
  const settings = store.get('settings') as Partial<AppSettings> | undefined;
  return settings ? settings[key as keyof AppSettings] as T : undefined;
}

export function setSetting(key: string, value: unknown): void {
  const settings = (store.get('settings') || {}) as Partial<AppSettings>;
  (settings as Record<string, unknown>)[key] = value;
  store.set('settings', settings);
}

export function getAllSettings(): Partial<AppSettings> {
  return (store.get('settings') || {}) as Partial<AppSettings>;
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
 */
export async function refreshRepoStats(repoPath: string): Promise<Partial<RepositoryMetadata>> {
  try {
    const git = simpleGit({ baseDir: repoPath });
    const [logResult, branchResult, remotes] = await Promise.all([
      git.log({ maxCount: 1 }).catch(() => ({ latest: null })),
      git.branchLocal().catch(() => ({ all: [] as string[] })),
      git.getRemotes(true).catch(() => []),
    ]);

    const latest = (logResult as { latest: { hash: string; date: string; message: string } | null }).latest;
    const origin = (remotes as Array<{ name: string; refs: { fetch: string } }>).find(r => r.name === 'origin') ||
      (remotes as Array<{ name: string; refs: { fetch: string } }>)[0];
    const url = origin?.refs.fetch;

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
      lastCommitHash: latest?.hash,
      lastCommitDate: latest?.date,
      lastCommitMessage: latest?.message,
      branchCount: (branchResult as { all: string[] }).all.length,
      remoteUrl: url,
      provider,
      owner,
      repo,
      webUrl,
    };

    setRepoMetadata(repoPath, updates);
    return updates;
  } catch {
    return {};
  }
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
