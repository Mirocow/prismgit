import { useEffect, useMemo, useState, useRef, memo } from 'react';
import { useCommandLogStore } from '../stores/commandLogStore';
import { useSettingsStore } from '../stores/settingsStore';
import { api, type CommandLogEntry } from '../lib/api';
import { Check, X, ChevronDown, ChevronRight, Trash, Loader, Copy, Terminal, Search } from './icons';
import { cn } from '../lib/utils';
import { useLazyList } from '../lib/useLazyList';
import { useI18n } from '../lib/i18n';

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

/**
 * User-facing commands — operations that mutate the repository or perform
 * a user-visible action (push, pull, commit, checkout, etc.).
 *
 * NOTE: Commands with subcommands (stash, reflog, lfs, notes, submodule,
 * worktree, remote, bisect) are NOT in this set — they're handled explicitly
 * in isUserCommand() below because their subcommands split between user and
 * system (e.g. 'git stash push' is user, 'git stash list' is system).
 */
const USER_COMMANDS = new Set([
  'add', 'commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'checkout',
  'cherry-pick', 'revert', 'reset', 'restore', 'stash', 'tag', 'clone', 'init',
  'rm', 'mv', 'clean', 'filter-branch',
  'apply', 'am', 'format-patch', 'send-pack',
  'branch',  // 'git branch' (no args) is filtered below — but 'git branch <name>' / '-d' / '-m' are user
  'subtree',  // rare — treated as user
  'rebase--interactive',  // alias for interactive rebase — user
]);

/**
 * Multi-word subcommands that look like user commands but are actually
 * automatic (background data-collection reads).
 *
 * Format: 'cmd sub' where cmd is positional[0] and sub is positional[1].
 * These override the USER_COMMANDS set so e.g. 'git stash list' is hidden
 * even though 'stash' alone is in USER_COMMANDS.
 */
const ALWAYS_SYSTEM_MULTI = new Set<string>([
  'stash list',
  'stash show',          // 'git stash show' = read-only peek
  'reflog show',         // 'git reflog show' = background reflog polling
  'lfs ls-files',        // 'git lfs ls-files' = read-only listing
  'lfs status',          // 'git lfs status' = read-only status
  'notes list',          // 'git notes list' = read-only
  'submodule status',    // 'git submodule status' = read-only
  'submodule summary',   // 'git submodule summary' = read-only
  'worktree list',       // 'git worktree list' = read-only
  'remote -v',           // 'git remote -v' = read-only (handled below via flag check)
  'remote show',         // 'git remote show <name>' = read-only
  'branch --show-current',  // synthetic — handled via the no-positional rule
]);

/**
 * Single-word commands that are ALWAYS automatic (background polling, never user-initiated).
 *
 * 'config' is listed here because the vast majority of config commands are
 * reads (git config --get). The rare user-initiated write (git config --global
 * user.name "Foo") is acceptable to hide — the user can toggle "System" on
 * if they want to see it.
 */
const ALWAYS_SYSTEM = new Set([
  'status', 'log', 'for-each-ref', 'rev-parse', 'rev-list', 'ls-files',
  'diff-tree', 'diff', 'show', 'ls-remote', 'symbolic-ref',
  'stash',  // 'git stash' alone is rare — usually followed by push/pop/etc.
  'describe', 'shortlog', 'name-rev', 'merge-base',
  'cat-file', 'fsck', 'count-objects',
  'reflog',  // 'git reflog' alone (no subcommand) = 'git reflog show' = automatic
  'remote',  // 'git remote' / 'git remote -v' = read-only listing
  'config',
  'lfs',     // 'git lfs' alone is unusual; most subcommands are read-only
  'notes',   // 'git notes' alone is unusual
  'submodule',  // 'git submodule' alone = read-only listing
  'worktree',   // 'git worktree' alone = read-only listing
  'help', '-help', '--help', '--version',
]);

/**
 * Decide whether a captured git command line was user-initiated (mutating /
 * explicit action) or automatic (background polling, listing, read-only query).
 *
 * The Output panel uses this to filter: by default only user commands are
 * shown; the user can toggle "System" to see all.
 *
 * Examples:
 *   ['push', 'origin', 'main']              → true   (user)
 *   ['status']                              → false  (system — ALWAYS_SYSTEM)
 *   ['stash', 'list']                       → false  (system — ALWAYS_SYSTEM_MULTI 'stash list')
 *   ['stash', 'push', '-u']                 → true   (user)
 *   ['branch']                              → false  (system — listing)
 *   ['branch', 'new-branch']                → true   (user — creating a branch)
 *   ['branch', '-d', 'old']                 → true   (user — deleting a branch)
 *   ['branch', '-a']                        → false  (system — listing all)
 *   ['config', '--global', 'user.name', X] → false  (system — config writes are rare, hidden)
 *   ['reflog', 'show']                      → false  (system — ALWAYS_SYSTEM_MULTI)
 *   ['lfs', 'pull']                         → true   (user)
 *   ['lfs', 'ls-files']                     → false  (system — ALWAYS_SYSTEM_MULTI)
 */
export function isUserCommand(args: string[]): boolean {
  if (!args || args.length === 0) return false;
  // Skip flags and "core."-prefixed keys (config values like 'core.editor').
  // NOTE: We DON'T filter the path after -C because simple-git / spawnGitCapture
  // never pass -C <path> — they set `cwd` on the spawn() options instead.
  // But just to be safe, if a -C IS present we skip the following token too.
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-C' || a.startsWith('--git-dir') || a.startsWith('--work-tree')) {
      i++;  // skip the path argument that follows
      continue;
    }
    if (a.startsWith('-')) continue;            // flag
    if (a.startsWith('core.')) continue;        // config key (rare, but defensive)
    positional.push(a);
  }
  const cmd = positional[0];
  if (!cmd) return false;

  // Synthetic 'api' entries — logged by github.ts / gitlab.ts for HTTP
  // API calls (getMergeRequest, listMRChanges, etc.). These are ALWAYS
  // user-initiated (the user opened a MR, clicked approve, etc.) — they
  // should appear in the Output panel even when the 'System' filter is off.
  // args shape: ['api', 'github'|'gitlab', 'GET'|'POST'|..., '/path']
  if (cmd === 'api') return true;

  // Multi-word subcommand check (e.g. 'stash list', 'reflog show', 'lfs ls-files').
  // Two-word commands in ALWAYS_SYSTEM_MULTI override USER_COMMANDS.
  const sub = positional[1];
  if (sub) {
    const twoWord = `${cmd} ${sub}`;
    if (ALWAYS_SYSTEM_MULTI.has(twoWord)) return false;
  }

  // 'git branch' (no positional arg) = automatic listing — but
  // 'git branch <name>' or 'git branch -d <name>' (with a positional after 'branch')
  // is user-initiated. The -d flag is filtered out, so positional[1] is the
  // branch name being deleted/created/renamed.
  if (cmd === 'branch' && positional.length === 1) return false;

  // 'git stash' alone (no subcommand) — usually 'git stash push' (default) is
  // user-initiated, but in our codebase we always pass an explicit subcommand.
  // Treat 'git stash' alone as system (defensive).
  if (cmd === 'stash' && positional.length === 1) return false;

  // 'git stash push' / 'pop' / 'apply' / 'drop' / 'branch' / 'clear' / 'create' / 'store' = user.
  // 'git stash list' / 'git stash show' = system (handled by ALWAYS_SYSTEM_MULTI above).
  if (cmd === 'stash') {
    // After ALWAYS_SYSTEM_MULTI check above, 'stash list' and 'stash show' are
    // already filtered. The remaining subcommands are all user-initiated.
    return true;
  }

  // 'git remote' alone or 'git remote -v' = read-only listing (system).
  // 'git remote add' / 'git remote remove' / 'git remote set-url' = user (mutating).
  if (cmd === 'remote') {
    if (!sub) return false;          // 'git remote' = list
    if (sub === 'show' || sub === 'get-url') return false;
    // 'add' / 'remove' / 'rename' / 'set-url' / 'set-head' / 'prune' are user
    return true;
  }

  // 'git lfs' alone = read-only; subcommands like 'pull'/'push'/'fetch'/'install' are user
  if (cmd === 'lfs') {
    if (!sub) return false;
    // Read-only LFS subcommands
    if (sub === 'ls-files' || sub === 'status' || sub === 'log' || sub === 'pointer') return false;
    return true;  // 'pull', 'push', 'fetch', 'install', 'track', 'untrack', 'prune' — user
  }

  // 'git submodule' alone = read-only listing (system).
  // 'git submodule add' / 'git submodule update' / 'init' / 'deinit' / 'sync' = user.
  if (cmd === 'submodule') {
    if (!sub) return false;
    if (sub === 'status' || sub === 'summary') return false;
    return true;
  }

  // 'git worktree' alone = read-only listing (system).
  // 'git worktree add' / 'remove' / 'move' / 'prune' = user.
  if (cmd === 'worktree') {
    if (!sub) return false;
    if (sub === 'list') return false;
    return true;
  }

  // 'git notes' alone = read-only (system).
  // 'git notes add' / 'git notes remove' / 'git notes copy' = user.
  if (cmd === 'notes') {
    if (!sub) return false;
    if (sub === 'list' || sub === 'show') return false;
    return true;
  }

  // 'git reflog' alone (no subcommand) = 'git reflog show' = read-only (system).
  // 'git reflog delete' / 'git reflog expire' = user (mutating).
  if (cmd === 'reflog') {
    if (!sub) return false;
    if (sub === 'show' || sub === 'list') return false;
    return true;  // 'delete', 'expire' — user
  }

  // 'git bisect' alone is invalid; subcommands:
  //   'start' / 'bad' / 'good' / 'skip' / 'reset' / 'log' = user
  //   'visualize' / 'view' / 'run' = user
  // No always-system bisect subcommands → all bisect = user.
  if (cmd === 'bisect') {
    return positional.length > 1;  // 'git bisect' alone is invalid anyway
  }

  // Always-system commands (read-only queries triggered by background polling).
  if (ALWAYS_SYSTEM.has(cmd)) return false;

  return USER_COMMANDS.has(cmd);
}

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

const CommandEntry = memo(function CommandEntry({ entry }: { entry: CommandLogEntry }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // Format the command line for display. Synthetic 'api' entries
  // (GitHub/GitLab HTTP calls) get a special format:
  //   api gitlab GET /projects/12/merge_requests/5
  // instead of the misleading 'git api gitlab GET ...'.
  const isApiCall = entry.args[0] === 'api';
  const cmdline = isApiCall
    ? entry.args.join(' ')  // 'api gitlab GET /path'
    : `git ${entry.args.join(' ')}`;
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
            {t('pages.sysBadge')}
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
            <span className="text-text-tertiary">{t('pages.commandLabel')}</span>
            <code className="font-mono text-text-secondary break-all">{cmdline}</code>
          </div>
          {entry.repo && (
            <div>
              <span className="text-text-tertiary">{t('pages.directoryLabel')}</span>
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
});

export function CommandLogPanel({
  onClose,
  initialErrorsOnly,
}: {
  onClose: () => void;
  /**
   * When true, the "Errors only" filter is checked on mount (and the panel
   * scrolls to the latest failed entry). Used by App.tsx when auto-opening
   * the panel after a simple-git failure — the user wants to see the error
   * immediately, not the full command list.
   */
  initialErrorsOnly?: boolean;
}) {
  const [errorsOnly, setErrorsOnly] = useState(initialErrorsOnly ?? false);
  const [showSystem, setShowSystem] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { t } = useI18n();
  // Select only the specific field we need, not the entire settings object —
  // avoids re-rendering this 80-row panel on every unrelated settings tweak
  // (font size drag, contrast slider, theme toggle, etc.).
  const maxCommands = useSettingsStore((s) => s.settings.commandLogLimit ?? 20);
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = useCommandLogStore((s) => s.entries);
  const load = useCommandLogStore((s) => s.load);
  const append = useCommandLogStore((s) => s.append);
  const clearCommands = useCommandLogStore((s) => s.clear);

  useEffect(() => {
    load();
    const unsubscribe = api.commandLog.onEntry(append);
    return unsubscribe;
  }, [load, append]);

  const failedCount = useMemo(
    () => entries.filter((e) => e.exitCode !== 0).length,
    [entries],
  );

  const visibleEntries = useMemo(() => {
    let result = entries;
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
    return result.slice(0, maxCommands);
  }, [entries, showSystem, errorsOnly, searchQuery, maxCommands]);

  // Lazy list for virtualized rendering — only renders visible rows
  const ROW_HEIGHT = 32;
  const lazyList = useLazyList({
    itemCount: visibleEntries.length,
    estimateRowHeight: ROW_HEIGHT,
  });

  // Auto-scroll to the top (newest entry) when the panel is auto-opened
  // on error. Entries are sorted newest-first, so the failed entry that
  // triggered the open is at the top. We only do this on mount when
  // initialErrorsOnly is set (auto-open scenario) — not on every filter
  // change afterwards, which would fight the user's manual scroll.
  useEffect(() => {
    if (initialErrorsOnly && lazyList.scrollRef.current) {
      lazyList.scrollRef.current.scrollTop = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyAll = () => {
    const text = visibleEntries
      .map((e) => {
        const lines = [
          `[${formatTime(e.timestamp)}] exit=${e.exitCode ?? 'signal'} ${formatDuration(e.durationMs)}`,
          // For 'api' entries, omit the misleading '$ git ' prefix.
          (e.args[0] === 'api' ? e.args.join(' ') : `$ git ${e.args.join(' ')}`),
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
      style={{ height: '100%' }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-bg-tertiary border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors bg-bg-hover text-text-primary"
          >
            <Terminal size={11} />
            {t('pages.outputTab')}
            {failedCount > 0 && (
              <span className="text-2xs px-1 rounded bg-status-deleted/15 text-status-deleted normal-case">
                {t('pages.failedCount', { count: failedCount })}
              </span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative mr-1">
            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              className="text-2xs pl-5 pr-2 py-0.5 w-32 bg-bg-secondary border border-border-default rounded"
              placeholder={t('pages.filterPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <label
            className="flex items-center gap-1 text-2xs text-text-tertiary cursor-pointer select-none"
            title={t('pages.systemTitle')}
          >
            <input
              type="checkbox"
              checked={showSystem}
              onChange={(e) => setShowSystem(e.target.checked)}
              className="accent-current"
            />
            {t('pages.systemLabel')}
          </label>
          <label
            className="flex items-center gap-1 text-2xs text-text-tertiary cursor-pointer select-none"
            title={t('pages.errorsTitle')}
          >
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => setErrorsOnly(e.target.checked)}
              className="accent-current"
            />
            {t('pages.errorsLabel')}
          </label>
          <button
            className="icon-btn !w-6 !h-6"
            title={t('pages.copyAllTitle')}
            onClick={copyAll}
          >
            <Copy size={11} />
          </button>
          <button
            className="icon-btn !w-6 !h-6"
            title={t('pages.clearLogTitle')}
            onClick={() => clearCommands()}
          >
            <Trash size={11} />
          </button>
          <button
            className="icon-btn !w-6 !h-6"
            title={t('pages.closePanelTitle')}
            onClick={onClose}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Content — use lazy list for performance with many entries */}
      <div className="flex-1 overflow-y-auto scrollbar-thin" ref={lazyList.scrollRef}>
        {visibleEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary text-xs px-4 text-center">
            {errorsOnly
              ? t('pages.noFailed')
              : showSystem
                ? t('pages.noCommands')
                : t('pages.noUserCommands')}
          </div>
        ) : (
          <div style={{ height: lazyList.totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: lazyList.offsetY, left: 0, right: 0 }}>
              {visibleEntries.slice(lazyList.visibleRange.start, lazyList.visibleRange.end).map((entry) => (
                <CommandEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
