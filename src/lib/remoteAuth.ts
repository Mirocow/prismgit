import { useSettingsStore } from '../stores/settingsStore';
import type { RemoteCredential } from '../../electron/types/settings-api';

/**
 * Per-remote authorization (Repository Settings → Remotes).
 *
 * Credentials live in the shared app settings keyed by repo path + remote
 * name, so the Repository Settings dialog and the Remotes tool edit the SAME
 * value. The main process reads the store directly and applies the
 * credentials per-command (http.extraHeader) for push/pull/fetch/ls-remote —
 * nothing is written to .git/config or the remote URL.
 */
export function getRemoteAuth(repoPath: string, remoteName: string): RemoteCredential {
  const map = useSettingsStore.getState().settings.remoteAuth;
  return map?.[repoPath]?.[remoteName] ?? {};
}

export function getAllRemoteAuth(repoPath: string): Record<string, RemoteCredential> {
  const map = useSettingsStore.getState().settings.remoteAuth;
  return map?.[repoPath] ?? {};
}

export function setRemoteAuth(repoPath: string, remoteName: string, cred: RemoteCredential): void {
  const { settings, setSetting } = useSettingsStore.getState();
  const map: Record<string, Record<string, RemoteCredential>> = { ...(settings.remoteAuth ?? {}) };
  const forRepo = { ...(map[repoPath] ?? {}) };
  if (!cred.username?.trim() && !cred.password?.trim()) {
    delete forRepo[remoteName];
  } else {
    forRepo[remoteName] = {
      username: cred.username?.trim() || undefined,
      password: cred.password || undefined,
    };
  }
  if (Object.keys(forRepo).length === 0) delete map[repoPath];
  else map[repoPath] = forRepo;
  void setSetting('remoteAuth', map);
}

export function clearRemoteAuth(repoPath: string, remoteName: string): void {
  setRemoteAuth(repoPath, remoteName, {});
}

/** True when the remote has usable credentials stored. */
export function hasRemoteAuth(repoPath: string, remoteName: string): boolean {
  const cred = getRemoteAuth(repoPath, remoteName);
  return !!(cred.username?.trim() || cred.password?.trim());
}
