import { useEffect, useMemo, useState } from 'react';
import { useOperationLogStore, type OperationLog } from '../stores/operationLogStore';
import { useCommandLogStore } from '../stores/commandLogStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { api, type CommandLogEntry } from '../lib/api';
import { Check, X, ChevronDown, ChevronRight, Trash, Loader, Copy, Terminal, ListChecks, Search } from './icons';
import { cn } from '../lib/utils';

/**
 * Command Log Panel ("Output")
 * ============================
 *
 * Bottom dock with two tabs:
 *
 *   Commands   — raw `git <args>` child processes captured in the MAIN process
 *                (spawn interceptor). Every git invocation the app makes is
 *                here with its real command line, full stdout/stderr, exit
 *                code and duration.
 *   Operations — higher-level app operations (Push, Pull, Commit…) tracked by
 *                operationLogStore, with running/success/error status.
 *
 * Features:
 *   - Commands split into User (mutating: push, pull, commit, checkout, etc.)
 *     and System (read-only: status, log, branches, etc.)
 *   - Default: only User commands shown (toggle to show System)
 *   - Max commands limited (configurable in Settings, default 20)
 *   - Filter/search box for both tabs
 *   - Errors-only toggle for Commands tab
 */

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Commands classified as "user" (mutating) vs "system" (read-only)
const USER_COMMANDS = new Set([
  'add', 'commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'checkout',
  'cherry-pick', 'revert', 'reset', 'stash', 'tag', 'branch', 'clone', 'init',
  'rm', 'mv', 'clean', 'reflog', 'bisect', 'filter-branch', 'submodule',
  'worktree', 'rebase--interactive', 'notes', 'subtree', 'lfs',
  'apply', 'am', 'format-patch', 'send-pack',
]);

function isUserCommand(args: string[]): boolean {
  // First non-option argument is the git subcommand
  const cmd = args.find(a => !a.startsWith('-') && !a.startsWith('core.'));
  return cmd ? USER_COMMANDS.has(cmd) : false;
}

/* ---------------------------------- Commands tab ---------------------------------- */

function CommandStatusDot({ entry }: { entry: CommandLogEntry }) {
  const failed = entry.exitCode !== 0;
  return failed ? (
    <span className="flex-shrink-0 w-3 h-3 rounded-full bg-status-deleted/25 flex items-center justify-center">
      <X size={8} className="text-status-deleted" />
    </span>
  ) : (
    <span className="flex-shrink-0 w-3 h-3 rounded-full bg-status-added/20 flex items-center justify-center">
      <Check size={8} className="text-status-added" />
    </span>
  );
}

function CommandEntry({ entry }: { entry: CommandLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const cmdline = `git ${entry.args.join(' ')}`;
  const failed = entry.exitCode !== 0;
  const hasDetails = Boolean(entry.stdout.trim() || entry.stderr.trim() || entry.repo);
  const isUser = isUserCommand(entry.args);

  return (
    <div className="border-b border-border-subtle">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
        title={cmdline}
      >
        <span className="w-3 flex-shrink-0 text-text-tertiary">
          {hasDetails ? (
            expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
          ) : null}
        </span>
        <CommandStatusDot entry={entry} />
        <span className="text-2xs text-text-tertiary font-mono flex-shrink-0">
          [{formatTime(entry.timestamp)}]
        </span>
        {!isUser && (
          <span className="text-2xs px-1 rounded bg-bg-tertiary text-text-tertiary flex-shrink-0">
            sys
          </span>
        )}
        <span
          className={cn(
            'text-xs font-mono truncate flex-1',
            failed ? 'text-status-deleted' : 'text-text-secondary',
          )}
        >
          {cmdline}
        </span>
        {entry.exitCode !== 0 && entry.exitCode !== null && (
          <span className="text-2xs text-status-deleted flex-shrink-0">exit {entry.exitCode}</span>
        )}
        <span className="text-2xs text-text-tertiary ml-auto flex-shrink-0">
          {formatDuration(entry.durationMs)}
        </span>
      </button>
      {expanded && (
        <div className="px-6 py-2 bg-bg-tertiary/50 text-2xs space-y-1.5">
          <div>
            <span className="text-text-tertiary">Command: </span>
            <code className="font-mono text-text-secondary break-all">{cmdline}</code>
          </div>
          {entry.repo && (
            <div>
              <span className="text-text-tertiary">Directory: </span>
              <code className="font-mono text-text-secondary break-all">{entry.repo}</code>
            </div>
          )}
          {entry.stdout.trim() && (
            <div>
              <div className="text-text-tertiary mb-0.5">stdout:</div>
              <pre className="font-mono text-text-secondary whitespace-pre-wrap break-all max-h-40 overflow-y-auto scrollbar-thin bg-bg-secondary/60 rounded p-1.5 m-0">
                {entry.stdout}
              </pre>
            </div>
          )}
          {entry.stderr.trim() && (
            <div>
              <div className="text-text-tertiary mb-0.5">stderr:</div>
              <pre
                className={cn(
                  'font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto scrollbar-thin bg-bg-secondary/60 rounded p-1.5 m-0',
                  failed ? 'text-status-deleted' : 'text-text-secondary',
                )}
              >
                {entry.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Operations tab --------------------------------- */

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
  return (
    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-status-deleted/20 flex items-center justify-center">
      <X size={10} className="text-status-deleted" />
    </span>
  );
}

function LogEntry({ op, searchQuery }: { op: OperationLog; searchQuery: string }) {
  const [expanded, setExpanded] = useState(false);
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const isCurrentRepo = currentRepo?.path === op.repoPath;
  const repoName = op.repoPath.split('/').pop() || op.repoPath;
  const matchesSearch = !searchQuery ||
    op.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (op.command?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
    (op.error?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

  if (!matchesSearch) return null;

  return (
    <div className={cn('border-b border-border-subtle', !isCurrentRepo && 'opacity-60')}>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="w-3 flex-shrink-0 text-text-tertiary">
          {(op.command || op.result || op.error) ? (
            expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
          ) : null}
        </span>
        <StatusIcon status={op.status} />
        <span className="text-2xs text-text-tertiary font-mono flex-shrink-0">
          [{formatTime(op.timestamp)}]
        </span>
        <span className={cn(
          'text-xs font-medium flex-shrink-0',
          op.status === 'error' ? 'text-status-deleted' : 'text-text-primary'
        )}>
          {op.action}
        </span>
        {!isCurrentRepo && (
          <span className="text-2xs text-text-tertiary truncate">· {repoName}</span>
        )}
        {op.duration !== undefined && (
          <span className="text-2xs text-text-tertiary ml-auto flex-shrink-0">
            {formatDuration(op.duration)}
          </span>
        )}
      </button>
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

/* ------------------------------------- Panel -------------------------------------- */

type Tab = 'commands' | 'operations';

export function CommandLogPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('commands');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [showSystem, setShowSystem] = useState(false); // default: only user commands
  const [searchQuery, setSearchQuery] = useState('');
  const settings = useSettingsStore((s) => s.settings);
  const maxCommands = settings.commandLogLimit ?? 20;

  // Commands tab data: pull the main-process ring buffer once, then live-feed.
  const entries = useCommandLogStore((s) => s.entries);
  const load = useCommandLogStore((s) => s.load);
  const append = useCommandLogStore((s) => s.append);
  const clearCommands = useCommandLogStore((s) => s.clear);

  useEffect(() => {
    load();
    const unsubscribe = api.commandLog.onEntry(append);
    return unsubscribe;
  }, [load, append]);

  const operations = useOperationLogStore((s) => s.ops);
  const clearLog = useOperationLogStore((s) => s.clearLog);
  const runningIds = useOperationLogStore((s) => s.runningIds);
  const runningCount = runningIds.size;

  const failedCount = useMemo(
    () => entries.filter((e) => e.exitCode !== 0).length,
    [entries],
  );

  // Filter: user/system split + errors-only + search
  const visibleEntries = useMemo(() => {
    let result = entries;
    // Default: only show user (mutating) commands unless "show system" is on
    if (!showSystem) {
      result = result.filter(e => isUserCommand(e.args));
    }
    if (errorsOnly) {
      result = result.filter(e => e.exitCode !== 0);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.args.join(' ').toLowerCase().includes(q) ||
        e.stdout.toLowerCase().includes(q) ||
        e.stderr.toLowerCase().includes(q)
      );
    }
    // Limit to maxCommands
    return result.slice(0, maxCommands);
  }, [entries, showSystem, errorsOnly, searchQuery, maxCommands]);

  const copyAll = () => {
    const text = visibleEntries
      .map((e) => {
        const lines = [
          `[${formatTime(e.timestamp)}] exit=${e.exitCode ?? 'signal'} ${formatDuration(e.durationMs)}`,
          `$ git ${e.args.join(' ')}`,
          `directory: ${e.repo}`,
        ];
        if (e.stdout.trim()) lines.push(e.stdout.trimEnd());
        if (e.stderr.trim()) lines.push(e.stderr.trimEnd());
        return lines.join('\n');
      })
      .join('\n\n');
    api.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col bg-bg-secondary border-t border-border-default flex-shrink-0"
      style={{ height: 260 }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-tertiary border-b border-border-default">
        <div className="flex items-center gap-1">
          <button
            className={cn(
              'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors',
              tab === 'commands'
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
            onClick={() => setTab('commands')}
          >
            <Terminal size={11} />
            Commands
            {failedCount > 0 && (
              <span className="text-2xs px-1 rounded bg-status-deleted/15 text-status-deleted normal-case">
                {failedCount} failed
              </span>
            )}
          </button>
          <button
            className={cn(
              'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors',
              tab === 'operations'
                ? 'bg-bg-hover text-text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            )}
            onClick={() => setTab('operations')}
          >
            <ListChecks size={11} />
            Operations
            {runningCount > 0 && (
              <span className="flex items-center gap-1 text-2xs text-accent normal-case">
                <Loader size={10} className="spin" />
                {runningCount} running
              </span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-1">
          {/* Search filter — works for both tabs */}
          <div className="relative mr-1">
            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              className="text-2xs pl-5 pr-2 py-0.5 w-32 bg-bg-secondary border border-border-default rounded"
              placeholder="Filter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {tab === 'commands' && (
            <>
              <label
                className="flex items-center gap-1 text-2xs text-text-tertiary cursor-pointer select-none"
                title="Show read-only git commands (status, log, branches, etc.) in addition to user actions"
              >
                <input
                  type="checkbox"
                  checked={showSystem}
                  onChange={(e) => setShowSystem(e.target.checked)}
                  className="accent-current"
                />
                System
              </label>
              <label
                className="flex items-center gap-1 text-2xs text-text-tertiary cursor-pointer select-none"
                title="Show only failed commands (non-zero exit code)"
              >
                <input
                  type="checkbox"
                  checked={errorsOnly}
                  onChange={(e) => setErrorsOnly(e.target.checked)}
                  className="accent-current"
                />
                Errors only
              </label>
              <button
                className="icon-btn !w-6 !h-6"
                title="Copy all visible commands with their output"
                onClick={copyAll}
              >
                <Copy size={11} />
              </button>
              <button
                className="icon-btn !w-6 !h-6"
                title="Clear command log"
                onClick={() => clearCommands()}
              >
                <Trash size={11} />
              </button>
            </>
          )}
          {tab === 'operations' && (
            <button
              className="icon-btn !w-6 !h-6"
              title="Clear log"
              onClick={clearLog}
            >
              <Trash size={11} />
            </button>
          )}
          <button
            className="icon-btn !w-6 !h-6"
            title="Close panel"
            onClick={onClose}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'commands' ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {visibleEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-tertiary text-xs px-4 text-center">
              {errorsOnly
                ? 'No failed commands.'
                : showSystem
                  ? 'No git commands captured yet.'
                  : 'No user commands yet. Only mutating commands (push, pull, commit, checkout, etc.) are shown by default. Enable "System" to see read-only commands too.'}
            </div>
          ) : (
            visibleEntries.map((entry) => <CommandEntry key={entry.id} entry={entry} />)
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {operations.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
              No operations logged yet. Git commands will appear here.
            </div>
          ) : (
            operations.map((op) => (
              <LogEntry key={op.id} op={op} searchQuery={searchQuery} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
