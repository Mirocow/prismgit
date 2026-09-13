import { api, type RemoteInfo } from './api';

/**
 * Default remote resolution used everywhere the UI used to hardcode 'origin':
 * gitStore push/pull/fetch, the toolbar Push dropdown, branch push actions.
 * Prefers 'origin', falls back to the first configured remote.
 */
export function pickDefaultRemote(remotes: RemoteInfo[]): string {
  if (remotes.length === 0) return '';
  return remotes.find((r) => r.name === 'origin')?.name || remotes[0].name;
}

/** Load remotes for a repo and resolve the default one (null when none configured). */
export async function resolveDefaultRemote(repoPath: string): Promise<string | null> {
  const remotes = await api.git.remotes(repoPath).catch(() => [] as RemoteInfo[]);
  const name = pickDefaultRemote(remotes);
  return name || null;
}
