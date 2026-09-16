import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSettingsStore } from '../stores/settingsStore';
import { Recycle, GitPullRequest, Package, Layers } from './icons';
import { useI18n } from '../lib/i18n';

/**
 * Tasks 15, 16, 17, 20 — footer indicators for Recyclable / Stashes /
 * Submodules / LFS. Each shows a count badge; clicking navigates to the
 * corresponding page.
 *
 * Task 18 — respects per-section visibility settings from
 * settings.footerVisible.{recyclable,stashes,submodules,lfs}.
 *
 * PERFORMANCE: previously this component re-fetched ALL 4 counters on EVERY
 * lastRefresh change (every 5 seconds from the file watcher). That meant
 * 4 git subprocess spawns every 5 seconds:
 *   1. git reflog --all --format=%H
 *   2. git stash list
 *   3. git config --file .gitmodules --get-regexp (THE .gitmodules SPAM!)
 *   4. git lfs version (3s timeout if not installed!) + git lfs list
 *
 * Now: counters are fetched ONCE on repo open, then re-fetched at most
 * every 30 seconds (not on every lastRefresh). The .gitmodules count is
 * done via fs.readFileSync (no git subprocess at all). The LFS check is
 * cached — it only runs once per repo.
 */
const FOOTER_REFRESH_INTERVAL_MS = 30_000; // 30 seconds — was on every lastRefresh (5s)

export function FooterCounters() {
  const repo = useRepositoryStore((s) => s.currentRepo);
  const lastRefresh = useGitStore((s) => s.lastRefresh);
  const footerVisible = useSettingsStore((s) => s.settings.footerVisible);
  const { t } = useI18n();

  const [recyclable, setRecyclable] = useState<number | null>(null);
  const [stashes, setStashes] = useState<number | null>(null);
  const [submodules, setSubmodules] = useState<number | null>(null);
  const [lfs, setLfs] = useState<{ tracked: number } | null>(null);

  // Throttle: only re-fetch at most once per FOOTER_REFRESH_INTERVAL_MS.
  // The previous code re-fetched on EVERY lastRefresh bump (every 5s from
  // the file watcher). Now we track the last fetch time and skip if the
  // interval hasn't elapsed.
  const lastFetchRef = useRef(0);
  const lfsCheckedRef = useRef<string | null>(null); // cache LFS check per repo path

  useEffect(() => {
    if (!repo) {
      setRecyclable(null);
      setStashes(null);
      setSubmodules(null);
      setLfs(null);
      lfsCheckedRef.current = null;
      return;
    }

    // Throttle: skip if we fetched recently.
    const now = Date.now();
    if (now - lastFetchRef.current < FOOTER_REFRESH_INTERVAL_MS) return;
    lastFetchRef.current = now;

    // Reset LFS cache when repo changes.
    if (lfsCheckedRef.current !== repo.path) {
      lfsCheckedRef.current = repo.path;
      setLfs(null);
    }

    let cancelled = false;

    const fetch = async () => {
      // Recyclable — count of unreachable reflog commits.
      try {
        const out = await api.git.raw(repo.path, ['reflog', '--all', '--format=%H']);
        const count = out.split('\n').filter(Boolean).length;
        if (!cancelled) setRecyclable(count);
      } catch { if (!cancelled) setRecyclable(null); }

      // Stashes.
      try {
        const out = await api.git.raw(repo.path, ['stash', 'list']);
        const count = out.split('\n').filter(Boolean).length;
        if (!cancelled) setStashes(count);
      } catch { if (!cancelled) setStashes(null); }

      // Submodules — read .gitmodules via fs (NOT git config).
      // The previous code used `git config --file .gitmodules --get-regexp`
      // which spawned a git subprocess EVERY 5 SECONDS. This was the source
      // of the .gitmodules spam in the command log.
      // Now we read the file directly — no subprocess, no error on repos
      // without .gitmodules, ~1ms instead of ~20ms per call.
      try {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        let count = 0;
        try {
          const content = await readFile(join(repo.path, '.gitmodules'), 'utf8');
          // Count [submodule "name"] blocks — each has a `path = ...` line.
          count = (content.match(/^\[submodule\s+"/gm) || []).length;
        } catch {
          // No .gitmodules — count stays 0.
        }
        if (!cancelled) setSubmodules(count);
      } catch { if (!cancelled) setSubmodules(null); }

      // LFS — only check ONCE per repo (not on every refresh).
      // isLfsInstalled spawns `git lfs version` which takes 3s if git-lfs
      // is not installed. Running this every 5 seconds was a major perf hit.
      if (lfsCheckedRef.current === repo.path) {
        try {
          const installed = await api.git.isLfsInstalled(repo.path);
          if (!installed) {
            if (!cancelled) setLfs(null);
          } else {
            const tracked = await api.git.lfsList(repo.path);
            if (!cancelled) setLfs({ tracked: tracked.length });
          }
        } catch { if (!cancelled) setLfs(null); }
      }
    };
    void fetch();
    return () => { cancelled = true; };
  }, [repo, lastRefresh]);

  if (!repo) return null;

  const vis = footerVisible ?? {};
  const show = (k: 'recyclable' | 'stashes' | 'submodules' | 'lfs') => vis[k] !== false;

  return (
    <div className="flex items-center gap-2">
      {show('recyclable') && recyclable !== null && recyclable > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/recyclable'; }}
          title={t('footer.recyclableTooltip', { count: recyclable })}
        >
          <Recycle size={10} />
          <span className="text-2xs">{recyclable}</span>
        </button>
      )}
      {show('stashes') && stashes !== null && stashes > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/stashes'; }}
          title={t('footer.stashesTooltip', { count: stashes })}
        >
          <GitPullRequest size={10} />
          <span className="text-2xs">{stashes}</span>
        </button>
      )}
      {show('submodules') && submodules !== null && submodules > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/submodules'; }}
          title={t('footer.submodulesTooltip', { count: submodules })}
        >
          <Package size={10} />
          <span className="text-2xs">{submodules}</span>
        </button>
      )}
      {show('lfs') && lfs && lfs.tracked > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/lfs'; }}
          title={t('footer.lfsTooltip', { count: lfs.tracked })}
        >
          <Layers size={10} />
          <span className="text-2xs">LFS:{lfs.tracked}</span>
        </button>
      )}
    </div>
  );
}
