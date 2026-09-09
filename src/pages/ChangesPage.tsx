import { useState, useEffect, useCallback } from 'react';
import { GitCommit, RefreshCw, Plus, Minus, ChevronDown, ChevronRight, GitPullRequest, RotateCcw, EyeOff, Folder, ExternalLink, Trash, Pencil, AlertCircle, Search } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type DiffResult, type FileStatus, type LogEntry } from '../lib/api';
import { DiffViewer } from '../components/DiffViewer';
import { ResizableSplitter, useResizableWidth, useResizableHeight } from '../components/ResizableSplitter';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { cn, getStatusColor, copyToClipboard } from '../lib/utils';
import { getInitials, getAuthorColor, formatTime } from '../lib/authorBadges';

interface ChangesPageProps {
  onResolveConflict?: (file: string) => void;
}

export function ChangesPage({ onResolveConflict }: ChangesPageProps = {}) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { status, refreshStatus, stageFiles, stageAll, commit, push, pull } = useGitStore();
  const toast = useToastStore();
  // Global UI state for file filtering and tree mode
  const fileViewMode = useSelectionStore((s) => s.fileViewMode);
  const setFileViewMode = useSelectionStore((s) => s.setFileViewMode);
  const compressFilePaths = useSelectionStore((s) => s.compressFilePaths);
  const setCompressFilePaths = useSelectionStore((s) => s.setCompressFilePaths);
  const fileStatusFilter = useSelectionStore((s) => s.fileStatusFilter);
  const setFileStatusFilter = useSelectionStore((s) => s.setFileStatusFilter);
  const fileStatusFilterSet = useSelectionStore((s) => s.fileStatusFilterSet);
  const toggleFileStatusFilter = useSelectionStore((s) => s.toggleFileStatusFilter);
  const clearFileStatusFilterSet = useSelectionStore((s) => s.clearFileStatusFilterSet);
  const fileScope = useSelectionStore((s) => s.fileScope);
  const setFileScope = useSelectionStore((s) => s.setFileScope);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const fileExtensionFilter = useSelectionStore((s) => s.fileExtensionFilter);
  const setFileExtensionFilter = useSelectionStore((s) => s.setFileExtensionFilter);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [amend, setAmend] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [draggedFile, setDraggedFile] = useState<string | null>(null);
  const [journal, setJournal] = useState<LogEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [showSplitView, setShowSplitView] = useState(true);
  const { width: leftWidth, handleResize: handleLeftResize } = useResizableWidth(500, 250, 800);
  const { height: journalHeight, handleResize: handleJournalResize } = useResizableHeight(180, 60, 400);
  const showContextMenu = useContextMenu();

  const loadDiff = useCallback(
    async (file: string, staged: boolean) => {
      setDiffLoading(true);
      try {
        const result = await api.git.diff(repo.path, file, { staged });
        setDiff(result);
      } catch (e) {
        toast.error('Failed to load diff', String(e));
        setDiff(null);
      } finally {
        setDiffLoading(false);
      }
    },
    [repo.path, toast]
  );

  const loadJournal = useCallback(async () => {
    setJournalLoading(true);
    try {
      const result = await api.git.log(repo.path, { maxCount: 20 });
      setJournal(result);
    } catch {
      /* ignore */
    } finally {
      setJournalLoading(false);
    }
  }, [repo.path]);

  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      return;
    }
    const isStaged = status?.staged.some((s) => s.path === selectedFile) ?? false;
    loadDiff(selectedFile, isStaged);
  }, [selectedFile, status, loadDiff]);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  const handleRefresh = () => {
    refreshStatus(repo.path);
    loadJournal();
  };

  const handleStageAll = async () => {
    try {
      await stageAll(repo.path);
      toast.success('All changes staged');
    } catch (e) {
      toast.error('Failed to stage', String(e));
    }
  };

  const handleStageFile = async (file: string) => {
    try {
      await stageFiles(repo.path, [file]);
    } catch (e) {
      toast.error('Failed to stage file', String(e));
    }
  };

  const handleUnstageFile = async (file: string) => {
    try {
      await api.git.raw(repo.path, ['reset', 'HEAD', '--', file]);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Failed to unstage', String(e));
    }
  };

  const handleRestoreFile = async (file: string) => {
    if (!confirm(`Restore '${file}' to last commit? Local changes will be lost.`)) return;
    try {
      await api.git.restore(repo.path, [file]);
      toast.success('File restored');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Restore failed', String(e));
    }
  };

  const handleIgnoreFile = async (file: string) => {
    try {
      await api.git.ignore(repo.path, [file]);
      toast.success('Added to .gitignore');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Failed to ignore', String(e));
    }
  };

  const handleDeleteFile = async (file: string) => {
    if (!confirm(`Delete '${file}'? This cannot be undone.`)) return;
    try {
      await api.git.raw(repo.path, ['rm', '-f', '--', file]);
      toast.success('File deleted');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Delete failed', String(e));
    }
  };

  const handleRevealFile = async (file: string) => {
    try {
      const fullPath = `${repo.path}/${file}`.replace(/\/+/g, '/');
      await api.git.revealInFileManager(fullPath);
    } catch (e) {
      toast.error('Failed to reveal', String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast.warning('Commit message is required');
      return;
    }
    try {
      const hash = await commit(repo.path, commitMsg, amend);
      toast.success('Commit created', `Hash: ${hash.substring(0, 7)}`);
      setCommitMsg('');
      setAmend(false);
      await loadJournal();
    } catch (e) {
      toast.error('Commit failed', String(e));
    }
  };

  const handleCommitAndPush = async () => {
    await handleCommit();
    try {
      await push(repo.path);
      toast.success('Pushed successfully');
    } catch (e) {
      toast.error('Push failed', String(e));
    }
  };

  // File scope helper: filter out nested paths if scope is 'top'
  const scopeFilter = (path: string): boolean => {
    if (fileScope === 'all') return true;
    // 'top' mode: only files directly in repo root (no '/' in path)
    return !path.includes('/');
  };

  // Multi-select status set helper
  const matchesStatusSet = (file: FileStatus, isStaged: boolean): boolean => {
    if (fileStatusFilterSet.size === 0) return true;
    const idx = file.index as string;
    const wd = file.working_dir as string;
    const code = idx !== ' ' && idx !== '?' ? idx : wd;
    if (fileStatusFilterSet.has('staged') && isStaged) return true;
    if (fileStatusFilterSet.has('unstaged') && !isStaged) return true;
    if (fileStatusFilterSet.has('modified') && (code === 'M' || code === 'R' || code === 'C' || code === 'T')) return true;
    if (fileStatusFilterSet.has('added') && code === 'A') return true;
    if (fileStatusFilterSet.has('deleted') && code === 'D') return true;
    if (fileStatusFilterSet.has('renamed') && (code === 'R' || code === 'C')) return true;
    if (fileStatusFilterSet.has('untracked') && code === '?') return true;
    return false;
  };

  const stagedFiles: FileStatus[] = (status?.files || []).filter((f) => {
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) return false;
    const idx = staged.index as string;
    return idx !== ' ' && idx !== '?' && idx !== '!';
  }).filter(f => !fileFilter || f.path.toLowerCase().includes(fileFilter.toLowerCase()))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter(f => scopeFilter(f.path))
    .filter(f => matchesStatusSet(f, true))
    .filter(f => {
      if (fileStatusFilter === 'all') return true;
      const idx = f.index as string;
      const code = idx !== ' ' && idx !== '?' ? idx : (f.working_dir as string);
      if (fileStatusFilter === 'modified') return code === 'M' || code === 'R' || code === 'C' || code === 'T';
      if (fileStatusFilter === 'added') return code === 'A';
      if (fileStatusFilter === 'deleted') return code === 'D';
      if (fileStatusFilter === 'untracked') return code === '?';
      return true;
    });

  const unstagedFiles: FileStatus[] = (status?.files || []).filter((f) => {
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) {
      const wd = f.working_dir as string;
      return wd !== ' ' && wd !== '!';
    }
    const wd = staged.working_dir as string;
    return wd !== ' ' && wd !== '!';
  }).filter(f => !fileFilter || f.path.toLowerCase().includes(fileFilter.toLowerCase()))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter(f => scopeFilter(f.path))
    .filter(f => matchesStatusSet(f, false))
    .filter(f => {
      if (fileStatusFilter === 'all') return true;
      const idx = f.index as string;
      const code = idx !== ' ' && idx !== '?' ? idx : (f.working_dir as string);
      if (fileStatusFilter === 'modified') return code === 'M' || code === 'R' || code === 'C' || code === 'T';
      if (fileStatusFilter === 'added') return code === 'A';
      if (fileStatusFilter === 'deleted') return code === 'D';
      if (fileStatusFilter === 'untracked') return code === '?';
      return true;
    });

  const untrackedFiles: FileStatus[] = (status?.files || []).filter((f) => {
    const idx = f.index as string;
    const wd = f.working_dir as string;
    return idx === '?' && wd === '?';
  }).filter(f => !fileFilter || f.path.toLowerCase().includes(fileFilter.toLowerCase()))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter(f => scopeFilter(f.path));

  const totalChanged = (status?.files.length ?? 0);

  const getRelativeDir = (filePath: string): string => {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) return '';
    return filePath.substring(0, lastSlash);
  };

  const getFileName = (filePath: string): string => {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) return filePath;
    return filePath.substring(lastSlash + 1);
  };

  const renderFileRow = (file: FileStatus, isStaged: boolean) => {
    const isSelected = selectedFile === file.path;
    const idx = file.index as string;
    const wd = file.working_dir as string;
    const code = idx !== ' ' && idx !== '?' ? idx : wd;
    const statusCode =
      code === '?' ? 'untracked' :
      code === 'U' ? 'conflict' :
      code === 'M' ? 'modified' :
      code === 'A' ? 'added' :
      code === 'D' ? 'deleted' :
      code === 'R' ? 'renamed' :
      code === 'C' ? 'copied' :
      'modified';
    const isUntracked = idx === '?' && wd === '?';
    const isConflict = code === 'U' || idx === 'U' || wd === 'U';
    const stateLabel = statusCode.charAt(0).toUpperCase() + statusCode.slice(1);

    return (
      <div
        key={file.path}
        className={cn(
          'group flex items-center gap-2 px-2 py-1 cursor-pointer text-xs border-b border-border-subtle',
          isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        )}
        draggable
        onDragStart={(e) => {
          setDraggedFile(file.path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDraggedFile(null)}
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drag-over');
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drag-over');
          if (draggedFile && draggedFile !== file.path) {
            if (isStaged) handleUnstageFile(draggedFile);
            else handleStageFile(draggedFile);
          }
          setDraggedFile(null);
        }}
        onClick={() => setSelectedFile(file.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSelectedFile(file.path);
          const items: ContextMenuItem[] = [];
          if (isStaged) {
            items.push({ label: 'Unstage', clickId: 'unstage' });
            items.push({ label: 'Discard staged changes', clickId: 'discard-staged' });
          } else {
            items.push({ label: 'Stage', clickId: 'stage' });
            if (!isUntracked) {
              items.push({ label: 'Restore to last commit (discard)', clickId: 'restore' });
            }
          }
          items.push({ type: 'separator' });
          if (isUntracked) {
            items.push({ label: 'Add to .gitignore', clickId: 'ignore' });
            items.push({ label: 'Delete file', clickId: 'delete' });
          }
          if (isConflict) {
            items.push({ type: 'separator' });
            items.push({ label: 'Resolve Conflict...', clickId: 'resolve' });
          }
          items.push({ type: 'separator' });
          items.push({ label: 'Reveal in File Manager', clickId: 'reveal' });
          items.push({ label: 'Open in Editor', clickId: 'open' });
          items.push({ type: 'separator' });
          items.push({ label: 'View file history...', clickId: 'file-history' });
          items.push({ label: 'Blame this file...', clickId: 'blame' });
          items.push({ type: 'separator' });
          items.push({ label: 'Copy path', clickId: 'copy-path' });
          items.push({ label: 'Copy full path', clickId: 'copy-full-path' });
          showContextMenu(items, (action) => {
            if (action === 'stage') handleStageFile(file.path);
            else if (action === 'unstage') handleUnstageFile(file.path);
            else if (action === 'restore') handleRestoreFile(file.path);
            else if (action === 'discard-staged') {
              if (!confirm(`Discard staged changes for '${file.path}'?\nThis will unstage AND restore the file to HEAD.`)) return;
              api.git.raw(repo.path, ['reset', 'HEAD', '--', file.path]).then(() =>
                api.git.restore(repo.path, [file.path])
              ).then(() => {
                toast.success('Staged changes discarded');
                refreshStatus(repo.path);
              }).catch((e) => toast.error('Discard failed', String(e)));
            }
            else if (action === 'ignore') handleIgnoreFile(file.path);
            else if (action === 'delete') handleDeleteFile(file.path);
            else if (action === 'resolve' && onResolveConflict) onResolveConflict(file.path);
            else if (action === 'reveal') handleRevealFile(file.path);
            else if (action === 'open') {
              const fullPath = `${repo.path}/${file.path}`.replace(/\/+/g, '/');
              api.git.openFile(fullPath);
            }
            else if (action === 'file-history') {
              // Set global path filter and navigate to History page
              useSelectionStore.getState().selectFile(file.path);
              useSelectionStore.getState().setPathFilter(file.path);
              window.location.hash = '#/history';
            }
            else if (action === 'blame') {
              useSelectionStore.getState().selectFile(file.path);
              window.location.hash = '#/blame';
            }
            else if (action === 'copy-path') {
              copyToClipboard(file.path);
              toast.success('Path copied');
            }
            else if (action === 'copy-full-path') {
              copyToClipboard(`${repo.path}/${file.path}`.replace(/\/+/g, '/'));
              toast.success('Full path copied');
            }
          });
        }}
      >
        {/* State icon */}
        <span
          className="w-4 text-center font-bold flex-shrink-0"
          style={{ color: getStatusColor(statusCode) }}
        >
          {code}
        </span>
        {/* Name */}
        <span className="flex-1 truncate font-mono">{getFileName(file.path)}</span>
        {/* State text */}
        <span className="text-text-tertiary flex-shrink-0 italic" style={{ width: 70 }}>{stateLabel}</span>
        {/* Relative directory */}
        <span className="text-text-tertiary flex-shrink-0 text-right" style={{ width: 120 }}>{getRelativeDir(file.path)}</span>
        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
          {isConflict && onResolveConflict && (
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              title="Open Conflict Solver"
              onClick={(e) => { e.stopPropagation(); onResolveConflict(file.path); }}
            >
              Resolve
            </button>
          )}
          {isStaged ? (
            <button className="icon-btn !w-5 !h-5" title="Unstage" onClick={(e) => { e.stopPropagation(); handleUnstageFile(file.path); }}>
              <Minus size={11} />
            </button>
          ) : (
            <>
              <button className="icon-btn !w-5 !h-5" title="Stage" onClick={(e) => { e.stopPropagation(); handleStageFile(file.path); }}>
                <Plus size={11} />
              </button>
              {!isUntracked && (
                <button className="icon-btn !w-5 !h-5" title="Restore" onClick={(e) => { e.stopPropagation(); handleRestoreFile(file.path); }}>
                  <RotateCcw size={11} />
                </button>
              )}
              {isUntracked && (
                <>
                  <button className="icon-btn !w-5 !h-5" title="Ignore" onClick={(e) => { e.stopPropagation(); handleIgnoreFile(file.path); }}>
                    <EyeOff size={11} />
                  </button>
                  <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.path); }}>
                    <Trash size={11} />
                  </button>
                </>
              )}
              <button className="icon-btn !w-5 !h-5" title="Reveal" onClick={(e) => { e.stopPropagation(); handleRevealFile(file.path); }}>
                <Folder size={11} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-tertiary">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Files</span>
          {totalChanged > 0 && (
            <span className="text-2xs text-text-tertiary">
              {stagedFiles.length} staged · {unstagedFiles.length + untrackedFiles.length} unstaged
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            className="text-xs w-32 px-2 py-0.5"
            placeholder="File Filter"
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
          />
          {/* Multi-select status filter — dropdown with checkboxes */}
          <div className="relative">
            <button
              className={cn('text-2xs px-2 py-0.5 border rounded flex items-center gap-1',
                fileStatusFilterSet.size > 0
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-border-default bg-bg-tertiary text-text-secondary')}
              onClick={() => setShowStatusPicker(!showStatusPicker)}
              title="Filter files by status (multi-select)"
            >
              <span>Status:</span>
              <span>{fileStatusFilterSet.size > 0 ? `${fileStatusFilterSet.size} filters` : 'All'}</span>
              <ChevronDown size={9} />
            </button>
            {showStatusPicker && (
              <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 min-w-56">
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer text-xs border-b border-border-subtle">
                  <input type="checkbox"
                    checked={fileStatusFilterSet.size === 0}
                    onChange={() => clearFileStatusFilterSet()}
                  />
                  <span className="font-medium">All statuses</span>
                </label>
                {([
                  { id: 'staged', label: 'Staged' },
                  { id: 'unstaged', label: 'Unstaged' },
                  { id: 'modified', label: 'Modified' },
                  { id: 'added', label: 'Added (new)' },
                  { id: 'deleted', label: 'Deleted' },
                  { id: 'renamed', label: 'Renamed' },
                  { id: 'untracked', label: 'Untracked' },
                ] as const).map(opt => (
                  <label key={opt.id} className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs">
                    <input type="checkbox" checked={fileStatusFilterSet.has(opt.id)}
                      onChange={() => toggleFileStatusFilter(opt.id)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
                <div className="px-3 py-1 border-t border-border-subtle flex justify-between">
                  <button className="text-2xs text-accent" onClick={() => clearFileStatusFilterSet()}>Clear</button>
                  <button className="text-2xs btn btn-primary !py-0.5 !px-2" onClick={() => setShowStatusPicker(false)}>Done</button>
                </div>
              </div>
            )}
          </div>
          {/* File scope toggle: current dir only vs all nested */}
          <div className="flex bg-bg-tertiary border border-border-default rounded">
            <button
              className={cn('px-2 py-0.5 text-2xs rounded-l', fileScope === 'all' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
              onClick={() => setFileScope('all')}
              title="Show files from current directory AND all nested subdirectories"
            >
              All
            </button>
            <button
              className={cn('px-2 py-0.5 text-2xs rounded-r', fileScope === 'top' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
              onClick={() => setFileScope('top')}
              title="Show files from current directory only (no nested)"
            >
              Top
            </button>
          </div>
          {/* Extension filter */}
          <input
            type="text"
            className="text-2xs w-12 px-1 py-0.5 bg-bg-tertiary border border-border-default rounded"
            placeholder=".ts"
            value={fileExtensionFilter || ''}
            onChange={(e) => setFileExtensionFilter(e.target.value || null)}
            title="Filter by extension (e.g. .ts, .tsx)"
          />
          {/* Tree / Flat toggle */}
          <button
            className={cn('icon-btn !w-5 !h-5', fileViewMode === 'tree' && 'active')}
            title="Toggle tree view"
            onClick={() => setFileViewMode(fileViewMode === 'tree' ? 'flat' : 'tree')}
          >
            <Folder size={11} />
          </button>
          {/* Path compression toggle */}
          <button
            className={cn('icon-btn !w-5 !h-5', compressFilePaths && 'active')}
            title="Toggle path compression (collapse single-child folders)"
            onClick={() => setCompressFilePaths(!compressFilePaths)}
          >
            <EyeOff size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={handleRefresh}>
            <RefreshCw size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Stage All" onClick={handleStageAll}>
            <Plus size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: File list + Journal + Commit editor */}
        <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: leftWidth }}>
          {/* File list with table header */}
          <div className="flex-1 overflow-y-auto">
            {/* Table header */}
            <div className="flex items-center gap-2 px-2 py-1 bg-bg-tertiary border-b border-border-default text-2xs font-semibold uppercase text-text-secondary sticky top-0 z-10">
              <span className="w-4"></span>
              <span className="flex-1">Name</span>
              <span style={{ width: 70 }}>State</span>
              <span style={{ width: 120 }} className="text-right">Relative Directory</span>
              <span style={{ width: 60 }}></span>
            </div>

            {/* Conflicts */}
            {status?.conflicted && status.conflicted.length > 0 && (
              <div className="border-b border-status-conflict/30 bg-status-conflict/5">
                {status.conflicted.map((filePath) => (
                  <div
                    key={filePath}
                    className="group flex items-center gap-2 px-2 py-1 cursor-pointer text-xs hover:bg-bg-hover border-l-2 border-status-conflict"
                    onClick={() => onResolveConflict && onResolveConflict(filePath)}
                  >
                    <span className="font-bold w-4 text-center text-status-conflict">U</span>
                    <span className="flex-1 truncate font-mono">{filePath}</span>
                    <span className="text-text-tertiary italic" style={{ width: 70 }}>Conflict</span>
                    <span style={{ width: 120 }}></span>
                    <button className="btn btn-primary text-2xs !py-0.5 !px-2" onClick={(e) => { e.stopPropagation(); onResolveConflict && onResolveConflict(filePath); }}>
                      Resolve
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Staged */}
            {stagedFiles.length > 0 && (
              <div className="px-2 py-0.5 bg-bg-tertiary text-2xs font-semibold uppercase text-text-secondary border-b border-border-subtle">
                Staged ({stagedFiles.length})
              </div>
            )}
            {stagedFiles.map((f) => renderFileRow(f, true))}

            {/* Unstaged */}
            {unstagedFiles.length > 0 && (
              <div className="px-2 py-0.5 bg-bg-tertiary text-2xs font-semibold uppercase text-text-secondary border-b border-border-subtle">
                Changes ({unstagedFiles.length})
              </div>
            )}
            {unstagedFiles.map((f) => renderFileRow(f, false))}

            {/* Untracked */}
            {untrackedFiles.length > 0 && (
              <div className="px-2 py-0.5 bg-bg-tertiary text-2xs font-semibold uppercase text-text-secondary border-b border-border-subtle">
                Untracked ({untrackedFiles.length})
              </div>
            )}
            {untrackedFiles.map((f) => renderFileRow(f, false))}

            {totalChanged === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
                <GitCommit size={28} className="mb-2 opacity-50" />
                <div className="text-sm">Working tree clean</div>
                <div className="text-xs mt-1">No changes to commit</div>
              </div>
            )}
          </div>

          {/* Journal panel (bottom) — shows recent commits like SmartGit */}
          <div className="border-t border-border-default flex-shrink-0" style={{ height: journalHeight }}>
            <ResizableSplitter direction="vertical" onResize={handleJournalResize} />
            <div className="flex items-center justify-between px-2 py-1 bg-bg-tertiary border-b border-border-default">
              <span className="text-2xs font-semibold uppercase text-text-secondary">Journal</span>
              <span className="text-2xs text-text-tertiary">{journal.length} commits</span>
            </div>
            <div className="overflow-y-auto" style={{ height: 'calc(100% - 24px)' }}>
              {journalLoading ? (
                <div className="px-2 py-2 text-xs text-text-tertiary">Loading...</div>
              ) : journal.length === 0 ? (
                <div className="px-2 py-2 text-xs text-text-tertiary">No commits yet</div>
              ) : (
                journal.map((entry) => {
                  const initials = getInitials(entry.author.name);
                  const color = getAuthorColor(entry.author.name);
                  return (
                    <div
                      key={entry.hash}
                      className="group flex items-center gap-2 px-2 py-1 text-xs border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
                      onClick={() => {
                        // Click on a commit in journal → jump to History with this commit selected
                        useSelectionStore.getState().selectCommit(entry.hash);
                        window.location.hash = '#/history';
                      }}
                      title="Click to view this commit in History"
                    >
                      {/* Author badge */}
                      <span
                        className="flex-shrink-0 rounded text-white font-bold text-center"
                        style={{
                          backgroundColor: color.bg,
                          width: 24,
                          height: 18,
                          fontSize: 9,
                          lineHeight: '18px',
                        }}
                      >
                        {initials}
                      </span>
                      {/* Message */}
                      <span className="flex-1 truncate text-text-primary">{entry.subject}</span>
                      {/* Hash — clickable */}
                      <CommitHashLink hash={entry.hash} />
                      {/* Date */}
                      <span className="text-text-tertiary flex-shrink-0">{formatTime(entry.author.date)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Commit editor */}
          <div className="border-t border-border-default bg-bg-secondary p-2 flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <label className="flex items-center gap-1 text-2xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(e) => setAmend(e.target.checked)}
                />
                Amend last commit
              </label>
              <div className="flex-1" />
              <button
                className="btn btn-secondary text-xs"
                onClick={handleCommitAndPush}
                disabled={!commitMsg.trim() || stagedFiles.length === 0}
                title="Commit then push"
              >
                <GitPullRequest size={11} />
                Commit & Push
              </button>
              <button
                className="btn btn-primary text-xs"
                onClick={handleCommit}
                disabled={!commitMsg.trim() || stagedFiles.length === 0}
                title="Ctrl+Enter"
              >
                <GitCommit size={11} />
                Commit
              </button>
            </div>
            <textarea
              className="w-full text-sm font-mono resize-none"
              placeholder="Commit message..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleCommit();
                }
              }}
              style={{ height: 48 }}
            />
          </div>
        </div>

        {/* Right: Diff viewer */}
        {showSplitView && (
          <>
            <ResizableSplitter direction="horizontal" onResize={handleLeftResize} />
            <div className="flex-1 flex flex-col overflow-hidden">
              <DiffViewer diff={diff} loading={diffLoading} repoPath={repo.path} filePath={selectedFile || undefined} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
