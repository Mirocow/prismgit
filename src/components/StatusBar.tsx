import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useEffect, useState } from 'react';

/**
 * Clickable commit hash — clicking jumps to History and tries to focus that commit.
 * Used everywhere (StatusBar, Tags, Reflog, Stashes) for cross-tool navigation.
 */
export function CommitHashLink({ hash, short = true, className }: {
  hash: string;
  short?: boolean;
  className?: string;
}) {
  const toast = useToastStore();
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const handleClick = () => {
    // Set global selection
    selectCommit(hash);
    // Navigate to History
    window.location.hash = '#/history';
    toast.info(`Jumped to commit ${hash.substring(0, 7)}`);
  };
  const display = short ? hash.substring(0, 7) : hash;
  return (
    <code
      className={cn('font-mono text-2xs px-1 py-0.5 rounded bg-bg-tertiary border border-border-subtle cursor-pointer hover:bg-accent-muted hover:border-accent hover:text-accent transition-colors', className)}
      onClick={handleClick}
      title={`Click to view commit ${hash} in History`}
    >
      {display}
    </code>
  );
}

export function StatusBar() {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const status = useGitStore((s) => s.status);
  const lastRefresh = useGitStore((s) => s.lastRefresh);
  // Global selected commit — visible from anywhere in the app
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const selectCommit = useSelectionStore((s) => s.selectCommit);

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
      <footer className="h-6 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
        <span>Ready</span>
        <span>SmartGit Electron v1.0</span>
      </footer>
    );
  }

  const changed = status?.files.length ?? 0;
  const staged = status?.staged.length ?? 0;

  return (
    <footer className="h-6 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* HEAD indicator — always visible, shows where you are */}
        {status?.current && headHash && (
          <span className="flex items-center gap-1.5" title="Current HEAD">
            <span className="text-accent font-medium">HEAD</span>
            <span className="text-text-secondary">→</span>
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
              className="text-text-tertiary hover:text-text-primary"
              onClick={() => selectCommit(null)}
              title="Clear selection"
            >
              ✕
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {staged > 0 && <span>{staged} staged</span>}
        {changed > 0 && <span>{changed} changed</span>}
        {status?.ahead ? <span className="text-status-added">↑{status.ahead}</span> : null}
        {status?.behind ? <span className="text-status-modified">↓{status.behind}</span> : null}
        {lastRefresh > 0 && (
          <span>updated {new Date(lastRefresh).toLocaleTimeString()}</span>
        )}
      </div>
    </footer>
  );
}
