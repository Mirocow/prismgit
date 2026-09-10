import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore } from '../stores/toastStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { memo, useEffect, useState, useCallback } from 'react';
import { ArrowUp, ArrowDown, Loader, ChevronUp, ChevronDown } from './icons';
import { useContextMenu } from '../lib/useContextMenu';
import { buildHashMenu, runHashMenuAction } from '../lib/commitMenu';
import { describePushResult } from '../lib/pushResult';

/**
 * Clickable commit hash — clicking jumps to History and focuses that commit.
 * Used everywhere (StatusBar, Tags, Reflog, Stashes, journal, detail panel) for
 * cross-tool navigation.
 *
 * Implementation notes:
 * - Sets selectedCommitHash in global store (History subscribes to it)
 * - Navigates to /history via window.location.hash (only if not already there)
 * - History's useEffect on selectedCommitHash will auto-scroll to the commit
 *   if it's already in the loaded list, otherwise the next loadHistory() will
 *   include it (or user can search by hash)
 * - Right-click opens a context menu (Copy Short/Full Hash, View in History,
 *   Open in Browser) — "right-click must work on every UI element"
 * - Pass `plain` for the compact in-row look (no badge chrome)
 */
export const CommitHashLink = memo(function CommitHashLink({ hash, short = true, className, plain = false, display }: {
  hash: string;
  short?: boolean;
  className?: string;
  /** Compact flat style for dense rows (History list). */
  plain?: boolean;
  /** Override the visible text (e.g. git's own abbrev length). */
  display?: string;
}) {
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const repo = useRepositoryStore((s) => s.currentRepo);
  const showContextMenu = useContextMenu();
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't let the row's own click handler also fire — the hash targets its
    // own commit (same behavior as clicking a parent hash in PARENTS).
    e.stopPropagation();
    // Set global selection FIRST — History's useEffect will pick this up
    // and scroll to the commit if it's already loaded, or trigger a reload.
    selectCommit(hash);
    if (!window.location.hash.startsWith('#/history')) {
      window.location.hash = '#/history';
    }
  }, [hash, selectCommit]);
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(buildHashMenu({ hash, repoPath: repo?.path }), (id) =>
      runHashMenuAction(id, { hash, repoPath: repo?.path }));
  }, [hash, repo, showContextMenu]);
  const displayText = display ?? (short ? hash.substring(0, 7) : hash);
  return (
    <code
      className={cn(
        plain
          ? 'font-mono text-2xs cursor-pointer hover:text-accent transition-colors'
          : 'font-mono text-2xs px-1 py-0.5 rounded bg-bg-tertiary border border-border-subtle cursor-pointer hover:bg-accent-muted hover:border-accent hover:text-accent transition-colors',
        className,
      )}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`Click to view commit ${hash} in History`}
    >
      {displayText}
    </code>
  );
});

export function StatusBar({
  showCommandLog,
  onToggleCommandLog,
}: {
  showCommandLog?: boolean;
  onToggleCommandLog?: () => void;
}) {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const status = useGitStore((s) => s.status);
  const lastRefresh = useGitStore((s) => s.lastRefresh);
  // Global selected commit — visible from anywhere in the app
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const toast = useToastStore();
  // Running operations — show a spinner + progress in the status bar
  const runningIds = useOperationLogStore((s) => s.runningIds);
  const ops = useOperationLogStore((s) => s.ops);
  const runningCount = runningIds.size;
  const currentRunningOp = ops.find((o) => runningIds.has(o.id));

  // HEAD commit hash — fetch once when branch changes
  const [headHash, setHeadHash] = useState<string | null>(null);
  useEffect(() => {
    if (!currentRepo || !status?.current) {
      setHeadHash(null);
      return;
    }
    api.git.revParse(currentRepo.path, 'HEAD')
      .then(h => setHeadHash(h.trim()))
      .catch(() => setHeadHash(null));
  }, [currentRepo, status?.current]);

  if (!currentRepo) {
    return (
      <footer className="h-7 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-status-success inline-block" />
          Ready
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden sm:inline">
            Press <kbd>Ctrl</kbd>+<kbd>?</kbd> for shortcuts
          </span>
          <span className="font-mono">PrismGit v2.0</span>
        </span>
      </footer>
    );
  }

  const changed = status?.files.length ?? 0;
  const staged = status?.staged.length ?? 0;

  return (
    <footer className="h-7 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* HEAD indicator — always visible, shows where you are */}
        {status?.current && headHash && (
          <span className="flex items-center gap-1.5" title="Current HEAD">
            <span className="text-accent font-semibold tracking-wide">HEAD</span>
            <span className="text-text-tertiary">→</span>
            <span className="text-text-primary font-medium">{status.current}</span>
            <CommitHashLink hash={headHash} />
          </span>
        )}
        {/* Selected commit (if different from HEAD) */}
        {selectedCommitHash && selectedCommitHash !== headHash && (
          <span className="flex items-center gap-1.5" title="Globally selected commit (from any tool)">
            <span className="text-text-tertiary">selected:</span>
            <CommitHashLink hash={selectedCommitHash} />
            <button
              className="text-text-tertiary hover:text-text-primary transition-colors px-1"
              onClick={() => selectCommit(null)}
              title="Clear selection"
            >
              ✕
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Running operation indicator — spinner + action name */}
        {runningCount > 0 && currentRunningOp ? (
          <span className="flex items-center gap-1.5 text-accent" title={currentRunningOp.command || currentRunningOp.action}>
            <Loader size={10} className="spin" />
            <span className="text-2xs font-medium">{currentRunningOp.action}</span>
            {runningCount > 1 && (
              <span className="text-2xs text-text-tertiary">+{runningCount - 1} more</span>
            )}
          </span>
        ) : (
          /* Clickable counters — quick jump to the working tree */
          <button
            className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer px-1 rounded"
            onClick={() => { window.location.hash = '#/changes'; }}
            title="Open Changes (Ctrl+1)"
          >
            {staged > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-added inline-block" />
                {staged} staged
              </span>
            )}
            {changed > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-modified inline-block" />
                {changed} changed
              </span>
            )}
          </button>
        )}
        {/* Ahead / behind — click to push / pull (VS Code-style sync buttons) */}
        {status?.ahead ? (
          <button
            className="text-status-added flex items-center gap-0.5 font-medium hover:bg-bg-hover rounded px-1 py-0.5 transition-colors cursor-pointer"
            onClick={() => {
              if (!currentRepo) return;
              useGitStore.getState().push(currentRepo.path)
                .then((res) => {
                  const t = describePushResult(res);
                  if (t.kind === 'error') toast.error(t.title, t.detail);
                  else if (t.kind === 'info') toast.info(t.title, t.detail);
                  else toast.success(t.title, t.detail);
                })
                .catch((e) => toast.error('Push failed', String(e)));
            }}
            title={`${status.ahead} commit(s) ahead — click to push`}
          >
            <ArrowUp size={9} />{status.ahead}
          </button>
        ) : null}
        {status?.behind ? (
          <button
            className="text-status-modified flex items-center gap-0.5 font-medium hover:bg-bg-hover rounded px-1 py-0.5 transition-colors cursor-pointer"
            onClick={() => {
              if (!currentRepo) return;
              useGitStore.getState().pull(currentRepo.path)
                .then(() => toast.success('Pulled successfully'))
                .catch((e) => toast.error('Pull failed', String(e)));
            }}
            title={`${status.behind} commit(s) behind — click to pull`}
          >
            <ArrowDown size={9} />{status.behind}
          </button>
        ) : null}
        {lastRefresh > 0 && (
          <button
            className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => currentRepo && useGitStore.getState().refreshStatus(currentRepo.path)}
            title="Refresh status (F5)"
          >
            updated {new Date(lastRefresh).toLocaleTimeString()}
          </button>
        )}
        {/* Command Log toggle button */}
        <button
          className="flex items-center gap-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer px-1"
          onClick={() => onToggleCommandLog && onToggleCommandLog()}
          title="Toggle Output panel (Ctrl+Shift+L)"
        >
          {showCommandLog ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          <span className="text-2xs">Output</span>
        </button>
      </div>
    </footer>
  );
}
