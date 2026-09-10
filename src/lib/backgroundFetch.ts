import { useSettingsStore } from '../stores/settingsStore';

/**
 * SmartGit-style "Perform background Poll or Fetch".
 *
 * The checkbox lives on the remote (Configure remote properties dialog), the
 * flag itself is stored app-side per repo — exactly like SmartGit does. The
 * actual polling loop lives in hooks/useBackgroundFetch.ts.
 */
export const BACKGROUND_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function getBackgroundFetchRemotes(repoPath: string): string[] {
  const map = useSettingsStore.getState().settings.backgroundFetchRemotes;
  return map?.[repoPath] ?? [];
}

export function isBackgroundFetchEnabled(repoPath: string, remoteName: string): boolean {
  return getBackgroundFetchRemotes(repoPath).includes(remoteName);
}

export function setBackgroundFetchForRepo(repoPath: string, remoteName: string, enabled: boolean): void {
  const { settings, setSetting } = useSettingsStore.getState();
  const map: Record<string, string[]> = { ...(settings.backgroundFetchRemotes ?? {}) };
  const names = new Set(map[repoPath] ?? []);
  if (enabled) names.add(remoteName);
  else names.delete(remoteName);
  map[repoPath] = [...names].sort();
  void setSetting('backgroundFetchRemotes', map);
}
