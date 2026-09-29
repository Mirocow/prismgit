import { useEffect, useRef } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSettingsStore } from '../stores/settingsStore';
import { api } from '../lib/api';
import { bumpPolling } from './useRemotePolling';

/**
 * Periodic "push to origin" — while a repository is the active one AND the
 * user has enabled auto-push in Settings → Git, the local branch's outgoing
 * commits are pushed to its configured upstream on `origin`.
 *
 * Behaviour:
 *  - Master gate: `settings.autoPushEnabled` (default false). When off, NO
 *    timer is scheduled and NO pushes happen.
 *  - Cadence: `settings.autoPushIntervalSec` (default 0 = off; min 60s).
 *  - Paused while the window is blurred — there's no point pushing commits
 *    while the user isn't actively working in the app.
 *  - Silent: failures land in the console only (no toast spam). Successful
 *    pushes bump the polling so the sidebar ↓/↑ counter refreshes.
 *  - Only pushes the current branch to its tracking remote (origin/<branch>).
 *    Does NOT push tags, does NOT force-push, does NOT touch other branches.
 *  - If there's nothing to push (no outgoing commits), the call is a no-op
 *    from git's side — git push returns "Everything up-to-date" without
 *    network traffic beyond the initial ref negotiation.
 */
const MIN_AUTO_PUSH_SEC = 60;

export function useAutoPush() {
  const repoPath = useRepositoryStore((s) => s.currentRepo?.path ?? null);
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;

  const autoPushEnabled = useSettingsStore((s) => s.settings.autoPushEnabled ?? false);
  const autoPushIntervalSec = useSettingsStore((s) => s.settings.autoPushIntervalSec ?? 0);
  const enabledRef = useRef(autoPushEnabled);
  enabledRef.current = autoPushEnabled;
  const intervalRef = useRef(autoPushIntervalSec);
  intervalRef.current = autoPushIntervalSec;

  useEffect(() => {
    if (!repoPath) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let blurred = false;

    const getIntervalMs = (): number | null => {
      const sec = intervalRef.current;
      if (!enabledRef.current) return null;
      if (!Number.isFinite(sec) || sec <= 0) return null;
      return Math.max(MIN_AUTO_PUSH_SEC, sec) * 1000;
    };

    const pushNow = async () => {
      if (disposed || blurred) return;
      const path = repoPathRef.current;
      if (!path) return;
      try {
        // Read the current branch + its upstream. We use git status's
        // `current` + `tracking` instead of `git config branch.<name>.remote`
        // because status already tracks detached-HEAD and the upstream ref
        // is resolved with the user's push.default rules.
        const status = await api.git.status(path).catch(() => null);
        if (!status) return;
        const branch = status.current;
        if (!branch || status.detached) return; // no branch to push
        const upstream = status.tracking; // e.g. 'origin/main'
        if (!upstream) {
          // No upstream configured — skip silently. The user can set one
          // via `git push -u origin <branch>` and the next tick will pick
          // it up.
          return;
        }
        // Only push when there are outgoing commits — `git push` without a
        // refspec would push ALL branches, which is surprising. We push the
        // current branch only.
        if (status.ahead === 0) return; // nothing to push
        // Push to origin (we use the upstream's remote name, which is usually
        // 'origin' but could be configured to something else).
        const remoteName = upstream.split('/')[0] || 'origin';
        await api.git.push(path, remoteName, branch, false, false, false);
        // Bump polling so the sidebar ↑ counter refreshes immediately.
        bumpPolling('auto-push');
      } catch (e) {
        // Silent — the user didn't ask for this push explicitly and we
        // don't want to spam them with errors every minute.
        console.warn('[auto-push] failed:', e);
      }
    };

    const schedule = () => {
      if (disposed) return;
      const ms = getIntervalMs();
      if (ms === null) return;
      timer = setTimeout(async () => {
        timer = null;
        if (disposed) return;
        if (!blurred) await pushNow();
        schedule();
      }, ms);
    };

    const onBlur = () => { blurred = true; };
    const onFocus = () => { blurred = false; };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    schedule();

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [repoPath, autoPushEnabled, autoPushIntervalSec]);
}
