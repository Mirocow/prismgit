import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BranchInfo } from '../lib/api';
import { cn } from '../lib/utils';
import { useGitStore } from '../stores/gitStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToolbarStore, DEFAULT_TOOLBAR_GROUPS, type ToolbarGroups, type ToolbarGroupKey } from '../stores/toolbarStore';
import { useToastStore } from '../stores/toastStore';
import { AlertCircle, ArrowDown, ArrowUp, ChevronDown, CloudDownload, ExternalLink, EyeOff, FileText, Folder, GitBranch, GitMerge, GitPullRequest, Minus, Moon, Plus, RefreshCw, RotateCcw, Search, Settings as SettingsIcon, Star, Sun, Trash, X } from './icons';

// Toolbar groups live in a shared zustand store (toolbarStore.ts) so the
// customize editor applies to BOTH toolbars (top row + git actions row) live.
// Default groups & localStorage persistence are handled there.

// Window control buttons — frameless window
function WindowControls() {
  const handleMinimize = () => api.window.minimize();
  const handleMaximize = async () => {
    const isMax = await api.window.isMaximized();
    if (isMax) {
      // Need to unmaximize — call maximize which toggles
      api.window.maximize();
    } else {
      api.window.maximize();
    }
  };
  const handleClose = () => api.window.close();

  return (
    <div className="flex items-center no-drag flex-shrink-0">
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-text-secondary"
        onClick={handleMinimize}
        title="Minimize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-text-secondary"
        onClick={handleMaximize}
        title="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button
        className="flex items-center justify-center w-11 h-9 hover:bg-red-500 hover:text-white transition-colors text-text-secondary"
        onClick={handleClose}
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0,0 L10,10 M10,0 L0,10" stroke="currentColor" strokeWidth="1.2" /></svg>
      </button>
    </div>
  );
}

interface ToolbarProps {
  onFind?: () => void;
  onGitFlow?: () => void;
  onInteractiveRebase?: () => void;
  onRepoInfo?: () => void;
}

export function Toolbar({ onFind, onGitFlow, onInteractiveRebase, onRepoInfo }: ToolbarProps = {}) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const currentMetadata = useRepositoryStore((s) => s.currentMetadata);
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const toast = useToastStore();
  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  // Read global selection — show file-history chip in header if set
  const globalPathFilter = useSelectionStore((s) => s.pathFilter);
  const setGlobalPathFilter = useSelectionStore((s) => s.setPathFilter);
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const selectedBranch = useSelectionStore((s) => s.selectedBranch);
  // Toolbar customization state — shared store, so edits apply to GitToolbar too
  const groups = useToolbarStore((s) => s.groups);
  const setGroup = useToolbarStore((s) => s.setGroup);
  const setGroups = useToolbarStore((s) => s.setGroups);
  const [showCustomize, setShowCustomize] = useState(false);

  const disabled = !currentRepo;
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  // Color constants for icon colors (matching the screenshot style)
  const COLOR_BLUE = '#399ee6';
  const COLOR_GREEN = '#86b300';
  const COLOR_ORANGE = '#f2ae49';
  const COLOR_PURPLE = '#a37acc';
  const COLOR_RED = '#f07171';

  const handlePush = async () => {
    if (!currentRepo) return;
    try { await push(currentRepo.path); toast.success('Pushed successfully'); }
    catch (e) { toast.error('Push failed', String(e)); }
  };
  const handlePull = async () => {
    if (!currentRepo) return;
    try { await pull(currentRepo.path); toast.success('Pulled successfully'); }
    catch (e) { toast.error('Pull failed', String(e)); }
  };
  const handleSynchronize = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      await pull(currentRepo.path);
      await push(currentRepo.path);
      toast.success('Synchronized successfully');
    } catch (e) { toast.error('Synchronize failed', String(e)); }
  };
  const handleOpenInBrowser = async () => {
    if (!currentRepo) return;
    try {
      const info = await api.git.extractRepoInfo(currentRepo.path);
      if (info.webUrl && info.provider !== 'unknown') { api.app.openExternal(info.webUrl); }
      else { toast.info('Repository has no remote URL'); }
    } catch (e) { toast.error('Failed to open in browser', String(e)); }
  };
  const handleRevealInFileManager = async () => {
    if (!currentRepo) return;
    try { await api.git.revealInFileManager(currentRepo.path); }
    catch (e) { toast.error('Failed to reveal in file manager', String(e)); }
  };

  const isInProgress = status?.isMerging || status?.isRebasing || status?.isCherryPicking || status?.isReverting;
  const isBisecting = status?.isBisecting;

  // Compact icon-only button
  const IconButton = ({ icon: Icon, onClick, disabled, title }: {
    icon: typeof RefreshCw; onClick: () => void; disabled?: boolean; title: string;
  }) => (
    <button
      className="flex items-center justify-center w-7 h-7 rounded hover:bg-bg-hover transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={15} />
    </button>
  );

  // Labeled button — icon + text label, flat style like platypusgit
  // iconColor: optional color for the icon (blue/green/orange/purple)
  const LabeledButton = ({ icon: Icon, label, onClick, disabled, title, iconColor, active }: {
    icon: typeof RefreshCw; label: string; onClick: () => void; disabled?: boolean; title: string;
    iconColor?: string; active?: boolean;
  }) => (
    <button
      className={cn(
        'flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs',
        active
          ? 'bg-accent text-text-inverse'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      )}
      style={!active && iconColor ? { color: iconColor } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={14} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  const Divider = () => <div className="w-px h-5 bg-border-subtle mx-1.5" />;

  return (
    <header
      className="flex items-center h-9 bg-bg-tertiary border-b border-border-default flex-shrink-0 select-none titlebar-drag"
    >
      {/* App name (left, like Ollama Code) */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0">
        <span className="text-xs font-semibold text-accent">SmartGit</span>
        {currentRepo && (
          <>
            <span className="text-text-tertiary text-xs">/</span>
            <span className="text-xs text-text-secondary">{currentRepo.name}</span>
          </>
        )}
      </div>

      <Divider />

      {/* Center: status badges + global selections (draggable area) */}
      <div className="flex-1 flex items-center justify-center titlebar-drag gap-2">
        {currentRepo && status ? (
          <div className="flex items-center gap-2 text-xs">
            {isInProgress && (
              <span className="badge badge-modified flex items-center gap-1 animate-pulse">
                <AlertCircle size={9} />
                {status.isMerging ? 'MERGING' : status.isRebasing ? 'REBASING' : 'CHERRY-PICK'}
              </span>
            )}
            {isBisecting && (
              <span className="badge badge-modified flex items-center gap-1">
                <AlertCircle size={9} /> BISECTING
              </span>
            )}
            {(status.ahead > 0 || status.behind > 0) && (
              <div className="flex items-center gap-1.5">
                {status.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-status-added">
                    <ArrowUp size={10} />{status.ahead}
                  </span>
                )}
                {status.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-status-modified">
                    <ArrowDown size={10} />{status.behind}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}
        {selectedBranch && (
          <span className="text-2xs px-1.5 py-0.5 rounded border border-status-added/40 bg-status-added/10 text-status-added flex items-center gap-1" title={`Selected branch: ${selectedBranch}`}>
            <GitBranch size={9} />{selectedBranch}
            <button onClick={() => useSelectionStore.getState().selectBranch(null)} title="Clear branch selection">
              <X size={8} />
            </button>
          </span>
        )}
        {globalPathFilter && (
          <span className="text-2xs px-1.5 py-0.5 rounded border border-status-modified/40 bg-status-modified/10 text-status-modified flex items-center gap-1" title={`File history filter: ${globalPathFilter}`}>
            File: {globalPathFilter}
            <button onClick={() => setGlobalPathFilter(null)} title="Clear file filter">
              <X size={8} />
            </button>
          </span>
        )}
      </div>

      {/* Right: utility buttons + customize */}
      <div className="flex items-center gap-0.5 no-drag pr-2 relative">
        {groups.utils && (
          <>
            <IconButton icon={Star} onClick={() => onRepoInfo && onRepoInfo()} disabled={disabled} title="Repository Info" />
            <IconButton icon={Search} onClick={() => onFind && onFind()} disabled={disabled} title="Find Object (Ctrl+F)" />
            <IconButton icon={ExternalLink} onClick={handleOpenInBrowser} disabled={disabled} title="Open in Browser" />
            <IconButton icon={Folder} onClick={handleRevealInFileManager} disabled={disabled} title="Reveal in File Manager" />
            <Divider />
          </>
        )}
        <IconButton
          icon={theme === 'dark' ? Sun : Moon}
          onClick={() => toggleTheme()}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        />
        {/* Customize toolbar button */}
        <button
          className="flex items-center justify-center w-7 h-7 rounded hover:bg-bg-hover transition-colors no-drag text-text-secondary hover:text-text-primary"
          onClick={() => setShowCustomize(!showCustomize)}
          title="Customize toolbar"
        >
          <SettingsIcon size={15} />
        </button>
        {showCustomize && (
          <div className="absolute top-full right-2 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 min-w-72">
            <div className="px-3 py-2 text-2xs uppercase text-text-tertiary border-b border-border-subtle">
              Toolbar editor — applies to both toolbars · drag to reorder, click eye to hide
            </div>
            <div className="py-1 max-h-72 overflow-y-auto">
              <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">Visible</div>
              {(Object.keys(groups) as Array<ToolbarGroupKey>)
                .filter(key => groups[key])
                .map((key, idx) => (
                  <div
                    key={key}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/toolbar-group', key);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const draggedKey = e.dataTransfer.getData('text/toolbar-group') as ToolbarGroupKey;
                      if (!draggedKey || draggedKey === key) return;
                      const groupKeys = Object.keys(groups) as Array<ToolbarGroupKey>;
                      const draggedIdx = groupKeys.indexOf(draggedKey);
                      const targetIdx = groupKeys.indexOf(key);
                      if (draggedIdx === -1 || targetIdx === -1) return;
                      const newOrdered: Record<string, boolean> = {};
                      const reordered = [...groupKeys];
                      reordered.splice(draggedIdx, 1);
                      reordered.splice(targetIdx, 0, draggedKey);
                      for (const k of reordered) newOrdered[k] = groups[k as ToolbarGroupKey];
                      setGroups(newOrdered as ToolbarGroups);
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-move text-xs"
                    title="Drag to reorder"
                  >
                    <span className="text-text-tertiary">⋮⋮</span>
                    <span className="capitalize flex-1">{key}</span>
                    <button
                      className="text-text-tertiary hover:text-status-deleted"
                      onClick={(e) => { e.stopPropagation(); setGroup(key, false); }}
                      title="Hide this group"
                    >
                      <EyeOff size={11} />
                    </button>
                  </div>
                ))}
              {(Object.keys(groups) as Array<ToolbarGroupKey>)
                .filter(key => !groups[key]).length > 0 && (
                <>
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary border-t border-border-subtle">Hidden</div>
                  {(Object.keys(groups) as Array<ToolbarGroupKey>)
                    .filter(key => !groups[key])
                    .map(key => (
                      <div key={key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover text-xs opacity-60">
                        <span className="text-text-tertiary">⋯</span>
                        <span className="capitalize flex-1">{key}</span>
                        <button
                          className="text-text-tertiary hover:text-status-added"
                          onClick={() => setGroup(key, true)}
                          title="Show this group"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                    ))}
                </>
              )}
            </div>
            <div className="px-3 py-1 border-t border-border-subtle flex justify-between">
              <button className="text-2xs text-accent"
                onClick={() => setGroups(DEFAULT_TOOLBAR_GROUPS)}>
                Reset to default
              </button>
              <button className="text-2xs btn btn-primary !py-0.5 !px-2"
                onClick={() => setShowCustomize(false)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Window controls (frameless) — minimize, maximize, close */}
      <WindowControls />
    </header>
  );
}

/**
 * Push dropdown — button + small chevron that opens a menu with:
 *   - Push to: <branch> (dropdown of local branches)
 *   - [✓] Force push (--force-with-lease)
 *   - Push tags
 */
function PushDropdown({ disabled }: { disabled: boolean }) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [force, setForce] = useState(false);
  const [pushTags, setPushTags] = useState(false);

  useEffect(() => {
    if (!open || !currentRepo) return;
    api.git.branches(currentRepo.path).then(brs => {
      setBranches(brs.filter(b => !b.remote));
      // Default to current branch
      const cur = brs.find(b => b.current);
      setSelectedBranch(cur?.name || '');
    }).catch(() => {});
  }, [open, currentRepo]);

  const doPush = async (branch?: string) => {
    if (!currentRepo) return;
    const b = branch || selectedBranch;
    try {
      await api.git.push(currentRepo.path, 'origin', b || undefined, false, force, pushTags);
      toast.success(`Pushed ${b || 'current'}${force ? ' (force)' : ''}${pushTags ? ' + tags' : ''}`);
      refreshStatus(currentRepo.path);
    } catch (e) {
      toast.error('Push failed', String(e));
    }
    setOpen(false);
    setForce(false);
    setPushTags(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          className="flex items-center gap-1.5 px-2.5 h-7 rounded-l-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          style={{ color: '#86b300' }}
          onClick={() => doPush()}
          disabled={disabled}
          title="Push current branch to origin"
        >
          <ArrowUp size={14} />
          <span className="hidden md:inline">Push</span>
        </button>
        <button
          className="flex items-center px-1 h-7 rounded-r-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover border-l border-border-subtle"
          onClick={() => setOpen(!open)}
          disabled={disabled}
          title="Push options — select branch, force push, tags"
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded-md shadow-lg z-50 min-w-64">
            <div className="px-3 py-2 text-2xs uppercase text-text-tertiary border-b border-border-subtle">
              Push to origin
            </div>
            <div className="p-2">
              <label className="text-2xs text-text-tertiary block mb-1">Branch</label>
              <select
                className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                {branches.map(b => (
                  <option key={b.name} value={b.name}>
                    {b.name}{b.current ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="px-3 py-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <span className="text-status-deleted">Force push (--force-with-lease)</span>
              </label>
            </div>
            <div className="px-3 py-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={pushTags} onChange={(e) => setPushTags(e.target.checked)} />
                <span>Push tags</span>
              </label>
            </div>
            <div className="px-3 py-2 border-t border-border-subtle flex gap-2">
              <button
                className="btn btn-primary text-xs flex-1"
                onClick={() => doPush()}
                disabled={!selectedBranch}
              >
                <ArrowUp size={12} /> Push{force ? ' (force)' : ''}
              </button>
              <button className="btn btn-secondary text-xs" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Pull dropdown — button + small chevron that opens a menu with:
 *   - Pull from: <branch> (dropdown of remote branches)
 *   - [✓] Rebase instead of merge
 *   - [✓] No fast-forward
 */
function PullDropdown({ disabled }: { disabled: boolean }) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [useRebase, setUseRebase] = useState(false);
  const [noFF, setNoFF] = useState(false);

  useEffect(() => {
    if (!open || !currentRepo) return;
    api.git.branches(currentRepo.path).then(brs => {
      const remotes = brs.filter(b => b.remote);
      setBranches(remotes);
      // Default to origin/<current>
      const cur = brs.find(b => b.current);
      if (cur) {
        const match = remotes.find(r => r.name === `origin/${cur.name}`);
        setSelectedBranch(match?.name || remotes[0]?.name || '');
      } else {
        setSelectedBranch(remotes[0]?.name || '');
      }
    }).catch(() => {});
  }, [open, currentRepo]);

  const doPull = async () => {
    if (!currentRepo || !selectedBranch) return;
    try {
      // Extract remote + branch from "origin/branch-name"
      const parts = selectedBranch.split('/');
      const remote = parts[0];
      const branch = parts.slice(1).join('/');
      await api.git.pull(currentRepo.path, remote, branch, useRebase, noFF);
      toast.success(`Pulled from ${selectedBranch}${useRebase ? ' (rebase)' : ''}`);
      refreshStatus(currentRepo.path);
    } catch (e) {
      toast.error('Pull failed', String(e));
    }
    setOpen(false);
    setUseRebase(false);
    setNoFF(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          className="flex items-center gap-1.5 px-2.5 h-7 rounded-l-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          style={{ color: '#399ee6' }}
          onClick={() => doPull()}
          disabled={disabled}
          title="Pull from origin (current branch)"
        >
          <ArrowDown size={14} />
          <span className="hidden md:inline">Pull</span>
        </button>
        <button
          className="flex items-center px-1 h-7 rounded-r-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover border-l border-border-subtle"
          onClick={() => setOpen(!open)}
          disabled={disabled}
          title="Pull options — select branch, rebase, no-ff"
        >
          <ChevronDown size={12} />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded-md shadow-lg z-50 min-w-64">
            <div className="px-3 py-2 text-2xs uppercase text-text-tertiary border-b border-border-subtle">
              Pull from remote
            </div>
            <div className="p-2">
              <label className="text-2xs text-text-tertiary block mb-1">Remote branch</label>
              <select
                className="w-full text-xs px-2 py-1 bg-bg-secondary border border-border-default rounded font-mono"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
              >
                {branches.map(b => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="px-3 py-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={useRebase} onChange={(e) => setUseRebase(e.target.checked)} />
                <span>Rebase instead of merge</span>
              </label>
            </div>
            <div className="px-3 py-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={noFF} onChange={(e) => setNoFF(e.target.checked)} />
                <span>No fast-forward (always create merge commit)</span>
              </label>
            </div>
            <div className="px-3 py-2 border-t border-border-subtle flex gap-2">
              <button
                className="btn btn-primary text-xs flex-1"
                onClick={() => doPull()}
                disabled={!selectedBranch}
              >
                <ArrowDown size={12} /> Pull{useRebase ? ' (rebase)' : ''}
              </button>
              <button className="btn btn-secondary text-xs" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Git Toolbar — second row, below the main Toolbar.
 * Contains the colored git operation buttons (Fetch, Push, Stage, Stash, History, Diff, Blame, Git-Flow, Rebase).
 * This is the toolbar the user wants to be separate from the app-level header.
 */
export function GitToolbar({ onGitFlow, onInteractiveRebase }: { onGitFlow?: () => void; onInteractiveRebase?: () => void } = {}) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const toast = useToastStore();
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  // Shared toolbar groups — the customize editor (gear icon in the top toolbar)
  // controls these live; hiding a group here also removes it from the second row.
  const groups = useToolbarStore((s) => s.groups);

  const disabled = !currentRepo;

  const handlePush = async () => {
    if (!currentRepo) return;
    try { await push(currentRepo.path); toast.success('Pushed successfully'); }
    catch (e) { toast.error('Push failed', String(e)); }
  };
  const handlePull = async () => {
    if (!currentRepo) return;
    try { await pull(currentRepo.path); toast.success('Petched successfully'); }
    catch (e) { toast.error('Fetch failed', String(e)); }
  };

  const COLOR_BLUE = '#399ee6';
  const COLOR_GREEN = '#86b300';
  const COLOR_ORANGE = '#f2ae49';
  const COLOR_PURPLE = '#a37acc';
  const COLOR_RED = '#f07171';

  const LabeledButton = ({ icon: Icon, label, onClick, disabled, title, iconColor, active }: {
    icon: typeof RefreshCw; label: string; onClick: () => void; disabled?: boolean; title: string;
    iconColor?: string; active?: boolean;
  }) => (
    <button
      className={cn(
        'flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-colors no-drag disabled:opacity-30 disabled:cursor-not-allowed text-xs',
        active
          ? 'bg-accent text-text-inverse'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      )}
      style={!active && iconColor ? { color: iconColor } : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon size={14} />
      <span className="hidden md:inline">{label}</span>
    </button>
  );

  const Divider = () => <div className="w-px h-5 bg-border-subtle mx-1.5" />;

  if (!currentRepo) return null;

  // Show conflict resolution button when conflicts exist
  const hasConflicts = status?.conflicted && status.conflicted.length > 0;
  const handleResolveConflicts = () => {
    if (status?.conflicted && status.conflicted.length > 0) {
      // Navigate to Changes and trigger conflict solver on first conflicted file
      navigate('/changes');
      // Set a global event that ChangesPage picks up
      window.dispatchEvent(new CustomEvent('smartgit:resolve-conflict', {
        detail: { file: status.conflicted[0] }
      }));
    }
  };

  return (
    <div className="flex items-center h-8 bg-bg-secondary border-b border-border-default flex-shrink-0 no-drag px-2 gap-0.5">
      {/* Conflict resolution button — only shown when conflicts exist */}
      {hasConflicts && (
        <>
          <button
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-colors no-drag text-xs bg-status-conflict/15 text-status-conflict border border-status-conflict/40 hover:bg-status-conflict/25 font-medium"
            onClick={handleResolveConflicts}
            title={`${status?.conflicted?.length || 0} conflicted file(s) — click to resolve`}
          >
            <AlertCircle size={14} />
            <span>Resolve {status?.conflicted?.length || 0} Conflicts</span>
          </button>
          <Divider />
        </>
      )}
      {(Object.keys(groups) as Array<ToolbarGroupKey>).map(key => {
        if (!groups[key]) return null;
        switch (key) {
          case 'sync':
            return (
              <div key={key} className="flex items-center">
                <PullDropdown disabled={disabled} />
                <PushDropdown disabled={disabled} />
                <Divider />
              </div>
            );
          case 'stage':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={Plus} label="Stage" iconColor={COLOR_GREEN} onClick={() => currentRepo && useGitStore.getState().stageAll(currentRepo.path)} disabled={disabled} title="Stage all changes" />
                <LabeledButton icon={Minus} label="Unstage" iconColor={COLOR_ORANGE} onClick={() => currentRepo && api.git.raw(currentRepo.path, ['reset', 'HEAD', '--', '.'])} disabled={disabled} title="Unstage all changes" />
                <LabeledButton icon={Trash} label="Discard" iconColor={COLOR_RED} onClick={() => {
                  if (!currentRepo || !confirm('Discard all uncommitted changes?')) return;
                  api.git.raw(currentRepo.path, ['checkout', '--', '.']).then(() => {
                    toast.success('Changes discarded'); refreshStatus(currentRepo.path);
                  }).catch((e) => toast.error('Discard failed', String(e)));
                }} disabled={disabled} title="Discard all changes" />
                <Divider />
              </div>
            );
          case 'stash':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={CloudDownload} label="Stash" iconColor={COLOR_PURPLE} onClick={() => {
                  if (!currentRepo) return;
                  api.git.stashPush(currentRepo.path, undefined, true).then(() => {
                    toast.success('Stash saved'); refreshStatus(currentRepo.path);
                  }).catch((e) => toast.error('Stash failed', String(e)));
                }} disabled={disabled} title="Save stash" />
                <LabeledButton icon={GitPullRequest} label="Pop" iconColor={COLOR_PURPLE} onClick={() => {
                  if (!currentRepo) return;
                  api.git.stashList(currentRepo.path).then(stashes => {
                    if (stashes.length === 0) { toast.info('No stashes'); return; }
                    api.git.stashApply(currentRepo.path, 0).then(() => {
                      toast.success('Stash applied'); refreshStatus(currentRepo.path);
                    }).catch((e) => toast.error('Apply failed', String(e)));
                  });
                }} disabled={disabled} title="Apply latest stash" />
                <Divider />
              </div>
            );
          case 'log':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitBranch} label="History" iconColor={COLOR_BLUE} onClick={() => navigate('/history')} disabled={disabled} title="Commit history" active={currentPath === '/history'} />
                <LabeledButton icon={FileText} label="Diff" iconColor={COLOR_BLUE} onClick={() => navigate('/diff')} disabled={disabled} title="Compare files between refs" active={currentPath === '/diff'} />
                <LabeledButton icon={Search} label="Blame" iconColor={COLOR_BLUE} onClick={() => navigate('/blame')} disabled={disabled} title="Blame a file" active={currentPath === '/blame'} />
                <Divider />
              </div>
            );
          case 'workflows':
            return (
              <div key={key} className="flex items-center">
                <LabeledButton icon={GitMerge} label="Git-Flow" iconColor={COLOR_ORANGE} onClick={() => onGitFlow && onGitFlow()} disabled={disabled} title="Git-Flow operations" />
                <LabeledButton icon={RotateCcw} label="Rebase" iconColor={COLOR_ORANGE} onClick={() => onInteractiveRebase && onInteractiveRebase()} disabled={disabled} title="Interactive rebase" />
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
