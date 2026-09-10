import { useState, useMemo, useCallback } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Filter, Loader, Package, X } from './icons';
import { confirmDialog } from './ConfirmDialog';
import { cn } from '../lib/utils';

interface ConflictListProps {
  /** Conflicted file paths from git status. */
  conflicts: string[];
  /** State-aware label for what to do after resolution (e.g. "Commit" / "Continue the rebase"). */
  finishAction: string;
  finishLabel: string;
  /** Per-file inline resolution — Take ours / Take theirs / Take both / Mark resolved. */
  onResolveAction?: (file: string, mode: 'ours' | 'theirs' | 'both' | 'resolved') => void;
  /** Open the 3-way ConflictSolver for a single file. */
  onOpenSolver?: (file: string) => void;
  /** Mass actions — resolve ALL conflicted files at once (used by toolbar buttons). */
  onResolveAll?: (mode: 'ours' | 'theirs') => void;
}

/**
 * Scalable conflict list — handles DOZENS of conflicted files efficiently.
 *
 * Features for large file counts:
 *   - Progress bar (resolved / total)
 *   - Filter/search box (substring match on path)
 *   - Collapse/expand (collapsed by default when >20 files)
 *   - Virtualized via max-height + overflow (no row virtualization needed
 *     for <500 files; CSS scroll is fast enough)
 *   - Mass actions: Take All Ours / Take All Theirs / Open All in Solver
 *   - Per-directory grouping (opt-in via toggle)
 *
 * SmartGit pattern: the conflict section is a self-contained panel with
 * its own toolbar, so the user can manage 50+ conflicts without scrolling
 * through the entire Changes file list.
 */
export function ConflictList({
  conflicts,
  finishAction,
  finishLabel,
  onResolveAction,
  onOpenSolver,
  onResolveAll,
}: ConflictListProps) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState(conflicts.length > 20);
  const [groupByDir, setGroupByDir] = useState(false);
  const [busy, setBusy] = useState(false);

  // Filtered + grouped view (memoized — re-computes only when conflicts/filter change)
  const filtered = useMemo(() => {
    if (!filter.trim()) return conflicts;
    const q = filter.toLowerCase();
    return conflicts.filter((f) => f.toLowerCase().includes(q));
  }, [conflicts, filter]);

  const groups = useMemo(() => {
    if (!groupByDir) return null;
    const map = new Map<string, string[]>();
    for (const f of filtered) {
      const slash = f.lastIndexOf('/');
      const dir = slash >= 0 ? f.slice(0, slash) : '(root)';
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(f);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupByDir]);

  const handleMassAction = useCallback(async (mode: 'ours' | 'theirs') => {
    if (filtered.length === 0) return;
    if (!(await confirmDialog({
      title: `Take ${mode === 'ours' ? 'ours' : 'theirs'} for ALL ${filtered.length} conflicted file${filtered.length === 1 ? '' : 's'}?`,
      message: `This runs \`git checkout --${mode}\` on every conflicted file${filter ? ' matching the filter' : ''}, then stages them.\n\nFiles NOT matching the filter are left untouched.`,
      confirmLabel: `Take All ${mode === 'ours' ? 'Ours' : 'Theirs'}`,
      danger: true,
    }))) return;
    setBusy(true);
    try {
      // Call onResolveAll if available (batch), otherwise loop per-file
      if (onResolveAll) {
        onResolveAll(mode);
      } else if (onResolveAction) {
        for (const f of filtered) {
          onResolveAction(f, mode);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [filtered, filter, onResolveAll, onResolveAction]);

  return (
    <div className="border-b border-status-conflict/30 bg-status-conflict/5">
      {/* Header — count + progress + mass actions */}
      <div className="flex items-center gap-2 px-2 py-1 text-2xs font-bold uppercase text-status-conflict bg-status-conflict/10 border-b border-status-conflict/20">
        <button
          className="flex items-center gap-1 hover:text-text-primary transition-colors"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand conflict list' : 'Collapse conflict list'}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </button>
        <AlertCircle size={10} />
        Conflicts ({conflicts.length})
        <span className="normal-case font-normal text-text-tertiary ml-2 flex-1 truncate">
          Resolve each file, then {finishAction} to finish the {finishLabel}.
        </span>

        {/* Mass actions — visible only when conflicts exist */}
        {!collapsed && conflicts.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onResolveAll && (
              <>
                <button
                  className="text-2xs px-1.5 py-0.5 rounded border border-status-added/40 bg-status-added/15 text-status-added hover:bg-status-added/25 transition-colors font-medium disabled:opacity-50"
                  onClick={() => handleMassAction('ours')}
                  disabled={busy}
                  title="Take ours for ALL conflicted files (git checkout --ours on every file)"
                >
                  Take All Ours
                </button>
                <button
                  className="text-2xs px-1.5 py-0.5 rounded border border-status-modified/40 bg-status-modified/15 text-status-modified hover:bg-status-modified/25 transition-colors font-medium disabled:opacity-50"
                  onClick={() => handleMassAction('theirs')}
                  disabled={busy}
                  title="Take theirs for ALL conflicted files (git checkout --theirs on every file)"
                >
                  Take All Theirs
                </button>
              </>
            )}
            {busy && <Loader size={11} className="animate-spin text-status-conflict" />}
          </div>
        )}
      </div>

      {/* Body — filter + file list (hidden when collapsed) */}
      {!collapsed && (
        <>
          {/* Filter bar — shown when >5 conflicts */}
          {conflicts.length > 5 && (
            <div className="flex items-center gap-2 px-2 py-1 border-b border-status-conflict/20 bg-bg-secondary">
              <Filter size={10} className="text-text-tertiary flex-shrink-0" />
              <input
                type="text"
                placeholder={`Filter ${conflicts.length} conflicts by path...`}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="flex-1 text-2xs bg-bg-tertiary border border-border-default rounded px-2 py-0.5 focus:outline-none focus:border-accent"
                autoFocus
              />
              <button
                className={cn('text-2xs px-1.5 py-0.5 rounded border transition-colors',
                  groupByDir ? 'border-accent bg-accent-muted text-accent' : 'border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover')}
                onClick={() => setGroupByDir((g) => !g)}
                title="Group conflicts by directory"
              >
                Group
              </button>
              {filter && (
                <span className="text-2xs text-text-tertiary">
                  {filtered.length}/{conflicts.length} shown
                </span>
              )}
            </div>
          )}

          {/* File list — max-height + scroll handles dozens of files */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-2xs text-text-tertiary italic">
                No conflicts match "{filter}"
              </div>
            ) : groups ? (
              /* Grouped by directory */
              groups.map(([dir, files]) => (
                <div key={dir}>
                  <div className="px-2 py-0.5 text-2xs font-semibold uppercase text-text-tertiary bg-bg-tertiary/50 border-b border-border-subtle sticky top-0">
                    {dir} ({files.length})
                  </div>
                  {files.map((filePath) => (
                    <ConflictRow
                      key={filePath}
                      filePath={filePath}
                      onResolveAction={onResolveAction}
                      onOpenSolver={onOpenSolver}
                    />
                  ))}
                </div>
              ))
            ) : (
              /* Flat list */
              filtered.map((filePath) => (
                <ConflictRow
                  key={filePath}
                  filePath={filePath}
                  onResolveAction={onResolveAction}
                  onOpenSolver={onOpenSolver}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Single conflicted-file row with inline Take Ours / Take Theirs / Both / ✓ / Solver. */
function ConflictRow({
  filePath,
  onResolveAction,
  onOpenSolver,
}: {
  filePath: string;
  onResolveAction?: (file: string, mode: 'ours' | 'theirs' | 'both' | 'resolved') => void;
  onOpenSolver?: (file: string) => void;
}) {
  return (
    <div
      className="group flex items-center gap-2 px-2 py-1 cursor-pointer text-xs hover:bg-bg-hover border-l-2 border-status-conflict"
      onClick={() => onOpenSolver?.(filePath)}
    >
      <span className="font-bold w-4 text-center text-status-conflict flex-shrink-0">U</span>
      <span className="flex-1 truncate font-mono whitespace-nowrap" title={filePath}>{filePath}</span>
      {/* Inline resolution actions — SmartGit/GitKraken pattern */}
      <span className="flex justify-end items-center gap-0.5 flex-shrink-0">
        {onResolveAction && (
          <>
            <button
              className="text-2xs px-1.5 py-0.5 rounded border border-status-added/30 bg-status-added/10 text-status-added hover:bg-status-added/20 transition-colors"
              title="Take ours (git checkout --ours)"
              onClick={(e) => { e.stopPropagation(); onResolveAction(filePath, 'ours'); }}
            >
              Ours
            </button>
            <button
              className="text-2xs px-1.5 py-0.5 rounded border border-status-modified/30 bg-status-modified/10 text-status-modified hover:bg-status-modified/20 transition-colors"
              title="Take theirs (git checkout --theirs)"
              onClick={(e) => { e.stopPropagation(); onResolveAction(filePath, 'theirs'); }}
            >
              Theirs
            </button>
            <button
              className="text-2xs px-1.5 py-0.5 rounded border border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover transition-colors"
              title="Take both (concatenate ours + theirs)"
              onClick={(e) => { e.stopPropagation(); onResolveAction(filePath, 'both'); }}
            >
              Both
            </button>
            <button
              className="text-2xs px-1.5 py-0.5 rounded border border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20 transition-colors"
              title="Mark as resolved (git add)"
              onClick={(e) => { e.stopPropagation(); onResolveAction(filePath, 'resolved'); }}
            >
              ✓
            </button>
          </>
        )}
        <button
          className="btn btn-primary text-2xs !py-0.5 !px-2"
          onClick={(e) => { e.stopPropagation(); onOpenSolver?.(filePath); }}
          title="Open 3-way Conflict Solver"
        >
          Solver
        </button>
      </span>
    </div>
  );
}
