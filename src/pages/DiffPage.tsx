import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, FileText, GitBranch, GitCommit, ChevronDown, Search, AlertCircle } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type DiffResult, type LogEntry, type BranchInfo, type CommitFile } from '../lib/api';
import { DiffViewer } from '../components/DiffViewer';
import { ConflictMergeView } from '../components/ConflictMergeView';
import { RepoStateBanner } from '../components/RepoStateBanner';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { cn, shortHash } from '../lib/utils';
import { useLazyList } from '../lib/useLazyList';
import { useContextMenu } from '../lib/useContextMenu';
import { buildFileMenu, runFileAction } from '../lib/fileContextMenu';
import { loadProjectPrefs, saveProjectPrefs } from '../lib/projectPrefs';
import { useI18n } from '../lib/i18n';

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
 *   - diffRequest (one-shot) is consumed on first render — used by Stashes page
 *     to ask Diff to compare stash^ vs stash (instead of HEAD vs working tree)
 *
 * This is NOT the inline diff in Changes — that stays in Changes.
 * This is a dedicated tool for comparing arbitrary refs.
 */
export function DiffPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const { t } = useI18n();
  const globalFilePath = useSelectionStore((s) => s.selectedFilePath);
  const globalCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const globalBranch = useSelectionStore((s) => s.selectedBranch);
  const globalTag = useSelectionStore((s) => s.selectedTag);
  const diffRequest = useSelectionStore((s) => s.diffRequest);
  const clearDiffRequest = useSelectionStore((s) => s.setDiffRequest);

  const [filePath, setFilePath] = useState('.');
  const [baseRef, setBaseRef] = useState('HEAD');
  const [compareMode, setCompareMode] = useState<'working' | 'staged' | 'ref'>('working');
  const [compareRef, setCompareRef] = useState('');
  const [stashHash, setStashHash] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selectedFileInList, setSelectedFileInList] = useState<string | null>(null);

  // Conflict detection — when a sequencer state is active AND the selected
  // file is conflicted, show the 3-way ConflictMergeView instead of the
  // normal 2-way DiffViewer. This embeds conflict resolution INTO the Diff
  // tool (SmartGit pattern) rather than a separate modal popup.
  const conflicted = status?.conflicted ?? [];
  const inProgress = !!(status?.isMerging || status?.isCherryPicking || status?.isReverting || status?.isRebasing);
  const activeFile = selectedFileInList || filePath;
  const isConflictFile = conflicted.includes(activeFile) && activeFile !== '.';
  const showMergeView = inProgress && isConflictFile;
  const [recentCommits, setRecentCommits] = useState<LogEntry[]>([]);
  // File list for multi-file diff (when filePath === '.')
  const [changedFiles, setChangedFiles] = useState<CommitFile[]>([]);
  // Filter box above the file list — with 200+ changed files, scrolling to
  // find one path is not something a human should do.
  const [fileListFilter, setFileListFilter] = useState('');
  // Width of the file-list sidebar — splitter lets the user resize it.
  // Bug fix: previously the file list was a fixed `w-56` with no splitter, so
  // users couldn't widen it for long paths. Now we use useResizableWidth.
  const { width: fileListWidth, setWidth: setFileListWidth, handleResize: handleFileListResize } = useResizableWidth(224, 140, 480);
  const showContextMenu = useContextMenu();

  // Per-project file-list width (projectPrefs) — apply on repo open, save
  // back debounced while the user drags the splitter.
  useEffect(() => {
    const v = loadProjectPrefs(repo.path).diffFileListWidth;
    if (v != null && Number.isFinite(v)) setFileListWidth(Math.max(140, Math.min(480, v)));
  }, [repo.path, setFileListWidth]);

  useEffect(() => {
    const t = setTimeout(() => saveProjectPrefs(repo.path, { diffFileListWidth: fileListWidth }), 500);
    return () => clearTimeout(t);
  }, [repo.path, fileListWidth]);

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
  useEffect(() => {
    if (globalTag) setBaseRef(globalTag);
  }, [globalTag]);

  // Consume one-shot diffRequest — when Stashes (or any tool) sets it,
  // apply base/compare/filePath to local state, then clear the request.
  // This must run BEFORE the computeDiff effect so the new state is in place.
  useEffect(() => {
    if (!diffRequest) return;
    setBaseRef(diffRequest.baseRef);
    setCompareRef(diffRequest.compareRef);
    setCompareMode('ref');
    setStashHash(diffRequest.stashHash ?? null);
    if (diffRequest.filePath) {
      setFilePath(diffRequest.filePath);
      // Also sync to global so other consumers see the same path
      useSelectionStore.getState().selectFile(diffRequest.filePath);
    }
    // Clear the request so a subsequent mount of DiffPage doesn't re-apply it.
    clearDiffRequest(null);
  }, [diffRequest, clearDiffRequest]);

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
      // Stash viewer (View Stash from the Stashes page): plain `diff stash^..stash`
      // renders EMPTY when the stash contains untracked files — they are stored
      // ONLY in the stash's third parent. api.git.stashFiles/stashFileRawDiff
      // read both the tracked and the untracked part.
      if (stashHash && (filePath === '.' || filePath === '')) {
        const files = await api.git.stashFiles(repo.path, stashHash);
        setChangedFiles(files);
        if (!selectedFileInList && files.length > 0) {
          setSelectedFileInList(files[0].path);
        }
        const fileToDiff = selectedFileInList || files[0]?.path;
        if (fileToDiff) {
          const rawDiff = await api.git.stashFileRawDiff(repo.path, stashHash, fileToDiff);
          setDiff(parseRawDiff(rawDiff, fileToDiff));
        } else {
          setDiff(null);
        }
      } else if (stashHash) {
        // Single file inside a stash
        setChangedFiles([]);
        const rawDiff = await api.git.stashFileRawDiff(repo.path, stashHash, filePath || '.');
        setDiff(parseRawDiff(rawDiff, filePath));
      } else if ((filePath === '.' || filePath === '') && compareMode === 'working') {
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
        // Diff between two refs — get file list.
        // IMPORTANT: use `..` (double-dot) not `...` (triple-dot) for direct ref
        // comparison. Triple-dot diff compares from merge-base, which gives
        // wrong results for stash commits (stash^...stash vs stash^..stash).
        // Stash commits have parent[0] = base, so direct diff is what we want.
        const rawFiles = await api.git.raw(repo.path, ['diff', '--name-status', '--no-color', `${baseRef}..${compareRef}`]);
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
          const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', `${baseRef}..${compareRef}`, '--', fileToDiff]);
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
          // Same `..` rationale here — direct ref comparison, not merge-base.
          const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', `${baseRef}..${compareRef}`, '--', filePath || '.']);
          result = parseRawDiff(rawDiff, filePath);
        }
        setDiff(result);
      }
    } catch (e) {
      toast.error(t('diff.computeFailed'), String(e));
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [repo, filePath, baseRef, compareMode, compareRef, stashHash, toast, selectedFileInList]);

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
    // Cross-tool write-back: the file shown in Diff is the app-wide selection,
    // so Blame/Changes/History follow the file the user is looking at.
    useSelectionStore.getState().selectFile(file);
    setLoading(true);
    try {
      let result: DiffResult;
      if (stashHash) {
        const rawDiff = await api.git.stashFileRawDiff(repo.path, stashHash, file);
        result = parseRawDiff(rawDiff, file);
      } else if (compareMode === 'ref' && compareRef) {
        const rawDiff = await api.git.raw(repo.path, ['diff', '--no-color', `${baseRef}..${compareRef}`, '--', file]);
        result = parseRawDiff(rawDiff, file);
      } else {
        result = await api.git.diff(repo.path, file, { ref: baseRef, staged: compareMode === 'staged' });
      }
      setDiff(result);
    } catch (e) {
      toast.error(t('diff.loadFileFailed'), String(e));
    } finally {
      setLoading(false);
    }
  };

  // Reset file selection when baseRef or compareMode changes
  useEffect(() => {
    setSelectedFileInList(null);
  }, [baseRef, compareMode, compareRef]);

  // Repo switch: stale local state from the previous repository must not
  // survive — refs from repo A are meaningless (and resolve empty) in repo B.
  // IMPORTANT: skip the initial mount — prefill-from-global effects above run
  // on mount (deep links, History → Diff hand-off) and must not be wiped.
  const prevDiffRepoPathRef = useRef(repo.path);
  useEffect(() => {
    if (prevDiffRepoPathRef.current === repo.path) return;
    prevDiffRepoPathRef.current = repo.path;
    setFilePath('.');
    setBaseRef('HEAD');
    setCompareMode('working');
    setCompareRef('');
    setStashHash(null);
    setDiff(null);
    setChangedFiles([]);
    setSelectedFileInList(null);
    setFileListFilter('');
  }, [repo.path]);

  if (!repo) {
    return <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">{t('diff.noRepository')}</div>;
  }

  const title = stashHash
    ? t('diff.stashContentTitle', { hash: shortHash(stashHash) })
    : compareMode === 'ref' && compareRef
      ? `${baseRef} → ${compareRef}` // pure refs — nothing to translate
      : compareMode === 'staged'
        ? t('diff.toStaged', { base: baseRef })
        : t('diff.toWorkingTree', { base: baseRef });

  // The file the toolbar actions (Blame) and the header bar refer to.
  const blameTarget = selectedFileInList || filePath;

  // Filtered view of the changed-file list (case-insensitive substring).
  const visibleFiles = useMemo(() => {
    const q = fileListFilter.trim().toLowerCase();
    if (!q) return changedFiles;
    return changedFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [changedFiles, fileListFilter]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header with comparison controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-default bg-bg-tertiary flex-wrap">
        <span className="text-xs font-semibold flex-shrink-0">{t('nav.diff')}</span>

        {/* File path input */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <FileText size={11} className="text-text-tertiary" />
          <input
            type="text"
            placeholder={t('diff.filePathPlaceholder')}
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            className="text-xs w-48 px-2 py-1 font-mono bg-bg-secondary border border-border-default rounded"
            title={t('diff.filePathTooltip')}
          />
        </div>

        {/* Base ref selector */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-2xs text-text-tertiary">{t('diff.baseLabel')}</span>
          <select
            value={baseRef}
            onChange={(e) => setBaseRef(e.target.value)}
            className="text-xs px-1.5 py-1 bg-bg-secondary border border-border-default rounded font-mono"
            title={t('diff.baseTooltip')}
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
          {/* Cross-tool link: apply the commit currently selected in History/Tags
              without hunting for it in the dropdown */}
          {globalCommitHash && baseRef !== globalCommitHash && (
            <button
              className="text-2xs px-1.5 py-0.5 rounded border border-accent/40 bg-accent-muted text-accent whitespace-nowrap"
              title={t('diff.useSelectedCommit', { hash: shortHash(globalCommitHash) })}
              onClick={() => setBaseRef(globalCommitHash)}
            >
              → {shortHash(globalCommitHash)}
            </button>
          )}
        </div>

        {/* Arrow */}
        <span className="text-text-tertiary flex-shrink-0">→</span>

        {/* Compare mode selector */}
        <div className="flex items-center gap-0">
          <button
            className={cn('text-2xs px-2.5 py-1 rounded-l border',
              compareMode === 'working' ? 'bg-accent text-text-inverse border-accent' : 'bg-bg-secondary text-text-secondary border-border-default hover:bg-bg-hover')}
            onClick={() => setCompareMode('working')}
            title={t('diff.workingTreeTooltip')}
          >
            {t('diff.workingTree')}
          </button>
          <button
            className={cn('text-2xs px-2.5 py-1 border-t border-b',
              compareMode === 'staged' ? 'bg-accent text-text-inverse border-accent' : 'bg-bg-secondary text-text-secondary border-border-default hover:bg-bg-hover')}
            onClick={() => setCompareMode('staged')}
            title={t('diff.stagedTooltip')}
          >
            {t('changes.staged')}
          </button>
          <button
            className={cn('text-2xs px-2.5 py-1 rounded-r border',
              compareMode === 'ref' ? 'bg-accent text-text-inverse border-accent' : 'bg-bg-secondary text-text-secondary border-border-default hover:bg-bg-hover')}
            onClick={() => setCompareMode('ref')}
            title={t('diff.refTooltip')}
          >
            {t('diff.refButton')}
          </button>
        </div>

        {/* Compare ref input (only for 'ref' mode) */}
        {compareMode === 'ref' && (
          <select
            value={compareRef}
            onChange={(e) => setCompareRef(e.target.value)}
            className="text-xs px-1.5 py-1 bg-bg-secondary border border-border-default rounded font-mono"
            title={t('diff.compareTooltip')}
          >
            <option value="">{t('diff.selectRef')}</option>
            {branches.filter(b => !b.remote).map(b => (
              <option key={b.name} value={b.name}>{b.name}</option>
            ))}
            {recentCommits.map(c => (
              <option key={c.hash} value={c.hash}>{shortHash(c.hash)} · {c.subject.substring(0, 40)}</option>
            ))}
          </select>
        )}

        {/* Blame the file currently shown in the diff (or the selected one
            from the file list) — mirrors the "Blame this file..." entry of
            the file context menu. */}
        <button
          className="icon-btn !w-6 !h-6 ml-auto"
          title={t('diff.blameTooltip')}
          disabled={!blameTarget || blameTarget === '.'}
          onClick={() => {
            if (!blameTarget || blameTarget === '.') return;
            useSelectionStore.getState().selectFile(blameTarget);
            window.location.hash = '#/blame';
          }}
        >
          <Search size={12} />
        </button>
        <button className="icon-btn !w-6 !h-6" title={t('common.refresh')} onClick={computeDiff}>
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Diff title bar */}
      <div className="px-3 py-1 border-b border-border-subtle bg-bg-secondary text-2xs text-text-tertiary font-mono truncate">
        {loading ? t('diff.computing') : title} · {selectedFileInList || filePath}
      </div>

      {/* Body: file list (left, when multi-file) + splitter + diff viewer (right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list sidebar — shown when comparing all files ('.') */}
        {changedFiles.length > 0 && (
          <>
            <div
              className="flex-shrink-0 border-r border-border-default overflow-y-auto bg-bg-secondary"
              style={{ width: fileListWidth }}
            >
              <div className="px-2 py-1.5 text-2xs font-bold uppercase tracking-wider text-text-tertiary border-b border-border-subtle sticky top-0 bg-bg-secondary">
                {visibleFiles.length !== changedFiles.length
                  ? t('diff.changedFilesOf', { count: visibleFiles.length, total: changedFiles.length })
                  : t('diff.changedFiles', { count: visibleFiles.length })}
              </div>
              {changedFiles.length > 5 && (
                <div className="px-2 py-1 border-b border-border-subtle">
                  <input
                    type="text"
                    className="w-full text-2xs px-1.5 py-0.5 bg-bg-primary border border-border-default rounded"
                    placeholder={t('diff.filterFiles')}
                    value={fileListFilter}
                    onChange={(e) => setFileListFilter(e.target.value)}
                  />
                </div>
              )}
              {visibleFiles.length === 0 && changedFiles.length > 0 && (
                <div className="px-2 py-2 text-2xs text-text-tertiary">{t('diff.noFilesMatch', { filter: fileListFilter.trim() })}</div>
              )}
              {visibleFiles.slice(0, 200).map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 text-2xs cursor-pointer hover:bg-bg-hover transition-colors',
                    selectedFileInList === f.path && 'bg-bg-selected'
                  )}
                  onClick={() => loadFileDiff(f.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Select + load the file under the cursor first, so the
                    // diff pane and any action act on exactly this file.
                    if (selectedFileInList !== f.path) loadFileDiff(f.path);
                    const fileCtx = {
                      repoPath: repo.path,
                      path: f.path,
                      mode: 'diff' as const,
                    };
                    showContextMenu(buildFileMenu(fileCtx), async (action) => {
                      await runFileAction(action, fileCtx);
                    });
                  }}
                  title={t('diff.fileRowTooltip')}
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
                  {t('diff.showingFirst200', { count: changedFiles.length })}
                </div>
              )}
            </div>
            {/* Resizable splitter between file list and diff viewer — fixes the
                "no splitter between tree and Diff window" complaint. Drag left/right
                to shrink/grow the file list panel. */}
            <ResizableSplitter direction="horizontal" onResize={handleFileListResize} />
          </>
        )}

        {/* Diff viewer OR 3-way ConflictMergeView — when a conflicted file is
            selected during a merge/rebase/cherry-pick/revert, the Diff tool
            switches to a 3-way merge view (Ours | Working Tree | Theirs) instead of
            the normal 2-way diff. This is the SmartGit pattern: conflict
            resolution happens IN the Diff tool, not in a separate modal.
            The RepoStateBanner above the merge view surfaces the same
            Continue/Abort/etc. actions the user gets on the Changes page,
            so they can finish the operation without leaving the Diff tool. */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {showMergeView && (
            <RepoStateBanner
              status={status}
              busy={false}
              handlers={{
                cherryPick: {
                  onContinue: async () => {
                    try {
                      await api.git.raw(repo.path, ['cherry-pick', '--continue']);
                      toast.success('Cherry-pick continued');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Cherry-pick continue failed', String(e)); }
                  },
                  onSkip: async () => {
                    try {
                      await api.git.raw(repo.path, ['cherry-pick', '--skip']);
                      toast.success('Skipped');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Skip failed', String(e)); }
                  },
                  onCommitEmpty: async () => {
                    try {
                      await api.git.raw(repo.path, ['commit', '--allow-empty', '--no-edit']);
                      await api.git.raw(repo.path, ['cherry-pick', '--continue']);
                      toast.success('Committed empty');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Commit empty failed', String(e)); }
                  },
                  onAbort: async () => {
                    try {
                      await api.git.raw(repo.path, ['cherry-pick', '--abort']);
                      toast.success('Cherry-pick aborted');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Abort failed', String(e)); }
                  },
                },
                revert: {
                  onContinue: async () => {
                    try {
                      await api.git.raw(repo.path, ['revert', '--continue']);
                      toast.success('Revert continued');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Revert continue failed', String(e)); }
                  },
                  onSkip: async () => {
                    try {
                      await api.git.raw(repo.path, ['revert', '--skip']);
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Skip failed', String(e)); }
                  },
                  onAbort: async () => {
                    try {
                      await api.git.raw(repo.path, ['revert', '--abort']);
                      toast.success('Revert aborted');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Abort failed', String(e)); }
                  },
                },
                merge: {
                  onAbort: async () => {
                    try {
                      await api.git.raw(repo.path, ['merge', '--abort']);
                      toast.success('Merge aborted');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Abort failed', String(e)); }
                  },
                },
                rebase: {
                  onContinue: async () => {
                    try {
                      await api.git.raw(repo.path, ['rebase', '--continue']);
                      toast.success('Rebase continued');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Rebase continue failed', String(e)); }
                  },
                  onSkip: async () => {
                    try {
                      await api.git.raw(repo.path, ['rebase', '--skip']);
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Skip failed', String(e)); }
                  },
                  onAbort: async () => {
                    try {
                      await api.git.raw(repo.path, ['rebase', '--abort']);
                      toast.success('Rebase aborted');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Abort failed', String(e)); }
                  },
                },
                bisect: {
                  onGood: async () => {
                    try {
                      await api.git.raw(repo.path, ['bisect', 'good']);
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Bisect good failed', String(e)); }
                  },
                  onBad: async () => {
                    try {
                      await api.git.raw(repo.path, ['bisect', 'bad']);
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Bisect bad failed', String(e)); }
                  },
                  onSkip: async () => {
                    try {
                      await api.git.raw(repo.path, ['bisect', 'skip']);
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Skip failed', String(e)); }
                  },
                  onReset: async () => {
                    try {
                      await api.git.raw(repo.path, ['bisect', 'reset']);
                      toast.success('Bisect reset');
                      await refreshStatus(repo.path);
                    } catch (e) { toast.error('Bisect reset failed', String(e)); }
                  },
                },
              }}
            />
          )}
          {showMergeView ? (
            <ConflictMergeView
              filePath={activeFile}
              onResolved={async (resolvedFile) => {
                await refreshStatus(repo.path);
                // Auto-advance to next conflicted file
                const st = await api.git.status(repo.path);
                const next = st.conflicted.find((f: string) => f !== resolvedFile);
                if (next) {
                  setSelectedFileInList(next);
                  setFilePath(next);
                } else {
                  toast.success('All conflicts resolved', 'You can now Continue/Commit to finish.');
                }
              }}
            />
          ) : diff ? (
            <div className="flex-1 overflow-auto">
              <DiffViewer diff={diff} filePath={activeFile} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm p-8">
              {loading ? t('common.loading') : t('diff.selectRefs')}
            </div>
          )}
        </div>

        {/* Conflict badge in the header — visible when there are conflicted files */}
        {conflicted.length > 0 && (
          <div className="px-3 py-1 border-b border-status-conflict/30 bg-status-conflict/10 text-2xs text-status-conflict flex items-center gap-2 flex-shrink-0">
            <AlertCircle size={11} className="flex-shrink-0" />
            <span className="font-medium">{conflicted.length} conflict{conflicted.length === 1 ? '' : 's'}</span>
            {showMergeView && <span className="text-text-tertiary">— 3-way merge view active for {activeFile}</span>}
            {!showMergeView && <span className="text-text-tertiary">— select a conflicted file to resolve it here</span>}
          </div>
        )}
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
