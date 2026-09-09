import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, FileText, GitBranch, GitCommit, ChevronDown } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type DiffResult, type LogEntry, type BranchInfo } from '../lib/api';
import { DiffViewer } from '../components/DiffViewer';
import { cn, shortHash } from '../lib/utils';
import { useLazyList } from '../lib/useLazyList';

/**
 * Diff Tool — standalone comparison tool.
 *
 * Lets user pick:
 *   1. A file (or "all files" via '.')
 *   2. A "base" ref (commit hash, branch name, or HEAD)
 *   3. A "compare" ref (another commit, working tree, or staged)
 *
 * Shows the diff between the two via DiffViewer.
 *
 * Connected to global selectionStore:
 *   - selectedFilePath pre-fills the file path
 *   - selectedCommitHash pre-fills the "base" ref
 *
 * This is NOT the inline diff in Changes — that stays in Changes.
 * This is a dedicated tool for comparing arbitrary refs.
 */
export function DiffPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const globalFilePath = useSelectionStore((s) => s.selectedFilePath);
  const globalCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const globalBranch = useSelectionStore((s) => s.selectedBranch);

  const [filePath, setFilePath] = useState('.');
  const [baseRef, setBaseRef] = useState('HEAD');
  const [compareMode, setCompareMode] = useState<'working' | 'staged' | 'ref'>('working');
  const [compareRef, setCompareRef] = useState('');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [recentCommits, setRecentCommits] = useState<LogEntry[]>([]);

  // Pre-fill from global selections
  useEffect(() => {
    if (globalFilePath) setFilePath(globalFilePath);
  }, [globalFilePath]);
  useEffect(() => {
    if (globalCommitHash) setBaseRef(globalCommitHash);
  }, [globalCommitHash]);
  useEffect(() => {
    if (globalBranch) setBaseRef(globalBranch);
  }, [globalBranch]);

  // Load branches and recent commits for dropdowns
  useEffect(() => {
    if (!repo) return;
    api.git.branches(repo.path).then(setBranches).catch(() => {});
    api.git.log(repo.path, { maxCount: 30 }).then(setRecentCommits).catch(() => {});
  }, [repo]);

  const computeDiff = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      let result: DiffResult;
      if (compareMode === 'working') {
        // Compare base ref with working tree: git diff <baseRef> -- <file>
        result = await api.git.diff(repo.path, filePath || '.', { ref: baseRef });
      } else if (compareMode === 'staged') {
        // Compare base ref with staged (index): git diff --cached <baseRef> -- <file>
        result = await api.git.diff(repo.path, filePath || '.', { staged: true, ref: baseRef });
      } else {
        // Compare two refs: git diff <baseRef>..<compareRef> -- <file>
        // We use raw git for this since our diff() only supports one ref
        const range = `${baseRef}..${compareRef}`;
        const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', range, '--', filePath || '.']);
        // Parse using the same approach as diff()
        result = {
          oldContent: '',
          newContent: '',
          oldPath: filePath,
          newPath: filePath,
          hunks: [],
          binary: rawDiff.includes('Binary files'),
          newFile: rawDiff.includes('new file mode'),
          deletedFile: rawDiff.includes('deleted file mode'),
          renamedFile: rawDiff.includes('rename from') || rawDiff.includes('rename to'),
        };
        // Parse hunks from rawDiff
        const lines = rawDiff.split('\n');
        let currentHunk: any = null;
        let oldLine = 0, newLine = 0;
        for (const line of lines) {
          if (line.startsWith('@@')) {
            if (currentHunk) result.hunks.push(currentHunk);
            const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            if (match) {
              currentHunk = {
                oldStart: parseInt(match[1]), oldLines: parseInt(match[2] || '1'),
                newStart: parseInt(match[3]), newLines: parseInt(match[4] || '1'),
                header: line, lines: []
              };
              oldLine = parseInt(match[1]);
              newLine = parseInt(match[3]);
            }
          } else if (currentHunk) {
            if (line.startsWith('+')) {
              currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLineNumber: null, newLineNumber: newLine++ });
            } else if (line.startsWith('-')) {
              currentHunk.lines.push({ type: 'del', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: null });
            } else if (line.startsWith(' ')) {
              currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
            }
          }
        }
        if (currentHunk) result.hunks.push(currentHunk);
      }
      setDiff(result);
    } catch (e) {
      toast.error('Failed to compute diff', String(e));
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [repo, filePath, baseRef, compareMode, compareRef, toast]);

  // Auto-compute when inputs change
  useEffect(() => {
    if (repo && baseRef) {
      const timer = setTimeout(computeDiff, 300); // debounce 300ms
      return () => clearTimeout(timer);
    }
  }, [computeDiff, repo, baseRef]);

  if (!repo) {
    return <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">No repository open</div>;
  }

  const title = compareMode === 'ref' && compareRef
    ? `${baseRef} → ${compareRef}`
    : compareMode === 'staged'
      ? `${baseRef} → Staged`
      : `${baseRef} → Working Tree`;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header with comparison controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-bg-tertiary flex-wrap">
        <span className="text-xs font-medium flex-shrink-0">Diff</span>

        {/* File path input */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <FileText size={11} className="text-text-tertiary" />
          <input
            type="text"
            placeholder="file path (or . for all)"
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            className="text-xs w-48 px-2 py-0.5 font-mono bg-bg-secondary border border-border-default rounded"
            title="File to compare. Use '.' to compare all files."
          />
        </div>

        {/* Base ref selector */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-2xs text-text-tertiary">Base:</span>
          <select
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            className="text-xs px-1 py-0.5 bg-bg-secondary border border-border-default rounded font-mono"
            title="Base reference (what to compare FROM)"
          >
            <option value="HEAD">HEAD</option>
            {branches.filter(b => !b.remote).map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
            {branches.filter(b => b.remote).map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
            {recentCommits.map(c => (
              <option key={c.hash} value={c.hash}>{shortHash(c.hash)} · {c.subject.substring(0, 40)}</option>
            ))}
          </select>
        </div>

        {/* Arrow */}
        <span className="text-text-tertiary flex-shrink-0">→</span>

        {/* Compare mode selector */}
        <div className="flex items-center gap-0">
          <button
            className={cn('text-2xs px-2 py-0.5 rounded-l border',
              compareMode === 'working' ? 'bg-accent text-text-inverse border-accent' : 'bg-bg-secondary text-text-secondary border-border-default')}
            onClick={() => setCompareMode('working')}
            title="Compare with working tree (unstaged changes)"
          >
            Working Tree
          </button>
          <button
            className={cn('text-2xs px-2 py-0.5 border-t border-b',
              compareMode === 'staged' ? 'bg-accent text-text-inverse border-accent' : 'bg-bg-secondary text-text-secondary border-border-default')}
            onClick={() => setCompareMode('staged')}
            title="Compare with staged (index)"
          >
            Staged
          </button>
          <button
            className={cn('text-2xs px-2 py-0.5 rounded-r border',
              compareMode === 'ref' ? 'bg-accent text-text-inverse border-accent' : 'bg-bg-secondary text-text-secondary border-border-default')}
            onClick={() => setCompareMode('ref')}
            title="Compare with another ref (commit/branch)"
          >
            Ref...
          </button>
        </div>

        {/* Compare ref input (only for 'ref' mode) */}
        {compareMode === 'ref' && (
          <select
            value={compareRef}
            onChange={(e) => setCompareRef(e.target.value)}
            className="text-xs px-1 py-0.5 bg-bg-secondary border border-border-default rounded font-mono"
            title="Compare TO this reference"
          >
            <option value="">Select ref...</option>
            {branches.filter(b => !b.remote).map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
            {recentCommits.map(c => (
              <option key={c.hash} value={c.hash}>{shortHash(c.hash)} · {c.subject.substring(0, 40)}</option>
            ))}
          </select>
        )}

        <button className="icon-btn !w-5 !h-5 ml-auto" title="Refresh" onClick={computeDiff}>
          <RefreshCw size={11} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Diff title bar */}
      <div className="px-3 py-1 border-b border-border-subtle bg-bg-secondary text-2xs text-text-tertiary font-mono truncate">
        {loading ? 'Computing diff...' : title} · {filePath}
      </div>

      {/* Diff viewer */}
      <div className="flex-1 overflow-hidden">
        {diff ? (
          <DiffViewer diff={diff} filePath={filePath} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
            {loading ? 'Loading...' : 'Select base and compare refs to see diff'}
          </div>
        )}
      </div>
    </div>
  );
}
