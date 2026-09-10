import { useMemo, useState } from 'react';
import { Folder, Plus, Github, BookOpen, Star, ChevronRight, GitBranch, FileText, History, Download, Search, X } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useI18n } from '../lib/i18n';

export function WelcomeScreen({
  onClone,
  onInit,
}: {
  onClone?: () => void;
  onInit?: () => void;
}) {
  const openRepo = useRepositoryStore((s) => s.openRepositoryPicker);
  const { repos, metadata, openRepository } = useRepositoryStore();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  // Show ALL repos (not just 5) — favorites first, then lastOpened desc, stable order otherwise
  const safeRepos = Array.isArray(repos) ? repos : [];
  const safeMeta = metadata || {};
  const allSortedRepos = useMemo(() => {
    return [...safeRepos].sort((a, b) => {
      const ma = safeMeta[a.path];
      const mb = safeMeta[b.path];
      // Favorites first
      if (ma?.favorite && !mb?.favorite) return -1;
      if (!ma?.favorite && mb?.favorite) return 1;
      // Then by lastOpened (most recent first)
      const ta = a.lastOpened || 0;
      const tb = b.lastOpened || 0;
      if (ta !== tb) return tb - ta;
      return 0;
    });
  }, [safeRepos, safeMeta]);
  // Filter by search query (name or path)
  const filteredRepos = useMemo(() => {
    if (!search.trim()) return allSortedRepos;
    const q = search.toLowerCase();
    return allSortedRepos.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q) ||
      (safeMeta[r.path]?.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }, [allSortedRepos, search, safeMeta]);

  // Quick feature highlights shown beneath the primary actions
  const features = [
    { icon: History, title: t('shell.featureGraphTitle'), desc: t('shell.featureGraphDesc') },
    { icon: FileText, title: t('shell.featureDiffsTitle'), desc: t('shell.featureDiffsDesc') },
    { icon: GitBranch, title: t('shell.featureBranchesTitle'), desc: t('shell.featureBranchesDesc') },
  ];

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      {/* Hero section with gradient backdrop — fades smoothly into the page background */}
      <div className="relative overflow-hidden">
        {/* Decorative gradient background — masked to fade out at the bottom
            so it doesn't bleed into the repository list below. */}
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 25% 30%, var(--accent) 0%, transparent 50%), radial-gradient(circle at 75% 70%, var(--accent-purple) 0%, transparent 50%)',
            // Smooth fade: full at top → transparent at bottom 80%
            maskImage: 'linear-gradient(to bottom, black 0%, black 50%, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 50%, transparent 85%)',
          }}
        />
        {/* Grid pattern — same fade so it blends into the page background */}
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse at center top, black 20%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center top, black 20%, transparent 70%)',
          }}
        />
        {/* Smooth color transition strip at the bottom of the hero —
            blends the gradient area into the solid page background. */}
        <div
          className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, transparent, var(--bg-primary))',
          }}
        />

        <div className="relative max-w-2xl mx-auto px-6 pt-16 pb-10 text-center">
          <div className="mb-6 flex justify-center">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg relative"
              style={{
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-purple) 100%)',
                boxShadow: '0 10px 30px rgba(57, 158, 230, 0.3)',
              }}
            >
              <GitBranch size={42} className="text-white" strokeWidth={2.5} />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-text-primary mb-3 tracking-tight">
            {t('welcome.title')}
          </h1>
          <p className="text-sm text-text-secondary mb-8 max-w-md mx-auto leading-relaxed">
            {t('welcome.subtitle')}
          </p>

          {/* Three primary actions: Open, Clone, New */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
            <button className="btn btn-primary justify-center flex-1" onClick={openRepo}>
              <Folder size={16} />
              {t('welcome.openRepo')}
            </button>
            <button
              className="btn btn-secondary justify-center flex-1"
              onClick={() => onClone && onClone()}
            >
              <Download size={16} />
              {t('welcome.cloneRepo')}
            </button>
            <button
              className="btn btn-secondary justify-center flex-1"
              onClick={() => onInit && onInit()}
            >
              <Plus size={16} />
              {t('welcome.newRepo')}
            </button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-text-tertiary">
            <BookOpen size={12} />
            <span>
              {t('welcome.dragHint')}
            </span>
          </div>
        </div>
      </div>

      {/* All repositories with search — only show if user has any */}
      {allSortedRepos.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="text-2xs uppercase tracking-wider text-text-tertiary font-semibold">
              {t('welcome.allRepos')}
              <span className="ml-2 text-text-tertiary/70 font-normal normal-case">
                {t('shell.countOf', { count: filteredRepos.length, total: allSortedRepos.length })}
              </span>
            </div>
          </div>
          {/* Search input */}
          <div className="relative mb-3">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              className="w-full text-sm pl-9 pr-8 py-2 bg-bg-secondary border border-border-default rounded-lg focus:outline-none focus:border-accent transition-colors"
              placeholder={t('welcome.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus={allSortedRepos.length > 8}
            />
            {search && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 icon-btn !w-6 !h-6"
                title={t('shell.clearSearch')}
                onClick={() => setSearch('')}
              >
                <X size={11} />
              </button>
            )}
          </div>
          <div className="bg-bg-secondary border border-border-default rounded-lg overflow-hidden shadow-sm max-h-[60vh] overflow-y-auto">
            {filteredRepos.length === 0 ? (
              <div className="px-4 py-8 text-center text-text-tertiary text-sm">
                <Search size={20} className="mx-auto mb-2 opacity-40" />
                {t('welcome.noMatch', { search })}
              </div>
            ) : (
              filteredRepos.map((repo, i) => {
                const meta = safeMeta[repo.path];
                return (
                  <button
                    key={repo.path}
                    onClick={() => openRepository && openRepository(repo.path)}
                    className={`w-full group flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left ${
                      i > 0 ? 'border-t border-border-subtle' : ''
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-bg-tertiary border border-border-default flex items-center justify-center flex-shrink-0 group-hover:border-accent group-hover:bg-accent-muted transition-colors">
                      <Folder size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {repo.name}
                        </span>
                        {meta?.favorite && (
                          <Star size={11} className="text-status-modified fill-current flex-shrink-0" />
                        )}
                        {meta?.tags && meta.tags.length > 0 && (
                          <span className="flex gap-1 flex-shrink-0">
                            {meta.tags.slice(0, 3).map(t => (
                              <span key={t} className="text-2xs text-text-tertiary px-1.5 py-0.5 rounded-full bg-bg-tertiary">
                                {t}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-tertiary font-mono truncate">{repo.path}</div>
                    </div>
                    {meta?.color && (
                      <span
                        className="w-1 self-stretch rounded-full"
                        style={{ backgroundColor: meta.color }}
                      />
                    )}
                    <ChevronRight
                      size={14}
                      className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    />
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Feature highlights */}
      <div className="max-w-2xl mx-auto px-6 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="bg-bg-secondary border border-border-default rounded-lg p-4 hover:border-border-strong transition-colors"
              >
                <div className="w-8 h-8 rounded-md bg-accent-muted flex items-center justify-center mb-2">
                  <Icon size={15} className="text-accent" />
                </div>
                <div className="text-sm font-medium text-text-primary mb-1">{f.title}</div>
                <div className="text-xs text-text-tertiary leading-relaxed">{f.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
