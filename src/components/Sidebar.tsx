import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GitBranch, GitCommit, GitPullRequest, History, Tag, Package, Settings as SettingsIcon, FolderPlus, FolderGit, Pin, PinOff, X, FolderTree, RotateCcw, FileText, Search, Sun, Moon, Star } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { ResizableSplitter, useResizableWidth } from './ResizableSplitter';
import { cn } from '../lib/utils';

interface NavItem {
  path: string;
  label: string;
  icon: typeof GitBranch;
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/changes', label: 'Changes', icon: GitCommit, group: 'Working Tree' },
  { path: '/history', label: 'History', icon: History, group: 'Working Tree' },
  { path: '/diff', label: 'Diff', icon: FileText, group: 'Working Tree' },
  { path: '/annotate', label: 'Annotate', icon: FileText, group: 'Working Tree' },
  { path: '/investigate', label: 'Investigate', icon: Search, group: 'Working Tree' },
  { path: '/blame', label: 'Blame', icon: FileText, group: 'Working Tree' },
  { path: '/journal', label: 'Journal', icon: RotateCcw, group: 'Working Tree' },
  { path: '/gitflow', label: 'Git-Flow', icon: GitBranch, group: 'Workflows' },
  { path: '/pulls', label: 'Pull Requests', icon: GitPullRequest, group: 'Workflows' },
  { path: '/reviews', label: 'Reviews', icon: GitPullRequest, group: 'Workflows' },
  { path: '/branches', label: 'Branches', icon: GitBranch, group: 'Refs' },
  { path: '/tags', label: 'Tags', icon: Tag, group: 'Refs' },
  { path: '/worktrees', label: 'Worktrees', icon: FolderTree, group: 'Refs' },
  { path: '/reflog', label: 'Reflog', icon: RotateCcw, group: 'Refs' },
  { path: '/stashes', label: 'Stashes', icon: GitPullRequest, group: 'Refs' },
  { path: '/submodules', label: 'Submodules', icon: Package, group: 'Refs' },
  { path: '/lfs', label: 'Git LFS', icon: Package, group: 'Refs' },
];

// Tooltips explaining what each tool does — shown on hover
const NAV_TOOLTIPS: Record<string, string> = {
  '/changes': 'Working tree changes (staged + unstaged files). Stage, unstage, commit. Right-click file → View file history',
  '/history': 'Commit graph — multi-branch selection, filters by author/date/path. Click commit → selected everywhere. Right-click → Create Tag/Branch here',
  '/annotate': 'Per-line author annotation for the selected file (who wrote each line)',
  '/investigate': 'Search commits by message, author, hash, or content (-G pattern)',
  '/blame': 'Git blame for a specific file — line-by-line attribution with hash links',
  '/journal': 'Recent activity log (last N commits across all branches)',
  '/gitflow': 'Git-Flow operations: feature/release/hotfix start/finish',
  '/pulls': 'Pull requests from GitHub/GitLab (forge integration)',
  '/reviews': 'Code review queue (distributed reviews)',
  '/branches': 'Branch management — checkout, merge, rebase, rename, delete. Ctrl+click to select for History filter',
  '/tags': 'Tag management — click any tag to jump to its commit in History',
  '/worktrees': 'Worktrees — multiple working directories for the same repo',
  '/reflog': 'Reference log — every HEAD movement, click hash to jump back',
  '/stashes': 'Saved stashes — click hash to view stash commit',
  '/submodules': 'Submodule management — init, update, sync',
  '/lfs': 'Git LFS — large file storage status and operations',
};

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { repos, metadata, currentRepo, openRepository, removeRepo, pinRepo } = useRepositoryStore();
  const [showRepoList, setShowRepoList] = useState(true);
  const { width: sidebarWidth, handleResize: handleSidebarResize } = useResizableWidth(240, 180, 400);
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);

  useEffect(() => {
    if (!currentRepo) {
      setShowRepoList(true);
    }
  }, [currentRepo]);

  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group || 'Other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <>
    <aside
      className="flex flex-col bg-bg-secondary border-r border-border-default flex-shrink-0 no-drag"
      style={{ width: sidebarWidth }}
    >
      {/* Repository switcher */}
      <div className="border-b border-border-default">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            className="flex items-center gap-2 text-sm font-medium hover:text-accent truncate"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRepoList(!showRepoList); }}
          >
            <FolderGit size={14} />
            <span className="truncate">{currentRepo ? currentRepo.name : 'Repositories'}</span>
            {currentRepo && metadata[currentRepo.path]?.favorite && (
              <Star size={11} className="text-status-modified fill-current" />
            )}
          </button>
          <div className="flex items-center gap-1">
            {currentRepo && (
              <button
                className="icon-btn no-drag flex-shrink-0 hover:!text-status-deleted"
                title="Close repository (release memory, stop watcher, clear selections)"
                onClick={(e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (confirm(`Close repository '${currentRepo.name}'?\n\nThis will:\n• Stop file-system watcher\n• Clear git cache\n• Clear all selections\n• Free memory`)) {
                    useRepositoryStore.getState().closeRepository();
                  }
                }}
              >
                <X size={14} />
              </button>
            )}
            <button
              className="icon-btn no-drag flex-shrink-0"
              title="Open another repository..."
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); useRepositoryStore.getState().openRepositoryPicker(); }}
            >
              <FolderPlus size={14} />
            </button>
          </div>
        </div>

        {showRepoList && (
          <div className="max-h-64 overflow-y-auto border-t border-border-subtle">
            {repos.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-tertiary text-center">
                No repositories yet.<br />Click + to add one.
              </div>
            ) : (
              repos.map((repo) => {
                const meta = metadata[repo.path];
                return (
                  <div
                    key={repo.path}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-bg-hover',
                      currentRepo?.path === repo.path && 'bg-bg-active'
                    )}
                    style={meta?.color ? { borderLeft: `2px solid ${meta.color}` } : undefined}
                    onClick={(e) => { e.stopPropagation(); openRepository(repo.path); }}
                    title={repo.path}
                  >
                    <FolderGit size={12} className="text-text-tertiary flex-shrink-0" />
                    <span className="flex-1 truncate">{repo.name}</span>
                    {meta?.favorite && (
                      <Star size={10} className="text-status-modified fill-current flex-shrink-0" />
                    )}
                    {meta?.tags && meta.tags.length > 0 && (
                      <span className="text-2xs text-text-tertiary flex-shrink-0">
                        {meta.tags.length}
                      </span>
                    )}
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5"
                      title={repo.pinned ? 'Unpin' : 'Pin'}
                      onClick={(e) => { e.stopPropagation(); pinRepo(repo.path, !repo.pinned); }}
                    >
                      {repo.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 hover:!text-status-deleted"
                      title="Remove from list"
                      onClick={(e) => { e.stopPropagation(); removeRepo(repo.path); }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {currentRepo ? (
          Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="mb-2">
              <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
                {groupName}
              </div>
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-1.5 text-sm transition-colors cursor-pointer',
                      isActive
                        ? 'bg-accent-muted text-text-primary border-l-2 border-accent'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-l-2 border-transparent'
                    )}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNavigate(item.path); }}
                    title={NAV_TOOLTIPS[item.path] || item.label}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <div className="px-3 py-4 text-xs text-text-tertiary">
            Open a repository to access Git operations
          </div>
        )}
      </nav>

      {/* Bottom: theme toggle + settings */}
      <div className="border-t border-border-default p-2 space-y-1">
        <button
          className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTheme(); }}
          title="Toggle theme (Ctrl+Shift+T)"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
        </button>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 text-sm rounded transition-colors cursor-pointer',
            location.pathname === '/settings'
              ? 'bg-bg-active text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNavigate('/settings'); }}
        >
          <SettingsIcon size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
    <ResizableSplitter direction="horizontal" onResize={handleSidebarResize} />
    </>
  );
}
