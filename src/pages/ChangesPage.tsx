import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { DiffViewer } from '../components/DiffViewer';
import { DirTreePanel, ROOT_KEY } from '../components/DirTreePanel';
import { ArrowDown, ArrowUp, ChevronDown, ChevronsDownUp, ChevronsUpDown, Download, EyeOff, Folder, FolderOpen, GitCommit, GitPullRequest, Minus, Plus, RefreshCw, RotateCcw, Trash, X } from '../components/icons';
import { ResizableSplitter, useResizableHeight, useResizableWidth } from '../components/ResizableSplitter';
import { CommitHashLink } from '../components/StatusBar';
import { LazyFileList } from '../components/LazyFileList';
import { CommitMarkdownPreview } from '../components/CommitMarkdownPreview';
import { api, type DiffResult, type DirNode, type FileStatus, type LogEntry } from '../lib/api';
import { formatTime, getAuthorColor, getInitials } from '../lib/authorBadges';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { loadProjectPrefs, saveProjectPrefs } from '../lib/projectPrefs';
import { cn, copyToClipboard, getStatusColor } from '../lib/utils';
import { useGitStore } from '../stores/gitStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore } from '../stores/toastStore';

import { useEscapeKey } from '../hooks/useEscapeKey';
interface ChangesPageProps {
  onResolveConflict?: (file: string) => void;
}

type FileSortKey = 'name' | 'state' | 'dir';

/** Sortable column header for the Changes file table (SmartGit-style). */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  width,
  align,
  onResizeStart,
}: {
  label: string;
  sortKey: FileSortKey;
  sort: { key: FileSortKey; dir: 1 | -1 };
  onSort: (key: FileSortKey) => void;
  width?: number;
  align?: 'right';
  /** When set, renders a drag handle on the column's left edge to resize it. */
  onResizeStart?: (e: ReactMouseEvent) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      className={cn(
        'relative group flex items-center gap-0.5 uppercase hover:text-text-primary',
        active && 'text-accent',
        align === 'right' && 'justify-end'
      )}
      style={width ? { width } : { flex: 1 }}
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label.toLowerCase()}`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        sort.dir === 1 ? <ArrowUp size={9} /> : <ArrowDown size={9} />
      ) : (
        <ChevronDown size={9} className="opacity-40" />
      )}
      {onResizeStart && (
        // Resize handle sits on the column's LEFT boundary — see startColResize
        // for why (right-pinned columns grow leftward, so the left edge is the
        // only boundary that can follow the mouse). The inner grip line makes
        // the handle discoverable; the 12px hit area stays forgiving.
        <span
          className="absolute -left-1.5 -top-1 -bottom-1 w-3 z-20 cursor-col-resize flex items-center"
          title="Drag to resize column"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResizeStart(e);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="w-0.5 h-full my-0.5 ml-1 rounded-full bg-border-strong group-hover:bg-accent transition-colors" style={{ opacity: 0.45 }} />
        </span>
      )}
    </button>
  );
}

export function ChangesPage({ onResolveConflict }: ChangesPageProps = {}) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { status, lastRefresh, refreshStatus, stageFiles, stageAll, commit, push, pull } = useGitStore();
  const toast = useToastStore();

  // Listen for conflict resolution requests from GitToolbar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.file && onResolveConflict) {
        onResolveConflict(detail.file);
      }
    };
    window.addEventListener('smartgit:resolve-conflict', handler);
    return () => window.removeEventListener('smartgit:resolve-conflict', handler);
  }, [onResolveConflict]);
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
  const fileScopeDir = useSelectionStore((s) => s.fileScopeDir);
  const setFileScopeDir = useSelectionStore((s) => s.setFileScopeDir);
  const fileSort = useSelectionStore((s) => s.fileSort);
  const setFileSort = useSelectionStore((s) => s.setFileSort);
  const fileFilterRegex = useSelectionStore((s) => s.fileFilterRegex);
  const toggleFileFilterRegex = useSelectionStore((s) => s.toggleFileFilterRegex);
  const dirTreeVisible = useSelectionStore((s) => s.dirTreeVisible);
  const toggleDirTreeVisible = useSelectionStore((s) => s.toggleDirTreeVisible);
  const colWidths = useSelectionStore((s) => s.colWidths);
  const setColWidth = useSelectionStore((s) => s.setColWidth);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const fileExtensionFilter = useSelectionStore((s) => s.fileExtensionFilter);
  const setFileExtensionFilter = useSelectionStore((s) => s.setFileExtensionFilter);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  // For diff display — when multi-select, show diff of the last-clicked file
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const handleFileClick = (e: React.MouseEvent, filePath: string) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle selection in multi-select set
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      });
      // Still set the primary selection for diff display
      setSelectedFile(filePath);
    } else if (e.shiftKey) {
      // Range select — simplified: just add to set
      setSelectedFiles(prev => {
        const next = new Set(prev);
        next.add(filePath);
        return next;
      });
      setSelectedFile(filePath);
    } else {
      // Single click — clear multi-select, select only this file
      setSelectedFiles(new Set([filePath]));
      setSelectedFile(filePath);
    }
  };
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [amend, setAmend] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [draggedFile, setDraggedFile] = useState<string | null>(null);
  const [journal, setJournal] = useState<LogEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [showSplitView, setShowSplitView] = useState(true);
  const { width: leftWidth, setWidth: setLeftWidth, handleResize: handleLeftResize } = useResizableWidth(500, 250, 800);
  const { width: treeWidth, setWidth: setTreeWidth, handleResize: handleTreeResize } = useResizableWidth(210, 140, 380);
  const { height: journalHeight, setHeight: setJournalHeight, handleResize: handleJournalResize } = useResizableHeight(180, 60, 400);
  const { height: commitHeight, setHeight: setCommitHeight, handleResize: handleCommitResize } = useResizableHeight(120, 60, 500);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);
  const [dirTree, setDirTree] = useState<DirNode[]>([]);
  const [dirTreeLoading, setDirTreeLoading] = useState(false);
  const [trackedTotal, setTrackedTotal] = useState(0);
  // Per-file line-change counts for the Changes table (+N -M), like History.
  const [numstat, setNumstat] = useState<{ staged: Map<string, { add: number; del: number; binary: boolean }>; unstaged: Map<string, { add: number; del: number; binary: boolean }> }>({
    staged: new Map(),
    unstaged: new Map(),
  });
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([ROOT_KEY]));
  const showContextMenu = useContextMenu();

  // Per-project panel sizes (projectPrefs). "Настройки интерфейса должны
  // запоминаться на проект": apply the saved sizes when the repo opens, and
  // save them back (debounced) while the user drags the splitters.
  useEffect(() => {
    const prefs = loadProjectPrefs(repo.path);
    const clamp = (v: number | undefined, min: number, max: number, dflt: number) =>
      v == null || !Number.isFinite(v) ? dflt : Math.max(min, Math.min(max, v));
    setLeftWidth(clamp(prefs.changesLeftWidth, 250, 800, 500));
    setTreeWidth(clamp(prefs.changesTreeWidth, 140, 380, 210));
    setJournalHeight(clamp(prefs.journalHeight, 60, 400, 180));
    setCommitHeight(clamp(prefs.commitHeight, 60, 500, 120));
  }, [repo.path, setLeftWidth, setTreeWidth, setJournalHeight, setCommitHeight]);

  useEffect(() => {
    const t = setTimeout(() => {
      saveProjectPrefs(repo.path, {
        changesLeftWidth: leftWidth,
        changesTreeWidth: treeWidth,
        journalHeight,
        commitHeight,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [repo.path, leftWidth, treeWidth, journalHeight, commitHeight]);

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

  // Load diff when selected file changes — debounced to avoid multiple calls
  // when status refreshes or multiple events fire simultaneously.
  const lastLoadedFileRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      lastLoadedFileRef.current = null;
      return;
    }
    // Skip if we already loaded this exact file (avoids re-load on status refresh)
    if (lastLoadedFileRef.current === selectedFile) return;
    lastLoadedFileRef.current = selectedFile;

    const isStaged = status?.staged.some((s) => s.path === selectedFile) ?? false;
    // Debounce to avoid multiple rapid calls
    const timer = setTimeout(() => {
      loadDiff(selectedFile, isStaged);
    }, 150);
    return () => clearTimeout(timer);
  }, [selectedFile, status, loadDiff]);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  const loadDirTree = useCallback(async () => {
    setDirTreeLoading(true);
    try {
      const tree = await api.git.listDirectories(repo.path);
      setDirTree(tree);
    } catch {
      setDirTree([]);
    } finally {
      setDirTreeLoading(false);
    }
  }, [repo.path]);

  const loadTrackedCount = useCallback(async () => {
    try {
      const out = await api.git.raw(repo.path, ['ls-files']);
      setTrackedTotal(out ? out.split('\n').filter(Boolean).length : 0);
    } catch {
      setTrackedTotal(0);
    }
  }, [repo.path]);

  // Load line-change counts (+N -M) for working tree and index in one go.
  const loadNumstat = useCallback(async () => {
    try {
      const [unstagedOut, stagedOut] = await Promise.all([
        api.git.raw(repo.path, ['diff', '--numstat']),
        api.git.raw(repo.path, ['diff', '--cached', '--numstat']),
      ]);
      const parse = (out: string) => {
        const map = new Map<string, { add: number; del: number; binary: boolean }>();
        for (const line of out.split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split('\t');
          if (parts.length < 3) continue;
          let p = parts.slice(2).join('\t');
          if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
          map.set(p, {
            add: parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0,
            del: parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0,
            binary: parts[0] === '-' || parts[1] === '-',
          });
        }
        return map;
      };
      setNumstat({ staged: parse(stagedOut), unstaged: parse(unstagedOut) });
    } catch {
      setNumstat({ staged: new Map(), unstaged: new Map() });
    }
  }, [repo.path]);

  useEffect(() => {
    loadDirTree();
    loadTrackedCount();
    loadNumstat();
  }, [loadDirTree, loadTrackedCount, loadNumstat, lastRefresh, status]);

  // Reset folder scope and tree expansion when switching repositories
  useEffect(() => {
    setFileScopeDir(null);
    setExpandedDirs(new Set([ROOT_KEY]));
  }, [repo.path, setFileScopeDir]);

  const toggleDirExpand = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Collect every folder path that has children (for "expand all").
  const collectDirPaths = (nodes: DirNode[], acc: string[] = []): string[] => {
    for (const n of nodes) {
      if (n.children.length > 0) acc.push(n.path);
      collectDirPaths(n.children, acc);
    }
    return acc;
  };

  const expandAllDirs = () => {
    setExpandedDirs(new Set([ROOT_KEY, ...collectDirPaths(dirTree)]));
  };

  const collapseAllDirs = () => {
    setExpandedDirs(new Set([ROOT_KEY]));
  };

  // Column resize: drag the handle on a column header's LEFT edge.
  //
  // Why the handle is on the LEFT edge and why the math INVERTS the delta:
  // the Name column is flex-1 and absorbs all slack, so the State/Dir columns
  // are pinned against the RIGHT edge of the panel. When a column's width
  // changes, it grows/shrinks LEFTWARD — its right edge never moves, which
  // made the old right-edge handle feel broken ("inverted": drag right, the
  // column's visible boundary moved LEFT). With the handle on the column's
  // left boundary and width = start - dx, the boundary under the mouse tracks
  // the cursor 1:1 in both directions — the expected table-resize feel.
  const startColResize = (e: ReactMouseEvent, col: 'state' | 'dir') => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[col];
    const min = col === 'state' ? 46 : 50;
    const max = col === 'state' ? 220 : 480;
    const onMove = (ev: MouseEvent) => {
      setColWidth(col, Math.max(min, Math.min(max, startWidth - (ev.clientX - startX))));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSelectDir = (dir: string | null) => {
    setFileScopeDir(dir);
    if (dir) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        const parts = dir.split('/');
        for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'));
        return next;
      });
    }
  };

  const handleSort = (key: FileSortKey) => {
    setFileSort(fileSort.key === key ? { key, dir: fileSort.dir === 1 ? -1 : 1 } : { key, dir: 1 });
  };

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
      // resetFile = git reset <HEAD> -- <file> (unstages exactly this path)
      await api.git.resetFile(repo.path, file);
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

  // Reset a staged file back to HEAD (unstage exactly this path via git reset -- <file>)
  const handleResetFile = async (file: string) => {
    try {
      await api.git.resetFile(repo.path, file);
      toast.success(`'${file}' reset to HEAD (unstaged)`);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Reset file failed', String(e));
    }
  };

  // Restore a file from an arbitrary ref (git checkout <ref> -- <file>) — e.g. recover
  // an older version from another branch or commit without leaving the current branch.
  const handleCheckoutFileFromRef = async (file: string) => {
    const ref = prompt(
      `Restore '${file}' from a ref:\n\nEnter a ref (commit hash, branch, tag, HEAD~1, ...).\nThe working tree copy will be overwritten with that version.`
    );
    if (!ref || !ref.trim()) return;
    try {
      await api.git.checkoutFile(repo.path, file, ref.trim());
      toast.success(`'${file}' restored from ${ref.trim()}`);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(`Restore from ${ref.trim()} failed`, String(e));
    }
  };

  // Check whether a path is excluded by .gitignore rules
  const handleIsIgnored = async (file: string) => {
    try {
      const ignored = await api.git.isIgnored(repo.path, file);
      if (ignored) toast.info(`'${file}' IS ignored (matches .gitignore rules)`);
      else toast.info(`'${file}' is NOT ignored`);
    } catch (e) {
      toast.error('Check failed', String(e));
    }
  };

  // Open the effective ignore file in the system editor
  const handleEditIgnoreFile = async (scope: 'local' | 'global') => {
    try {
      const path = await api.git.editIgnoreFile(repo.path, scope);
      await api.git.openFile(path);
      toast.success(`Opened ${scope} ignore file`);
    } catch (e) {
      toast.error('Failed to open ignore file', String(e));
    }
  };

  // Clean untracked files/directories: dry-run preview first, then confirm
  const [showCleanDialog, setShowCleanDialog] = useState(false);
  useEscapeKey(showCleanDialog, () => setShowCleanDialog(false));
  const [cleanPreview, setCleanPreview] = useState<string[]>([]);
  const [cleanBusy, setCleanBusy] = useState(false);

  const handleCleanPreview = async () => {
    setCleanBusy(true);
    try {
      const result = await api.git.clean(repo.path, [], true, false, true);
      setCleanPreview(result);
      setShowCleanDialog(true);
    } catch (e) {
      toast.error('Clean preview failed', String(e));
    } finally {
      setCleanBusy(false);
    }
  };

  const handleCleanExecute = async () => {
    setCleanBusy(true);
    try {
      const removed = await api.git.clean(repo.path, [], false, true, true);
      toast.success(`Removed ${removed.length} path${removed.length === 1 ? '' : 's'}`);
      setShowCleanDialog(false);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Clean failed', String(e));
    } finally {
      setCleanBusy(false);
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

  // File filter helper: substring, or regular expression when .* mode is on.
  // Invalid regexes never hide files.
  const matchesFileFilter = (path: string): boolean => {
    const q = fileFilter.trim();
    if (!q) return true;
    if (fileFilterRegex) {
      try {
        return new RegExp(q, 'i').test(path);
      } catch {
        return true;
      }
    }
    return path.toLowerCase().includes(q.toLowerCase());
  };

  // Directory scope helper: only files inside the folder selected in the tree.
  const matchesDirScope = (path: string): boolean => {
    if (!fileScopeDir) return true;
    return path === fileScopeDir || path.startsWith(`${fileScopeDir}/`);
  };

  // Sort helper for the Changes table (Name / State / Relative Directory).
  const sortFiles = (files: FileStatus[]): FileStatus[] => {
    const nameOf = (p: string) => {
      const i = p.lastIndexOf('/');
      return i === -1 ? p : p.slice(i + 1);
    };
    const dirOf = (p: string) => {
      const i = p.lastIndexOf('/');
      return i === -1 ? '' : p.slice(0, i);
    };
    const rank: Record<string, number> = { U: 0, M: 1, A: 2, R: 3, C: 4, T: 5, D: 6, '?': 7 };
    return [...files].sort((a, b) => {
      let r = 0;
      if (fileSort.key === 'name') {
        r = nameOf(a.path).localeCompare(nameOf(b.path));
      } else if (fileSort.key === 'dir') {
        r = dirOf(a.path).localeCompare(dirOf(b.path)) || nameOf(a.path).localeCompare(nameOf(b.path));
      } else {
        const ca = (a.index as string) !== ' ' && (a.index as string) !== '?' ? (a.index as string) : (a.working_dir as string);
        const cb = (b.index as string) !== ' ' && (b.index as string) !== '?' ? (b.index as string) : (b.working_dir as string);
        r = ((rank[ca] ?? 9) - (rank[cb] ?? 9)) || a.path.localeCompare(b.path);
      }
      return r * fileSort.dir;
    });
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

  const stagedFiles: FileStatus[] = sortFiles((status?.files || []).filter((f) => {
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) return false;
    const idx = staged.index as string;
    return idx !== ' ' && idx !== '?' && idx !== '!';
  }).filter((f) => matchesFileFilter(f.path))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter((f) => matchesDirScope(f.path))
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
    }));

  const unstagedFiles: FileStatus[] = sortFiles((status?.files || []).filter((f) => {
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) {
      const wd = f.working_dir as string;
      // Exclude untracked ('??') — they render in their own Untracked section;
      // including them here duplicated every untracked file in both sections.
      return wd !== ' ' && wd !== '!' && !((f.index as string) === '?' && wd === '?');
    }
    const wd = staged.working_dir as string;
    return wd !== ' ' && wd !== '!';
  }).filter((f) => matchesFileFilter(f.path))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter((f) => matchesDirScope(f.path))
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
    }));

  const untrackedFiles: FileStatus[] = sortFiles((status?.files || []).filter((f) => {
    const idx = f.index as string;
    const wd = f.working_dir as string;
    return idx === '?' && wd === '?';
  }).filter((f) => matchesFileFilter(f.path))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter((f) => matchesDirScope(f.path))
    .filter((f) => matchesStatusSet(f, false))
    .filter(() => {
      if (fileStatusFilter === 'all' || fileStatusFilter === 'untracked') return true;
      return false;
    }));

  const totalChanged = (status?.files.length ?? 0);

  // SmartGit-style folder highlighting: number of changed files per directory
  // (every ancestor folder of a changed file gets a counter). Conflicted files
  // are counted too — they may not be present in status.files.
  const dirChangeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    const add = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
      }
    };
    for (const f of status?.files ?? []) add(f.path);
    for (const p of status?.conflicted ?? []) add(p);
    return counts;
  }, [status]);

  // SmartGit-style "N files hidden": tracked files without any changes.
  const changedTrackedCount = (status?.files ?? []).filter((f) => {
    const idx = f.index as string;
    const wd = f.working_dir as string;
    return (idx !== ' ' && idx !== '?' && idx !== '!') || (wd !== ' ' && wd !== '?' && wd !== '!');
  }).length;
  const hiddenCount = Math.max(0, trackedTotal - changedTrackedCount);

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
    const isSelected = selectedFiles.has(file.path);
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
    // Untracked directories come from porcelain as 'dir/' — show the folder
    // itself as the name and its parent as the relative directory.
    const isDirEntry = file.path.endsWith('/');
    const displayName = isDirEntry
      ? file.path.slice(file.path.lastIndexOf('/', file.path.length - 2) + 1)
      : getFileName(file.path);
    const relDir = getRelativeDir(isDirEntry ? file.path.slice(0, -1) : file.path);
    // Line-change counts (+N -M) from numstat; untracked files have none.
    const stats = isUntracked ? undefined : (isStaged ? numstat.staged : numstat.unstaged).get(file.path);

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
        onClick={(e) => handleFileClick(e, file.path)}
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
              items.push({ label: 'Restore from ref...', clickId: 'restore-from-ref' });
            }
          }
          items.push({ type: 'separator' });
          if (isUntracked) {
            items.push({ label: 'Add to .gitignore', clickId: 'ignore' });
            items.push({ label: 'Check if ignored', clickId: 'check-ignored' });
            items.push({ label: 'Delete file', clickId: 'delete' });
            items.push({ type: 'separator' });
            items.push({ label: 'Edit .gitignore', clickId: 'edit-ignore-local' });
            items.push({ label: 'Edit global ignore file', clickId: 'edit-ignore-global' });
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
          items.push({ label: 'Stash this file only...', clickId: 'stash-file' });
          items.push({ type: 'separator' });
          items.push({ label: 'Copy path', clickId: 'copy-path' });
          items.push({ label: 'Copy full path', clickId: 'copy-full-path' });
          showContextMenu(items, async (action) => {
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
            else if (action === 'check-ignored') handleIsIgnored(file.path);
            else if (action === 'restore-from-ref') handleCheckoutFileFromRef(file.path);
            else if (action === 'edit-ignore-local') handleEditIgnoreFile('local');
            else if (action === 'edit-ignore-global') handleEditIgnoreFile('global');
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
            else if (action === 'stash-file') {
              // Stash only this file: git stash push -- <file>
              try {
                await api.git.stashPush(repo.path, undefined, false, false, [file.path]);
                toast.success(`Stashed file: ${file.path}`);
                refreshStatus(repo.path);
              } catch (e) {
                toast.error('Stash failed', String(e));
              }
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
        <span className="flex-1 truncate font-mono whitespace-nowrap" title={file.path}>{displayName}</span>
        {/* Line-change counts (+N -M) — reserved width keeps columns aligned */}
        <span
          className="text-2xs flex-shrink-0 text-right tabular-nums whitespace-nowrap overflow-hidden"
          style={{ width: 74 }}
          title="Lines added / removed"
        >
          {stats && !stats.binary && (stats.add > 0 || stats.del > 0) && (
            <>
              <span className="text-status-added">+{stats.add}</span>
              <span className="text-status-deleted ml-1">-{stats.del}</span>
            </>
          )}
        </span>
        {/* State text */}
        <span className="text-text-tertiary flex-shrink-0 italic truncate whitespace-nowrap" style={{ width: colWidths.state }}>{stateLabel}</span>
        {/* Relative directory — always reserve the cell when the column is
            visible, so rows with an empty relDir (repo-root files) stay
            column-aligned with the header and other rows. */}
        {!compressFilePaths && (
          <span className="text-text-tertiary flex-shrink-0 truncate whitespace-nowrap" style={{ width: colWidths.dir }} title={relDir}>{relDir}</span>
        )}
        {/* Actions — fixed width so all rows stay column-aligned */}
        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0 overflow-hidden" style={{ width: 92 }}>
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
              <button className="icon-btn !w-5 !h-5" title="Reveal in file manager" onClick={(e) => { e.stopPropagation(); handleRevealFile(file.path); }}>
                <FolderOpen size={11} />
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
          {hiddenCount > 0 && (
            <button
              className="clickable-text text-2xs"
              title="Tracked files without changes. Click to toggle visibility."
              onClick={() => {
                // Toggle showing all tracked files (even unchanged).
                // We piggyback on the file status filter — when ALL is set,
                // the file list includes unchanged tracked files too.
                const store = useSelectionStore.getState();
                store.setFileStatusFilter(store.fileStatusFilter === 'all' ? 'modified' : 'all');
              }}
            >
              {hiddenCount.toLocaleString()} files hidden
            </button>
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
          <button
            className={cn('text-2xs px-1.5 py-0.5 border rounded font-mono',
              fileFilterRegex
                ? 'border-accent bg-accent-muted text-accent'
                : 'border-border-default bg-bg-tertiary text-text-secondary hover:text-text-primary')}
            onClick={toggleFileFilterRegex}
            title="Treat File Filter as a regular expression"
          >
            .*
          </button>
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
          {/* Extension filter */}
          <input
            type="text"
            className="text-2xs w-12 px-1 py-0.5 bg-bg-tertiary border border-border-default rounded"
            placeholder=".ts"
            value={fileExtensionFilter || ''}
            onChange={(e) => setFileExtensionFilter(e.target.value || null)}
            title="Filter by extension (e.g. .ts, .tsx)"
          />
          {/* Directory tree panel toggle (folder scope lives in the tree) */}
          <button
            className={cn('icon-btn !w-5 !h-5', dirTreeVisible && 'active')}
            title="Toggle directory tree panel"
            onClick={toggleDirTreeVisible}
          >
            {dirTreeVisible ? <FolderOpen size={11} /> : <Folder size={11} />}
          </button>
          {/* Path compression toggle — EyeOff = hide relative dir column */}
          <button
            className={cn('icon-btn !w-5 !h-5', !compressFilePaths && 'active')}
            title={compressFilePaths ? 'Show relative directory column' : 'Hide relative directory column (compressed view)'}
            onClick={() => setCompressFilePaths(!compressFilePaths)}
          >
            <EyeOff size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={handleRefresh}>
            <RefreshCw size={11} />
          </button>
          <button
            className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
            title="Clean untracked files and directories (git clean -fd) — shows a preview first"
            onClick={handleCleanPreview}
          >
            <Trash size={11} />
          </button>
          {selectedFiles.size > 1 && (
            <>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-added" title={`Stage ${selectedFiles.size} selected files`}
                onClick={async () => {
                  try {
                    await stageFiles(repo.path, Array.from(selectedFiles));
                    toast.success(`Staged ${selectedFiles.size} files`);
                    setSelectedFiles(new Set());
                  } catch (e) { toast.error('Stage failed', String(e)); }
                }}>
                <Plus size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-modified" title={`Stash ${selectedFiles.size} selected files`}
                onClick={async () => {
                  try {
                    await api.git.stashPush(repo.path, `Selected ${selectedFiles.size} files`, false, false, Array.from(selectedFiles));
                    toast.success(`Stashed ${selectedFiles.size} files`);
                    setSelectedFiles(new Set());
                    refreshStatus(repo.path);
                  } catch (e) { toast.error('Stash failed', String(e)); }
                }}>
                <Download size={11} />
              </button>
            </>
          )}
          <button className="icon-btn !w-5 !h-5" title="Stage All" onClick={handleStageAll}>
            <Plus size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Directory tree panel (SmartGit-style) — selects the folder scope */}
        {dirTreeVisible && (
          <>
            <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: treeWidth }}>
              <div className="flex items-center justify-between px-2 py-1 bg-bg-tertiary border-b border-border-default">
                <span className="text-2xs font-semibold uppercase text-text-secondary">Repositories</span>
                <div className="flex items-center gap-0.5">
                  <button
                    className="icon-btn !w-4 !h-4"
                    title="Expand all folders"
                    onClick={expandAllDirs}
                  >
                    <ChevronsUpDown size={11} />
                  </button>
                  <button
                    className="icon-btn !w-4 !h-4"
                    title="Collapse all folders"
                    onClick={collapseAllDirs}
                  >
                    <ChevronsDownUp size={11} />
                  </button>
                  {fileScopeDir && (
                    <button
                      className="icon-btn !w-4 !h-4"
                      title="Clear folder scope — show all files"
                      onClick={() => setFileScopeDir(null)}
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <DirTreePanel
                  repoName={repo.path.split(/[\\/]/).filter(Boolean).pop() ?? repo.path}
                  branch={status?.current ?? null}
                  tree={dirTree}
                  loading={dirTreeLoading}
                  expanded={expandedDirs}
                  onToggleExpand={toggleDirExpand}
                  selectedDir={fileScopeDir}
                  onSelectDir={handleSelectDir}
                  changeCounts={dirChangeCounts}
                  totalChanges={totalChanged}
                />
              </div>
            </div>
            <ResizableSplitter direction="horizontal" onResize={handleTreeResize} />
          </>
        )}

        {/* Left: File list + Journal + Commit editor */}
        <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: leftWidth }}>
          {/* File list with table header */}
          <div className="flex-1 overflow-y-auto">
            {/* Table header — click a column to sort (SmartGit-style) */}
            <div className="flex items-center gap-2 px-2 py-1 bg-bg-tertiary border-b border-border-default text-2xs font-semibold uppercase text-text-secondary sticky top-0 z-10">
              <span className="w-4"></span>
              <SortableHeader label="Name" sortKey="name" sort={fileSort} onSort={handleSort} />
              <span style={{ width: 74 }} title="Added/removed lines"></span>
              <SortableHeader label="State" sortKey="state" sort={fileSort} onSort={handleSort} width={colWidths.state} onResizeStart={(e) => startColResize(e, 'state')} />
              {!compressFilePaths && (
                <SortableHeader label="Relative Directory" sortKey="dir" sort={fileSort} onSort={handleSort} width={colWidths.dir} onResizeStart={(e) => startColResize(e, 'dir')} />
              )}
              <span style={{ width: 92 }}></span>
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
                    <span className="flex-1 truncate font-mono whitespace-nowrap">{filePath}</span>
                    <span style={{ width: 74 }}></span>
                    <span className="text-text-tertiary italic truncate whitespace-nowrap" style={{ width: colWidths.state }}>Conflict</span>
                    {!compressFilePaths && (
                      <span className="truncate whitespace-nowrap" style={{ width: colWidths.dir }}></span>
                    )}
                    <span className="flex justify-end flex-shrink-0 overflow-hidden" style={{ width: 92 }}>
                      <button className="btn btn-primary text-2xs !py-0.5 !px-2" onClick={(e) => { e.stopPropagation(); onResolveConflict && onResolveConflict(filePath); }}>
                        Resolve
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Staged — all files rendered, but lazy-loaded via IntersectionObserver */}
            {stagedFiles.length > 0 && (
              <div className="px-2 py-0.5 bg-bg-tertiary text-2xs font-semibold uppercase text-text-secondary border-b border-border-subtle">
                Staged ({stagedFiles.length})
              </div>
            )}
            <LazyFileList files={stagedFiles} isStaged={true} renderRow={renderFileRow} />

            {/* Unstaged */}
            {unstagedFiles.length > 0 && (
              <div className="px-2 py-0.5 bg-bg-tertiary text-2xs font-semibold uppercase text-text-secondary border-b border-border-subtle">
                Changes ({unstagedFiles.length})
              </div>
            )}
            <LazyFileList files={unstagedFiles} isStaged={false} renderRow={renderFileRow} />

            {/* Untracked */}
            {untrackedFiles.length > 0 && (
              <div className="px-2 py-0.5 bg-bg-tertiary text-2xs font-semibold uppercase text-text-secondary border-b border-border-subtle">
                Untracked ({untrackedFiles.length})
              </div>
            )}
            <LazyFileList files={untrackedFiles} isStaged={false} renderRow={renderFileRow} />

            {totalChanged === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
                <GitCommit size={28} className="mb-2 opacity-50" />
                <div className="text-sm">Working tree clean</div>
                <div className="text-xs mt-1">No changes to commit</div>
              </div>
            )}
          </div>

          {/* Journal panel (bottom) — shows recent commits like SmartGit */}
          <div className="flex-shrink-0" style={{ height: journalHeight }}>
            <ResizableSplitter direction="vertical" onResize={(d) => handleJournalResize(-d)} />
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
                        className="flex-shrink-0 rounded author-badge text-center"
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

          {/* Commit editor — resizable with markdown preview */}
          <div className="bg-bg-secondary flex-shrink-0 flex flex-col" style={{ height: commitHeight }}>
            <ResizableSplitter direction="vertical" onResize={(d) => handleCommitResize(-d)} />
            <div className="flex items-center gap-2 px-2 py-1">
              <label className="flex items-center gap-1 text-2xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(e) => setAmend(e.target.checked)}
                />
                Amend
              </label>
              <button
                className={cn('text-2xs px-1.5 py-0.5 rounded', showMarkdownPreview ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
                onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                title="Toggle markdown preview"
              >
                MD
              </button>
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
            <div className="flex-1 flex overflow-hidden">
              <textarea
                className="flex-1 text-sm font-mono resize-none p-2 bg-bg-primary border-r border-border-subtle"
                placeholder="Commit message... (supports markdown)"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleCommit();
                  }
                }}
                style={{ minHeight: 0 }}
              />
              {showMarkdownPreview && (
                <div className="flex-1 overflow-y-auto p-2 text-xs">
                  <CommitMarkdownPreview content={commitMsg} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Diff viewer */}
        {showSplitView && (
          <>
            <ResizableSplitter direction="horizontal" onResize={handleLeftResize} />
            <div className="flex-1 flex flex-col overflow-hidden">
              <DiffViewer
                diff={diff}
                loading={diffLoading}
                repoPath={repo.path}
                filePath={selectedFile || undefined}
                mode={selectedFile && (status?.staged.some((s) => s.path === selectedFile)) ? 'staged' : 'unstaged'}
                onStaged={() => {
                  // Reset the skip-guard so the diff-reload effect re-runs when the
                  // refreshed status arrives (partial staging changes index, not worktree,
                  // so the fs watcher will NOT fire by itself).
                  lastLoadedFileRef.current = null;
                  refreshStatus(repo.path);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Clean untracked: dry-run preview → confirm → git clean -fd */}
      {showCleanDialog && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowCleanDialog(false)}
        >
          <div className="panel w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium px-4 pt-4">Clean Untracked Files</h3>
            <div className="px-4 py-2 text-xs text-text-tertiary">
              The following untracked files and directories will be permanently removed
              (git clean -fd). This cannot be undone.
            </div>
            <div className="flex-1 overflow-y-auto mx-4 border border-border-default rounded bg-bg-tertiary">
              {cleanPreview.length === 0 ? (
                <div className="p-4 text-xs text-text-tertiary text-center">
                  Nothing to clean — no untracked files or directories.
                </div>
              ) : (
                cleanPreview.map((p) => (
                  <div key={p} className="px-3 py-1 text-xs font-mono border-b border-border-subtle last:border-b-0">
                    {p}
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
              <button className="btn btn-secondary" onClick={() => setShowCleanDialog(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary hover:!bg-status-deleted"
                onClick={handleCleanExecute}
                disabled={cleanBusy || cleanPreview.length === 0}
              >
                <Trash size={13} />
                Clean {cleanPreview.length > 0 ? `${cleanPreview.length} paths` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
