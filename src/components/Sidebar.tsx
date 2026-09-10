import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings as SettingsIcon, FolderPlus, FolderGit, FolderGitOpen, Folder, Plus, Pin, PinOff, X, Sun, Moon, Star, ChevronDown, ChevronRight } from './icons';
import { NAV_ITEMS, NAV_SHORTCUTS, NAV_DESCRIPTIONS, type NavItem } from './navItems';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useGitStore } from '../stores/gitStore';
import { ResizableSplitter, useResizableWidth } from './ResizableSplitter';
import { cn } from '../lib/utils';
import { confirmDialog, promptDialog } from './ConfirmDialog';

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { repos, metadata, currentRepo, openRepository, removeRepo, pinRepo } = useRepositoryStore();
  const [showRepoList, setShowRepoList] = useState(true);
  const { width: sidebarWidth, handleResize: handleSidebarResize } = useResizableWidth(240, 180, 400);
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  // Live change counters for the Changes badge
  const changedCount = useGitStore((s) => s.status?.files.length ?? 0);
  const stagedCount = useGitStore((s) => s.status?.staged.length ?? 0);
  // Collapsible nav groups — click group header to collapse/expand
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
      className="flex flex-col bg-bg-secondary flex-shrink-0 no-drag"
      style={{ width: sidebarWidth }}
    >
      {/* Repository switcher */}
      <div className="border-b border-border-default">
        <div className="flex items-center justify-between px-3 py-2.5">
          <button
            className="flex items-center gap-2 text-sm font-semibold hover:text-accent truncate transition-colors"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRepoList(!showRepoList); }}
          >
            {showRepoList ? <FolderGitOpen size={15} className="text-accent" /> : <FolderGit size={15} className="text-text-secondary" />}
            <span className="truncate">{currentRepo ? currentRepo.name : 'Repositories'}</span>
            {currentRepo && metadata[currentRepo.path]?.favorite && (
              <Star size={11} className="text-status-modified fill-current" />
            )}
            <ChevronDown
              size={12}
              className={cn('text-text-tertiary transition-transform', showRepoList && 'rotate-180')}
            />
          </button>
          <div className="flex items-center gap-0.5">
            {currentRepo && (
              <button
                className="icon-btn no-drag flex-shrink-0 hover:!text-status-deleted !w-7 !h-7"
                title="Close repository (release memory, stop watcher, clear selections)"
                onClick={async (e) => {
                  e.preventDefault(); e.stopPropagation();
                  if (await confirmDialog({
                    title: `Close repository '${currentRepo.name}'`,
                    message: 'This stops the file-system watcher, clears the git cache and all selections, and frees memory.',
                    confirmLabel: 'Close',
                    danger: true,
                  })) {
                    useRepositoryStore.getState().closeRepository();
                  }
                }}
              >
                <X size={14} />
              </button>
            )}
            <button
              className="icon-btn no-drag flex-shrink-0 !w-7 !h-7"
              title="Open another repository..."
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); useRepositoryStore.getState().openRepositoryPicker(); }}
            >
              <FolderPlus size={14} />
            </button>
          </div>
        </div>

        {showRepoList && (
          <div className="max-h-72 overflow-y-auto border-t border-border-subtle">
            {repos.length === 0 ? (
              <div className="px-3 py-6 text-xs text-text-tertiary text-center">
                <Folder size={20} className="mx-auto mb-2 opacity-40" />
                No repositories yet.<br />Click <Plus size={10} className="inline" /> to add one.
              </div>
            ) : (
              repos.map((repo) => {
                const meta = metadata[repo.path];
                const isActive = currentRepo?.path === repo.path;
                return (
                  <div
                    key={repo.path}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors hover:bg-bg-hover',
                      isActive && 'bg-bg-active'
                    )}
                    style={meta?.color ? { borderLeft: `3px solid ${meta.color}` } : undefined}
                    onClick={(e) => { e.stopPropagation(); openRepository(repo.path); }}
                    title={repo.path}
                  >
                    {isActive ? <FolderGitOpen size={13} className="text-accent flex-shrink-0" /> : <FolderGit size={13} className="text-text-tertiary flex-shrink-0" />}
                    <span className={cn('flex-1 truncate', isActive && 'text-accent font-medium')}>{repo.name}</span>
                    {meta?.favorite && (
                      <Star size={10} className="text-status-modified fill-current flex-shrink-0" />
                    )}
                    {meta?.tags && meta.tags.length > 0 && (
                      <span className="text-2xs text-text-tertiary flex-shrink-0 px-1.5 py-0.5 rounded-full bg-bg-tertiary">
                        {meta.tags.length}
                      </span>
                    )}
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 transition-opacity"
                      title={repo.pinned ? 'Unpin' : 'Pin'}
                      onClick={(e) => { e.stopPropagation(); pinRepo(repo.path, !repo.pinned); }}
                    >
                      {repo.pinned ? <PinOff size={10} /> : <Pin size={10} />}
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 hover:!text-status-deleted transition-opacity"
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
      <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin" role="navigation" aria-label="Main navigation">
        {currentRepo ? (
          Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="mb-3">
              {true && (
                <button
                  className="px-3 py-1 text-2xs font-bold uppercase tracking-wider text-text-tertiary w-full flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
                  role="heading"
                  aria-level={3}
                  onClick={() => {
                    const next = new Set(collapsedGroups);
                    if (next.has(groupName)) next.delete(groupName);
                    else next.add(groupName);
                    setCollapsedGroups(next);
                  }}
                  title={collapsedGroups.has(groupName) ? 'Expand' : 'Collapse'}
                >
                  {collapsedGroups.has(groupName) ? <ChevronRight size={9} /> : <ChevronDown size={9} />}
                  {groupName}
                </button>
              )}
              {!collapsedGroups.has(groupName) && items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                // Changes item gets a live badge; others show their quick-nav key
                const showBadge = item.path === '/changes' && changedCount > 0;
                const shortcut = NAV_SHORTCUTS[item.path];
                return (
                  <button
                    key={item.path}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors cursor-pointer',
                      isActive
                        ? 'bg-accent-muted text-accent font-medium border-l-2 border-accent'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary border-l-2 border-transparent'
                    )}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleNavigate(item.path); }}
                    title={NAV_DESCRIPTIONS[item.path] || item.label}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                  >
                    <Icon size={15} />
                    <span>{item.label}</span>
                    {showBadge ? (
                      <span
                        className={cn(
                          'ml-auto text-2xs font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                          stagedCount > 0 ? 'badge badge-added' : 'bg-accent-muted text-accent'
                        )}
                        title={`${changedCount} file(s) with changes${stagedCount > 0 ? `, ${stagedCount} staged` : ''}`}
                      >
                        {changedCount}
                      </span>
                    ) : shortcut ? (
                      <kbd className="ml-auto text-2xs text-text-tertiary border border-border-subtle rounded px-1 opacity-60">{shortcut}</kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          <div className="px-3 py-4 text-xs text-text-tertiary text-center">
            Open a repository to access Git operations
          </div>
        )}
      </nav>

      {/* Bottom: theme toggle + settings */}
      <div className="border-t border-border-default p-2 space-y-1">
        <button
          className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleTheme(); }}
          title="Toggle theme (Ctrl+Shift+T)"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
        </button>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors cursor-pointer',
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
