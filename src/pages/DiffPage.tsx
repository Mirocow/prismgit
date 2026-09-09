import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, FileText, GitBranch, GitCommit, ChevronDown } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type DiffResult, type LogEntry, type BranchInfo, type CommitFile } from '../lib/api';
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
  // File list for multi-file diff (when filePath === '.')
  const [changedFiles, setChangedFiles] = useState<CommitFile[]>([]);
  const [selectedFileInList, setSelectedFileInList] = useState<string | null>(null);

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
      // If filePath is '.' (all files), first get the list of changed files
      if ((filePath === '.' || filePath === '') && compareMode === 'working') {
        // Get changed files between baseRef and working tree
        const rawFiles = await api.git.raw(repo.path, ['diff', '--name-status', '--no-color', baseRef]);
        const files: CommitFile[] = rawFiles.split('\n').filter(Boolean).map(line => {
          const parts = line.split('\t');
          const status = parts[0];
          const path = parts[parts.length - 1] || '';
          return { path, status: status[0] || 'M', additions: 0, deletions: 0, binary: false, mode: '' };
        });
        setChangedFiles(files);
        // If no specific file selected, auto-select the first one
        if (!selectedFileInList && files.length > 0) {
          setSelectedFileInList(files[0].path);
        }
        // Load diff for the selected file (or first file)
        const fileToDiff = selectedFileInList || files[0]?.path;
        if (fileToDiff) {
          const result = await api.git.diff(repo.path, fileToDiff, { ref: baseRef });
          setDiff(result);
        } else {
          setDiff(null);
        }
      } else if ((filePath === '.' || filePath === '') && compareMode === 'ref' && compareRef) {
        // Diff between two refs — get file list
        const rawFiles = await api.git.raw(repo.path, ['diff', '--name-status', '--no-color', `${baseRef}...${compareRef}`]);
        const files: CommitFile[] = rawFiles.split('\n').filter(Boolean).map(line => {
          const parts = line.split('\t');
          const status = parts[0];
          const path = parts[parts.length - 1] || '';
          return { path, status: status[0] || 'M', additions: 0, deletions: 0, binary: false, mode: '' };
        });
        setChangedFiles(files);
        if (!selectedFileInList && files.length > 0) {
          setSelectedFileInList(files[0].path);
        }
        const fileToDiff = selectedFileInList || files[0]?.path;
        if (fileToDiff) {
          const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', `${baseRef}...${compareRef}`, '--', fileToDiff]);
          // Parse
          const result = parseRawDiff(rawDiff, fileToDiff);
          setDiff(result);
        } else {
          setDiff(null);
        }
      } else {
        // Single file diff
        setChangedFiles([]);
        let result: DiffResult;
        if (compareMode === 'working') {
          result = await api.git.diff(repo.path, filePath || '.', { ref: baseRef });
        } else if (compareMode === 'staged') {
          result = await api.git.diff(repo.path, filePath || '.', { staged: true, ref: baseRef });
        } else {
          const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', `${baseRef}...${compareRef}`, '--', filePath || '.']);
          result = parseRawDiff(rawDiff, filePath);
        }
        setDiff(result);
      }
    } catch (e) {
      toast.error('Failed to compute diff', String(e));
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [repo, filePath, baseRef, compareMode, compareRef, toast, selectedFileInList]);

  // Auto-compute when inputs change
  useEffect(() => {
    if (repo && baseRef) {
      const timer = setTimeout(computeDiff, 300); // debounce 300ms
      return () => clearTimeout(timer);
    }
  }, [computeDiff, repo, baseRef]);

  // Reload diff when user clicks a different file in the file list
  const loadFileDiff = async (file: string) => {
    if (!repo) return;
    setSelectedFileInList(file);
    setLoading(true);
    try {
      let result: DiffResult;
      if (compareMode === 'ref' && compareRef) {
        const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', `${baseRef}...${compareRef}`, '--', file]);
        result = parseRawDiff(rawDiff, file);
      } else {
        result = await api.git.diff(repo.path, file, { ref: baseRef, staged: compareMode === 'staged' });
      }
      setDiff(result);
    } catch (e) {
      toast.error('Failed to load file diff', String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reset file selection when baseRef or compareMode changes
  useEffect(() => {
    setSelectedFileInList(null);
  }, [baseRef, compareMode, compareRef]);

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
        {loading ? 'Computing diff...' : title} · {selectedFileInList || filePath}
      </div>

      {/* Body: file list (left, when multi-file) + diff viewer (right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list sidebar — shown when comparing all files ('.') */}
        {changedFiles.length > 0 && (
          <div className="w-56 flex-shrink-0 border-r border-border-default overflow-y-auto bg-bg-secondary">
            <div className="px-2 py-1 text-2xs font-semibold uppercase text-text-tertiary border-b border-border-subtle sticky top-0 bg-bg-secondary">
              Changed Files ({changedFiles.length})
            </div>
            {changedFiles.slice(0, 200).map((f, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 text-2xs cursor-pointer hover:bg-bg-hover',
                  selectedFileInList === f.path && 'bg-bg-selected'
                )}
                onClick={() => loadFileDiff(f.path)}
                title={f.path}
              >
                <span className="font-mono font-bold w-3 text-center flex-shrink-0"
                  style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>
                  {f.status}
                </span>
                <span className="flex-1 truncate font-mono text-text-secondary">{f.path}</span>
              </div>
            ))}
            {changedFiles.length > 200 && (
              <div className="px-2 py-1 text-2xs text-text-tertiary border-t border-border-subtle">
                Showing first 200 of {changedFiles.length}
              </div>
            )}
          </div>
        )}

        {/* Diff viewer — scrollable */}
        <div className="flex-1 overflow-auto">
          {diff ? (
            <DiffViewer diff={diff} filePath={selectedFileInList || filePath} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm p-8">
              {loading ? 'Loading...' : 'Select base and compare refs to see diff'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper to parse raw git diff output into DiffResult
function parseRawDiff(rawDiff: string, file: string): DiffResult {
  const lines = rawDiff.split('\n');
  const hunks: any[] = [];
  let currentHunk: any = null;
  let oldLine = 0, newLine = 0;
  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
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
      continue;
    }
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLineNumber: null, newLineNumber: newLine++ });
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: null });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return {
    oldContent: '', newContent: '', oldPath: file, newPath: file,
    hunks, binary: rawDiff.includes('Binary files'),
    newFile: rawDiff.includes('new file mode'),
    deletedFile: rawDiff.includes('deleted file mode'),
    renamedFile: rawDiff.includes('rename from') || rawDiff.includes('rename to'),
  };
}
