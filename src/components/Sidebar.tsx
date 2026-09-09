import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GitBranch, GitCommit, GitPullRequest, History, Tag, Package, Settings as SettingsIcon, FolderPlus, FolderGit, Pin, PinOff, X, FolderTree, RotateCcw, FileText, Search, Sun, Moon } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
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
  { path: '/investigate', label: 'Investigate', icon: Search, group: 'Working Tree' },
  { path: '/blame', label: 'Blame', icon: FileText, group: 'Working Tree' },
  { path: '/journal', label: 'Journal', icon: RotateCcw, group: 'Working Tree' },
  { path: '/gitflow', label: 'Git-Flow', icon: GitBranch, group: 'Workflows' },
  { path: '/branches', label: 'Branches', icon: GitBranch, group: 'Refs' },
  { path: '/tags', label: 'Tags', icon: Tag, group: 'Refs' },
  { path: '/worktrees', label: 'Worktrees', icon: FolderTree, group: 'Refs' },
  { path: '/reflog', label: 'Reflog', icon: RotateCcw, group: 'Refs' },
  { path: '/stashes', label: 'Stashes', icon: GitPullRequest, group: 'Refs' },
  { path: '/submodules', label: 'Submodules', icon: Package, group: 'Refs' },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { repos, currentRepo, openRepository, removeRepo, pinRepo } = useRepositoryStore();
  const [showRepoList, setShowRepoList] = useState(true);

  useEffect(() => {
    if (!currentRepo) {
      setShowRepoList(true);
    }
  }, [currentRepo]);

  // Group nav items
  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    const g = item.group || 'Other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(item);
    return acc;
  }, {});

  return (
    <aside
      className="flex flex-col bg-bg-secondary border-r border-border-default"
      style={{ width: 240 }}
    >
      {/* Repository switcher */}
      <div className="border-b border-border-default">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            className="flex items-center gap-2 text-sm font-medium hover:text-accent truncate"
            onClick={() => setShowRepoList(!showRepoList)}
          >
            <FolderGit size={14} />
            <span className="truncate">{currentRepo ? currentRepo.name : 'Repositories'}</span>
          </button>
          <button
            className="icon-btn no-drag flex-shrink-0"
            title="Open repository"
            onClick={() => useRepositoryStore.getState().openRepositoryPicker()}
          >
            <FolderPlus size={14} />
          </button>
        </div>

        {showRepoList && (
          <div className="max-h-64 overflow-y-auto border-t border-border-subtle">
            {repos.length === 0 ? (
              <div className="px-3 py-4 text-xs text-text-tertiary text-center">
                No repositories yet.<br />Click + to add one.
              </div>
            ) : (
              repos.map((repo) => (
                <div
                  key={repo.path}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-bg-hover',
                    currentRepo?.path === repo.path && 'bg-bg-active'
                  )}
                  onClick={() => openRepository(repo.path)}
                  title={repo.path}
                >
                  <FolderGit size={12} className="text-text-tertiary flex-shrink-0" />
                  <span className="flex-1 truncate">{repo.name}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5"
                    title={repo.pinned ? 'Unpin' : 'Pin'}
                    onClick={(e) => {
                      e.stopPropagation();
                      pinRepo(repo.path, !repo.pinned);
                    }}
                  >
                    {repo.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 hover:!text-status-deleted"
                    title="Remove from list"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRepo(repo.path);
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))
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
                      'w-full flex items-center gap-3 px-3 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-accent-muted text-text-primary border-l-2 border-accent'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-l-2 border-transparent'
                    )}
                    onClick={() => navigate(item.path)}
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
          onClick={() => useSettingsStore.getState().toggleTheme()}
          title="Toggle theme (Ctrl+Shift+T)"
        >
          {useSettingsStore.getState().theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          <span>{useSettingsStore.getState().theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
        </button>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 text-sm rounded transition-colors',
            location.pathname === '/settings'
              ? 'bg-bg-active text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          )}
          onClick={() => navigate('/settings')}
        >
          <SettingsIcon size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
