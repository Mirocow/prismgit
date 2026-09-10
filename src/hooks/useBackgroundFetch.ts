import { useEffect, useRef } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { api } from '../lib/api';
import { BACKGROUND_FETCH_INTERVAL_MS, getBackgroundFetchRemotes } from '../lib/backgroundFetch';

/**
 * SmartGit-style background "Poll or Fetch": while a repository is open,
 * quietly fetch every remote that has "Perform background Poll or Fetch"
 * enabled (Configure remote properties dialog), then refresh the status so
 * ahead/behind counters and branches stay current.
 *
 * Errors are intentionally silent (console only) — background activity must
 * not spam the user with toasts.
 */
export function useBackgroundFetch() {
  const repoPath = useRepositoryStore((s) => s.currentRepo?.path ?? null);
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;

  useEffect(() => {
    if (!repoPath) return;

    let running = false;
    const tick = async () => {
      const path = repoPathRef.current;
      if (!path || running) return;
      running = true;
      try {
        const names = getBackgroundFetchRemotes(path);
        let fetched = false;
        for (const name of names) {
          try {
            await api.git.fetch(path, name, true);
            fetched = true;
          } catch (e) {
            console.warn(`[background-fetch] '${name}' failed:`, e);
          }
        }
        if (fetched) await useGitStore.getState().refreshStatus(path).catch(() => {});
      } finally {
        running = false;
      }
    };

    const id = setInterval(tick, BACKGROUND_FETCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [repoPath]);
}
