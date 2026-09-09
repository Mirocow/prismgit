import { RefreshCw, GitBranch, ArrowUp, ArrowDown, GitCommit, GitPullRequest, CloudDownload, Sync, ExternalLink, Folder, AlertCircle, Search, Sun, Moon, GitMerge, RotateCcw, Star } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSettingsStore } from '../stores/settingsStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

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

  const handleRefresh = () => {
    if (!currentRepo) return;
    refreshStatus(currentRepo.path);
  };

  const handlePush = async () => {
    if (!currentRepo) return;
    try {
      await push(currentRepo.path);
      toast.success('Pushed successfully');
    } catch (e) {
      toast.error('Push failed', String(e));
    }
  };

  const handlePull = async () => {
    if (!currentRepo) return;
    try {
      await pull(currentRepo.path);
      toast.success('Pulled successfully');
    } catch (e) {
      toast.error('Pull failed', String(e));
    }
  };

  const handleFetch = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      toast.success('Fetch completed');
    } catch (e) {
      toast.error('Fetch failed', String(e));
    }
  };

  const handleSynchronize = async () => {
    if (!currentRepo) return;
    try {
      await fetch(currentRepo.path, undefined, true);
      await pull(currentRepo.path);
      await push(currentRepo.path);
      toast.success('Synchronized successfully');
    } catch (e) {
      toast.error('Synchronize failed', String(e));
    }
  };

  const handleOpenInBrowser = async () => {
    if (!currentRepo) return;
    try {
      const info = await api.git.extractRepoInfo(currentRepo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        api.app.openExternal(info.webUrl);
      } else {
        toast.info('Repository has no remote URL');
      }
    } catch (e) {
      toast.error('Failed to open in browser', String(e));
    }
  };

  const handleRevealInFileManager = async () => {
    if (!currentRepo) return;
    try {
      await api.git.revealInFileManager(currentRepo.path);
    } catch (e) {
      toast.error('Failed to reveal in file manager', String(e));
    }
  };

  const isMerging = status?.isMerging;
  const isRebasing = status?.isRebasing;
  const isCherryPicking = status?.isCherryPicking;
  const isReverting = status?.isReverting;
  const isBisecting = status?.isBisecting;
  const isInProgress = isMerging || isRebasing || isCherryPicking || isReverting;

  return (
    <header className="titlebar-drag flex items-center gap-1 px-2 h-10 bg-bg-tertiary border-b border-border-default flex-shrink-0">
      <div className="flex items-center gap-1 no-drag">
        <button
          className={cn('icon-btn', !currentRepo && 'opacity-50')}
          title="Refresh"
          onClick={handleRefresh}
          disabled={!currentRepo}
        >
          <RefreshCw size={14} />
        </button>
        <div className="w-px h-5 bg-border-default mx-1" />
        <button
          className="icon-btn"
          title="Fetch (with prune)"
          onClick={handleFetch}
          disabled={!currentRepo}
        >
          <CloudDownload size={14} />
        </button>
        <button
          className="icon-btn"
          title="Pull"
          onClick={handlePull}
          disabled={!currentRepo}
        >
          <GitPullRequest size={14} />
        </button>
        <button
          className="icon-btn"
          title="Push"
          onClick={handlePush}
          disabled={!currentRepo}
        >
          <GitCommit size={14} />
        </button>
        <button
          className="icon-btn"
          title="Synchronize (fetch + pull + push)"
          onClick={handleSynchronize}
          disabled={!currentRepo}
        >
          <Sync size={14} />
        </button>
        <div className="w-px h-5 bg-border-default mx-1" />
        <button
          className="icon-btn"
          title="Git-Flow (Ctrl+Shift+G)"
          onClick={() => onGitFlow && onGitFlow()}
          disabled={!currentRepo}
        >
          <GitMerge size={14} />
        </button>
        <button
          className="icon-btn"
          title="Interactive Rebase (Ctrl+Shift+R)"
          onClick={() => onInteractiveRebase && onInteractiveRebase()}
          disabled={!currentRepo}
        >
          <RotateCcw size={14} />
        </button>
        <div className="w-px h-5 bg-border-default mx-1" />
        <button
          className="icon-btn"
          title="Repository info (description, tags, notes)"
          onClick={() => onRepoInfo && onRepoInfo()}
          disabled={!currentRepo}
        >
          <Star
            size={14}
            className={currentMetadata?.favorite ? 'text-status-modified fill-current' : ''}
          />
        </button>
        <button
          className="icon-btn"
          title="Find object (Ctrl+F)"
          onClick={() => onFind && onFind()}
          disabled={!currentRepo}
        >
          <Search size={14} />
        </button>
        <button
          className="icon-btn"
          title="Open in browser"
          onClick={handleOpenInBrowser}
          disabled={!currentRepo}
        >
          <ExternalLink size={14} />
        </button>
        <button
          className="icon-btn"
          title="Reveal in file manager"
          onClick={handleRevealInFileManager}
          disabled={!currentRepo}
        >
          <Folder size={14} />
        </button>
        <div className="w-px h-5 bg-border-default mx-1" />
        <button
          className="icon-btn"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (Ctrl+Shift+T)`}
          onClick={() => toggleTheme()}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>

      {/* Center: branch info */}
      <div className="flex-1 flex items-center justify-center no-drag">
        {currentRepo && status ? (
          <div className="flex items-center gap-3 text-xs">
            {isInProgress && (
              <span className="badge badge-modified flex items-center gap-1 animate-pulse">
                <AlertCircle size={10} />
                {isMerging ? 'MERGING' : isRebasing ? 'REBASING' : isCherryPicking ? 'CHERRY-PICKING' : 'REVERTING'}
              </span>
            )}
            {isBisecting && (
              <span className="badge badge-modified flex items-center gap-1">
                <AlertCircle size={10} />
                BISECTING
              </span>
            )}
            <div className="flex items-center gap-1 text-text-secondary">
              <GitBranch size={12} />
              <span className="font-medium text-text-primary">
                {status.current || (status.detached ? 'DETACHED' : 'HEAD')}
              </span>
            </div>
            {status.tracking && (
              <span className="text-text-tertiary">→ {status.tracking}</span>
            )}
            {(status.ahead > 0 || status.behind > 0) && (
              <div className="flex items-center gap-2">
                {status.ahead > 0 && (
                  <span className="flex items-center gap-0.5 text-status-added">
                    <ArrowUp size={11} />
                    {status.ahead}
                  </span>
                )}
                {status.behind > 0 && (
                  <span className="flex items-center gap-0.5 text-status-modified">
                    <ArrowDown size={11} />
                    {status.behind}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-text-tertiary">SmartGit Electron</div>
        )}
      </div>

      {/* Right: repo name */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary no-drag">
        {currentRepo && (
          <span className="font-mono truncate max-w-xs" title={currentRepo.path}>
            {currentRepo.path}
          </span>
        )}
      </div>
    </header>
  );
}
