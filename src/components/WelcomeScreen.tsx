import { Folder, Plus, Github, BookOpen, Star, ChevronRight, GitBranch, FileText, History, Download } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';

export function WelcomeScreen({
  onClone,
  onInit,
}: {
  onClone?: () => void;
  onInit?: () => void;
}) {
  const openRepo = useRepositoryStore((s) => s.openRepositoryPicker);
  const { repos, metadata, openRepository } = useRepositoryStore();
  // Show up to 5 recent repos — favorites first, stable order otherwise
  const safeRepos = Array.isArray(repos) ? repos : [];
  const safeMeta = metadata || {};
  const recentRepos = [...safeRepos]
    .sort((a, b) => {
      const ma = safeMeta[a.path];
      const mb = safeMeta[b.path];
      if (ma?.favorite && !mb?.favorite) return -1;
      if (!ma?.favorite && mb?.favorite) return 1;
      return 0; // stable — keep insertion order
    })
    .slice(0, 5);

  // Quick feature highlights shown beneath the primary actions
  const features = [
    { icon: History, title: 'Visual Git Graph', desc: 'Multi-branch history with passing-lane layout' },
    { icon: FileText, title: 'Word-level Diffs', desc: 'Side-by-side or unified, with syntax highlighting' },
    { icon: GitBranch, title: 'Branches & Tags', desc: 'Drag-to-merge, multi-select, Git-Flow built in' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      {/* Hero section with gradient backdrop */}
      <div className="relative overflow-hidden">
        {/* Decorative gradient background */}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            background:
              'radial-gradient(circle at 25% 30%, var(--accent) 0%, transparent 50%), radial-gradient(circle at 75% 70%, var(--accent-purple) 0%, transparent 50%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
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
            PrismGit
          </h1>
          <p className="text-sm text-text-secondary mb-8 max-w-md mx-auto leading-relaxed">
            A modern, cross-platform Git client. Open a repository to start
            managing branches, commits, and history.
          </p>

          {/* Three primary actions: Open, Clone, New */}
          <div className="flex flex-col sm:flex-row gap-3 max-w-lg mx-auto">
            <button className="btn btn-primary justify-center flex-1" onClick={openRepo}>
              <Folder size={16} />
              Open Repository
            </button>
            <button
              className="btn btn-secondary justify-center flex-1"
              onClick={() => onClone && onClone()}
            >
              <Download size={16} />
              Clone Repository
            </button>
            <button
              className="btn btn-secondary justify-center flex-1"
              onClick={() => onInit && onInit()}
            >
              <Plus size={16} />
              New Repository
            </button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-text-tertiary">
            <BookOpen size={12} />
            <span>
              Drag folders onto this window to open · Press Ctrl+? for shortcuts
            </span>
          </div>
        </div>
      </div>

      {/* Recent repositories — only show if user has any */}
      {recentRepos.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pb-6">
          <div className="text-2xs uppercase tracking-wider text-text-tertiary font-semibold mb-3 px-1">
            Recent Repositories
          </div>
          <div className="bg-bg-secondary border border-border-default rounded-lg overflow-hidden shadow-sm">
            {recentRepos.map((repo, i) => {
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
            })}
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
