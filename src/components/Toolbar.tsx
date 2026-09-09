import { useState } from 'react';
import { RefreshCw, GitBranch, ArrowUp, ArrowDown, GitCommit, GitPullRequest, CloudDownload, Sync, ExternalLink, Folder, AlertCircle, Search, Sun, Moon, GitMerge, RotateCcw, Star, Plus, Minus, Trash, Settings as SettingsIcon, X, EyeOff } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

// Default visible groups — user can toggle these via the customize button
const DEFAULT_TOOLBAR_GROUPS = {
  sync: true,
  stage: true,
  stash: true,
  log: true,
  workflows: true,
  utils: true,
};

function loadToolbarGroups(): typeof DEFAULT_TOOLBAR_GROUPS {
  try {
    const raw = localStorage.getItem('toolbar-groups');
    if (raw) return { ...DEFAULT_TOOLBAR_GROUPS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_TOOLBAR_GROUPS;
}
function saveToolbarGroups(g: typeof DEFAULT_TOOLBAR_GROUPS) {
  try { localStorage.setItem('toolbar-groups', JSON.stringify(g)); } catch { /* ignore */ }
}

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
  // Toolbar customization state
  const [groups, setGroups] = useState(loadToolbarGroups);
  const [showCustomize, setShowCustomize] = useState(false);
  const setGroup = (key: keyof typeof DEFAULT_TOOLBAR_GROUPS, value: boolean) => {
    const next = { ...groups, [key]: value };
    setGroups(next);
    saveToolbarGroups(next);
  };

  const disabled = !currentRepo;

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

      {/* Git action buttons — compact, icon-only, customizable visibility */}
      <div className="flex items-center no-drag">
        {groups.sync && (
          <>
            <IconButton icon={ArrowDown} onClick={handlePull} disabled={disabled} title="Pull" />
            <IconButton icon={Sync} onClick={handleSynchronize} disabled={disabled} title="Sync (fetch+pull+push)" />
            <IconButton icon={ArrowUp} onClick={handlePush} disabled={disabled} title="Push" />
            <Divider />
          </>
        )}

        {groups.stage && (
          <>
            <IconButton icon={Plus} onClick={() => currentRepo && useGitStore.getState().stageAll(currentRepo.path)} disabled={disabled} title="Stage All" />
            <IconButton icon={Minus} onClick={() => currentRepo && api.git.raw(currentRepo.path, ['reset', 'HEAD', '--', '.'])} disabled={disabled} title="Unstage All" />
            <IconButton icon={Trash} onClick={() => {
              if (!currentRepo || !confirm('Discard all uncommitted changes?')) return;
              api.git.raw(currentRepo.path, ['checkout', '--', '.']).then(() => {
                toast.success('Changes discarded'); refreshStatus(currentRepo.path);
              }).catch((e) => toast.error('Discard failed', String(e)));
            }} disabled={disabled} title="Discard All" />
            <Divider />
          </>
        )}

        {groups.stash && (
          <>
            <IconButton icon={CloudDownload} onClick={() => {
              if (!currentRepo) return;
              api.git.stashPush(currentRepo.path, undefined, true).then(() => {
                toast.success('Stash saved'); refreshStatus(currentRepo.path);
              }).catch((e) => toast.error('Stash failed', String(e)));
            }} disabled={disabled} title="Save Stash" />
            <IconButton icon={GitPullRequest} onClick={() => {
              if (!currentRepo) return;
              api.git.stashList(currentRepo.path).then(stashes => {
                if (stashes.length === 0) { toast.info('No stashes'); return; }
                api.git.stashApply(currentRepo.path, 0).then(() => {
                  toast.success('Stash applied'); refreshStatus(currentRepo.path);
                }).catch((e) => toast.error('Apply failed', String(e)));
              });
            }} disabled={disabled} title="Apply Stash" />
            <Divider />
          </>
        )}

        {groups.log && (
          <>
            <IconButton icon={GitBranch} onClick={() => { window.location.hash = '#/history'; }} disabled={disabled} title="Log" />
            <IconButton icon={Search} onClick={() => { window.location.hash = '#/blame'; }} disabled={disabled} title="Blame" />
            <IconButton icon={Search} onClick={() => { window.location.hash = '#/investigate'; }} disabled={disabled} title="Investigate" />
            <Divider />
          </>
        )}

        {groups.workflows && (
          <>
            <IconButton icon={GitMerge} onClick={() => onGitFlow && onGitFlow()} disabled={disabled} title="Git-Flow" />
            <IconButton icon={RotateCcw} onClick={() => onInteractiveRebase && onInteractiveRebase()} disabled={disabled} title="Rebase" />
          </>
        )}
      </div>

      {/* Center: branch info + global selections (draggable area) */}
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
            <button
              className="flex items-center gap-1 text-text-secondary hover:text-text-primary cursor-pointer"
              onClick={() => { window.location.hash = '#/history'; }}
              title="Current HEAD — click to view in History"
            >
              <GitBranch size={11} />
              <span className="font-medium text-text-primary">{status.current || 'HEAD'}</span>
            </button>
            {status.tracking && <span className="text-text-tertiary">→ {status.tracking}</span>}
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
        {/* HEAD commit indicator — always visible, clickable to jump to History */}
        {currentRepo && (
          <button
            className="text-2xs px-1.5 py-0.5 rounded border border-border-default bg-bg-tertiary font-mono hover:bg-accent-muted hover:border-accent hover:text-accent transition-colors flex items-center gap-1"
            title="Current HEAD commit — click to view in History"
            onClick={async () => {
              try {
                const h = await api.git.revParse(currentRepo.path, 'HEAD');
                useSelectionStore.getState().selectCommit(h.trim());
                window.location.hash = '#/history';
              } catch (e) {
                toast.error('Failed to get HEAD', String(e));
              }
            }}
          >
            <GitCommit size={9} />
            <span>HEAD</span>
          </button>
        )}
        {/* Global selections chips — show what's currently selected across the app */}
        {selectedCommitHash && (
          <span className="text-2xs px-1.5 py-0.5 rounded border border-accent/40 bg-accent-muted text-accent flex items-center gap-1" title={`Selected commit (from any tool): ${selectedCommitHash}`}>
            <GitCommit size={9} />{selectedCommitHash.substring(0, 7)}
            <button onClick={() => useSelectionStore.getState().selectCommit(null)} title="Clear selection">
              <X size={8} />
            </button>
          </span>
        )}
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
              Toolbar editor — drag to reorder, click eye to hide
            </div>
            <div className="py-1 max-h-72 overflow-y-auto">
              {/* Visible groups — drag-and-drop reorder */}
              <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">Visible</div>
              {(Object.keys(groups) as Array<keyof typeof DEFAULT_TOOLBAR_GROUPS>)
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
                      const draggedKey = e.dataTransfer.getData('text/toolbar-group') as keyof typeof DEFAULT_TOOLBAR_GROUPS;
                      if (!draggedKey || draggedKey === key) return;
                      // Reorder groups: swap positions
                      const groupKeys = Object.keys(groups) as Array<keyof typeof DEFAULT_TOOLBAR_GROUPS>;
                      const draggedIdx = groupKeys.indexOf(draggedKey);
                      const targetIdx = groupKeys.indexOf(key);
                      if (draggedIdx === -1 || targetIdx === -1) return;
                      // Build new ordered groups object
                      const newOrdered: Record<string, boolean> = {};
                      const reordered = [...groupKeys];
                      reordered.splice(draggedIdx, 1);
                      reordered.splice(targetIdx, 0, draggedKey);
                      for (const k of reordered) newOrdered[k] = groups[k as keyof typeof DEFAULT_TOOLBAR_GROUPS];
                      setGroups(newOrdered as typeof DEFAULT_TOOLBAR_GROUPS);
                      saveToolbarGroups(newOrdered as typeof DEFAULT_TOOLBAR_GROUPS);
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
              {/* Hidden groups */}
              {(Object.keys(groups) as Array<keyof typeof DEFAULT_TOOLBAR_GROUPS>)
                .filter(key => !groups[key]).length > 0 && (
                <>
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary border-t border-border-subtle">Hidden</div>
                  {(Object.keys(groups) as Array<keyof typeof DEFAULT_TOOLBAR_GROUPS>)
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
                onClick={() => { setGroups(DEFAULT_TOOLBAR_GROUPS); saveToolbarGroups(DEFAULT_TOOLBAR_GROUPS); }}>
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
