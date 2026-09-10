import { useState } from 'react';
import { useOperationLogStore, type OperationLog } from '../stores/operationLogStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { Check, X, ChevronDown, ChevronRight, Trash, Loader } from './icons';
import { cn } from '../lib/utils';

/**
 * Command Log Panel
 * =================
 *
 * Collapsible panel at the bottom of the app showing a timestamped history
 * of all Git commands executed by PrismGit. Each entry shows:
 *   - status icon (spinner=running, ✓=success, ✗=error)
 *   - timestamp
 *   - action name (e.g. "Push", "Pull (Merge)", "Commit")
 *   - expandable details: the underlying git command + result
 *
 * Similar to SmartGit's "Output" view and VS Code's "Output" panel.
 * Toggled via a button in the StatusBar or Ctrl+Shift+L.
 */

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const mm = m.toString().padStart(2, '0');
  return `${h12}:${mm} ${ampm}`;
}

function StatusIcon({ status }: { status: OperationLog['status'] }) {
  if (status === 'running') {
    return <Loader size={12} className="spin text-accent flex-shrink-0" />;
  }
  if (status === 'success') {
    return (
      <span className="flex-shrink-0 w-4 h-4 rounded-full bg-status-added/20 flex items-center justify-center">
        <Check size={10} className="text-status-added" />
      </span>
    );
  }
  // error
  return (
    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-status-deleted/20 flex items-center justify-center">
      <X size={10} className="text-status-deleted" />
    </span>
  );
}

function LogEntry({ op }: { op: OperationLog }) {
  const [expanded, setExpanded] = useState(false);
  const currentRepo = useRepositoryStore((s) => s.currentRepo);

  const isCurrentRepo = currentRepo?.path === op.repoPath;
  const repoName = op.repoPath.split('/').pop() || op.repoPath;

  return (
    <div
      className={cn(
        'border-b border-border-subtle',
        !isCurrentRepo && 'opacity-60'
      )}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand/collapse arrow */}
        <span className="w-3 flex-shrink-0 text-text-tertiary">
          {(op.command || op.result || op.error) ? (
            expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
          ) : null}
        </span>
        {/* Status icon */}
        <StatusIcon status={op.status} />
        {/* Timestamp */}
        <span className="text-2xs text-text-tertiary font-mono flex-shrink-0">
          [{formatTime(op.timestamp)}]
        </span>
        {/* Action name */}
        <span className={cn(
          'text-xs font-medium flex-shrink-0',
          op.status === 'error' ? 'text-status-deleted' : 'text-text-primary'
        )}>
          {op.action}
        </span>
        {/* Repo name (if different from current) */}
        {!isCurrentRepo && (
          <span className="text-2xs text-text-tertiary truncate">· {repoName}</span>
        )}
        {/* Duration (if completed) */}
        {op.duration !== undefined && (
          <span className="text-2xs text-text-tertiary ml-auto flex-shrink-0">
            {op.duration < 1000 ? `${op.duration}ms` : `${(op.duration / 1000).toFixed(1)}s`}
          </span>
        )}
      </button>
      {/* Expanded details */}
      {expanded && (op.command || op.result || op.error) && (
        <div className="px-6 py-2 bg-bg-tertiary/50 text-2xs space-y-1">
          {op.command && (
            <div>
              <span className="text-text-tertiary">Command: </span>
              <code className="font-mono text-text-secondary">{op.command}</code>
            </div>
          )}
          {op.repoPath && (
            <div>
              <span className="text-text-tertiary">Directory: </span>
              <code className="font-mono text-text-secondary">{op.repoPath}</code>
            </div>
          )}
          {op.result && (
            <div>
              <span className="text-text-tertiary">Result: </span>
              <span className="text-status-added">{op.result}</span>
            </div>
          )}
          {op.error && (
            <div>
              <span className="text-text-tertiary">Error: </span>
              <span className="text-status-deleted">{op.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CommandLogPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const ops = useOperationLogStore((s) => s.ops);
  const clearLog = useOperationLogStore((s) => s.clearLog);
  const runningIds = useOperationLogStore((s) => s.runningIds);
  const runningCount = runningIds.size;

  return (
    <div className="flex flex-col bg-bg-secondary border-t border-border-default flex-shrink-0"
      style={{ height: 220 }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-tertiary border-b border-border-default">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Output
          </span>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-2xs text-accent">
              <Loader size={10} className="spin" />
              {runningCount} running
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="icon-btn !w-6 !h-6"
            title="Clear log"
            onClick={clearLog}
          >
            <Trash size={11} />
          </button>
          <button
            className="icon-btn !w-6 !h-6"
            title="Close panel"
            onClick={onClose}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {ops.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
            No operations logged yet. Git commands will appear here.
          </div>
        ) : (
          ops.map((op) => (
            <LogEntry key={op.id} op={op} />
          ))
        )}
      </div>
    </div>
  );
}
