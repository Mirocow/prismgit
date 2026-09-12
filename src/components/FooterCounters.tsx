import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { Recycle, GitPullRequest, Package, Layers } from './icons';
import { useI18n } from '../lib/i18n';

/**
 * Tasks 15, 16, 17, 20 — footer indicators for Recyclable / Stashes /
 * Submodules / LFS. Each shows a count badge; clicking navigates to the
 * corresponding page.
 *
 * Fetched lazily once on mount and re-fetched when gitStore.lastRefresh
 * changes (so post-commit / post-stash the counts update automatically).
 * Each counter is independent — failures land as 0 (hidden) so a missing
 * LFS or empty submodule list never breaks the rest.
 */
export function FooterCounters() {
  const repo = useRepositoryStore((s) => s.currentRepo);
  const lastRefresh = useGitStore((s) => s.lastRefresh);
  const { t } = useI18n();

  const [recyclable, setRecyclable] = useState<number | null>(null);
  const [stashes, setStashes] = useState<number | null>(null);
  const [submodules, setSubmodules] = useState<number | null>(null);
  const [lfs, setLfs] = useState<{ tracked: number } | null>(null);

  useEffect(() => {
    if (!repo) {
      setRecyclable(null);
      setStashes(null);
      setSubmodules(null);
      setLfs(null);
      return;
    }

    let cancelled = false;
    const fetch = async () => {
      // Recyclable — count of unreachable reflog commits.
      try {
        const out = await api.git.raw(repo.path, ['reflog', '--all', '--format=%H']);
        // Quick estimate: count unique hashes that aren't reachable from any ref.
        // For perf, we just count reflog lines as a proxy; the actual
        // recyclable list is computed by the Recyclable page on demand.
        const count = out.split('\n').filter(Boolean).length;
        if (!cancelled) setRecyclable(count);
      } catch { if (!cancelled) setRecyclable(null); }

      // Stashes.
      try {
        const out = await api.git.raw(repo.path, ['stash', 'list']);
        const count = out.split('\n').filter(Boolean).length;
        if (!cancelled) setStashes(count);
      } catch { if (!cancelled) setStashes(null); }

      // Submodules.
      try {
        const out = await api.git.raw(repo.path, ['submodule', 'status']);
        const count = out.split('\n').filter(Boolean).length;
        if (!cancelled) setSubmodules(count);
      } catch { if (!cancelled) setSubmodules(null); }

      // LFS — check if .gitattributes has any 'filter=lfs' entries.
      try {
        const tracked = await api.git.lfsList(repo.path);
        if (!cancelled) setLfs({ tracked: tracked.length });
      } catch { if (!cancelled) setLfs(null); }
    };
    void fetch();
    return () => { cancelled = true; };
  }, [repo, lastRefresh]);

  if (!repo) return null;

  return (
    <div className="flex items-center gap-2">
      {recyclable !== null && recyclable > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/recyclable'; }}
          title={t('footer.recyclableTooltip', { count: recyclable })}
        >
          <Recycle size={10} />
          <span className="text-2xs">{recyclable}</span>
        </button>
      )}
      {stashes !== null && stashes > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/stashes'; }}
          title={t('footer.stashesTooltip', { count: stashes })}
        >
          <GitPullRequest size={10} />
          <span className="text-2xs">{stashes}</span>
        </button>
      )}
      {submodules !== null && submodules > 0 && (
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => { window.location.hash = '#/submodules'; }}
          title={t('footer.submodulesTooltip', { count: submodules })}
        >
          <Package size={10} />
          <span className="text-2xs">{submodules}</span>
        </button>
      )}
      {lfs && lfs.tracked > 0 && (
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
