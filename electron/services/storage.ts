import * as path from 'path';
import type { AppSettings, RepositoryEntry, RepositoryMetadata } from '../types/settings-api.js';
import simpleGit from 'simple-git';
import { SimpleStore } from './simpleStore.js';

interface StoreSchema {
  settings: Partial<AppSettings>;
  repositories: RepositoryEntry[];
  repoMetadata: Record<string, RepositoryMetadata>;
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
