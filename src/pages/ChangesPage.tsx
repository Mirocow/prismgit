import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { AppSettings } from '../../electron/types/settings-api';
import { CommitMarkdownPreview } from '../components/CommitMarkdownPreview';
import { DiffViewer } from '../components/DiffViewer';
import { DirTreePanel, ROOT_KEY } from '../components/DirTreePanel';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, EyeOff, Folder, FolderOpen, GitCommit, GitPullRequest, Minus, Plus, RefreshCw, RotateCcw, Sparkles, SplitSquareHorizontal, Trash, X } from '../components/icons';
import { LazyFileList } from '../components/LazyFileList';
import { RepoStateBanner } from '../components/RepoStateBanner';
import { ResizableSplitter, useResizableHeight, useResizableWidth } from '../components/ResizableSplitter';
import { CommitHashLink } from '../components/StatusBar';
import { applyAIPlaceholder, detectAIPlaceholder, generateCommitMessage, type LLMProvider } from '../lib/aiCommitMessages';
import { api, type DiffResult, type DirNode, type FileStatus, type LogEntry } from '../lib/api';
import { formatTime, getAuthorColor, getInitials } from '../lib/authorBadges';
import { buildFileMenu, getIndexFlagsAsync, runFileAction, type IndexFlags } from '../lib/fileContextMenu';
import { useI18n } from '../lib/i18n';
import { loadProjectPrefs, saveProjectPrefs } from '../lib/projectPrefs';
import { describePushResult } from '../lib/pushResult';
import { RefBadges } from '../lib/refBadge';
import { isCommitBlocked } from '../lib/repoState';
import { useContextMenu } from '../lib/useContextMenu';
import { cn, getStatusColor } from '../lib/utils';
import { useGitStore } from '../stores/gitStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore } from '../stores/toastStore';

import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useEscapeKey } from '../hooks/useEscapeKey';

/** Build an LLMProvider from settings, or null if not configured. */
function buildAIProvider(settings: Partial<AppSettings> | undefined): LLMProvider | null {
  if (!settings?.aiProvider) return null;
  const type = settings.aiProvider as LLMProvider['type'];
  const id = settings.aiProvider;
  const url = settings.aiUrl || '';
  const model = settings.aiModel || '';
  if (!model) return null;
  return {
    id,
    name: id,
    type,
    url,
    apiKey: settings.aiApiKey,
    model,
  };
}

interface ChangesPageProps {
  onResolveConflict?: (file: string) => void;
  /** Inline per-file conflict resolution — Take ours / Take theirs / Take both / Mark resolved.
   *  Wired to the App.tsx resolveConflict handler so these run the same git commands
   *  as the menu-driven actions (git checkout --ours/--theirs + git add). */
  onResolveConflictAction?: (file: string, mode: 'ours' | 'theirs' | 'both' | 'resolved') => void;
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
  const { t } = useI18n();
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
      title={t('changes.sortBy', { what: label.toLowerCase() })}
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
          title={t('changes.dragResizeColumn')}
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

export function ChangesPage({ onResolveConflict, onResolveConflictAction }: ChangesPageProps = {}) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { status, lastRefresh, refreshStatus, stageFiles, stageAll, commit, push, pull } = useGitStore();
  const settings = useSettingsStore((s) => s.settings);
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
  const groupByState = useSelectionStore((s) => s.groupByState);
  const setGroupByState = useSelectionStore((s) => s.setGroupByState);
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
  // Cross-tool selection: every file the user clicks here becomes the global
  // selectedFilePath, so History/Blame/Diff and the global menu actions
  // (Stage/Unstage/Discard/Ignore/Index Editor) all operate on the SAME file.
  const selectFileGlobal = useSelectionStore((s) => s.selectFile);
  // Reverse sync: when ANOTHER tool selects a file globally (Annotate, LFS,
  // Investigate, Diff, History, deep link), Changes highlights it and loads
  // its diff. Equal values (own write-through) are ignored — no loop.
  const globalSelectedFilePath = useSelectionStore((s) => s.selectedFilePath);
  const selectedFileRef = useRef(selectedFile);
  selectedFileRef.current = selectedFile;
  useEffect(() => {
    if (!globalSelectedFilePath) return;
    if (globalSelectedFilePath === selectedFileRef.current) return;
    setSelectedFile(globalSelectedFilePath);
    setSelectedFiles(new Set([globalSelectedFilePath]));
  }, [globalSelectedFilePath]);

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
      selectFileGlobal(filePath);
    } else if (e.shiftKey) {
      // Range select — simplified: just add to set
      setSelectedFiles(prev => {
        const next = new Set(prev);
        next.add(filePath);
        return next;
      });
      setSelectedFile(filePath);
      selectFileGlobal(filePath);
    } else {
      // Single click — clear multi-select, select only this file
      setSelectedFiles(new Set([filePath]));
      setSelectedFile(filePath);
      selectFileGlobal(filePath);
    }
  };
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [amend, setAmend] = useState(false);
  // When true, commit auto-stages all changes before committing (git add . && git commit)
  const [commitAll, setCommitAll] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [draggedFile, setDraggedFile] = useState<string | null>(null);
  const [journal, setJournal] = useState<LogEntry[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  // Journal panel collapsed state — when true, only the header bar is shown
  const [journalCollapsed, setJournalCollapsed] = useState(false);
  const [showSplitView, setShowSplitView] = useState(false);
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
        toast.error(t('changes.loadDiffFailed'), String(e));
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
      toast.success(t('changes.allChangesStaged'));
    } catch (e) {
      toast.error(t('changes.stageFailed'), String(e));
    }
  };

  const handleStageFile = async (file: string) => {
    try {
      await stageFiles(repo.path, [file]);
    } catch (e) {
      toast.error(t('changes.stageFileFailed'), String(e));
    }
  };

  const handleUnstageFile = async (file: string) => {
    try {
      // resetFile = git reset <HEAD> -- <file> (unstages exactly this path)
      await api.git.resetFile(repo.path, file);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('changes.unstageFailed'), String(e));
    }
  };

  const handleRestoreFile = async (file: string) => {
    if (!(await confirmDialog({
      title: t('changes.restoreFileTitle'),
      message: t('changes.restoreFileConfirm', { file }),
      confirmLabel: t('changes.restore'),
      danger: true,
    }))) return;
    try {
      await api.git.restore(repo.path, [file]);
      toast.success(t('changes.fileRestored'));
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('changes.restoreFailed'), String(e));
    }
  };

  const handleIgnoreFile = async (file: string) => {
    try {
      await api.git.ignore(repo.path, [file]);
      toast.success(t('changes.addedToGitignore'));
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('changes.ignoreFailed'), String(e));
    }
  };

  // Restore a file from an arbitrary ref (git checkout <ref> -- <file>) — e.g. recover
  // an older version from another branch or commit without leaving the current branch.
  // (The context-menu variant of this flow lives in fileContextMenu.ts.)

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
      toast.error(t('changes.cleanPreviewFailed'), String(e));
    } finally {
      setCleanBusy(false);
    }
  };

  const handleCleanExecute = async () => {
    setCleanBusy(true);
    try {
      const removed = await api.git.clean(repo.path, [], false, true, true);
      toast.success(removed.length === 1 ? t('changes.removedOnePath') : t('changes.removedNPaths', { count: removed.length }));
      setShowCleanDialog(false);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('changes.cleanFailed'), String(e));
    } finally {
      setCleanBusy(false);
    }
  };

  const handleDeleteFile = async (file: string) => {
    if (!(await confirmDialog({
      title: t('changes.deleteFileTitle'),
      message: t('changes.deleteFileConfirm', { file }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      // deleteFile handles BOTH tracked (git rm -f) and untracked (fs delete)
      // files — the old `git rm`-only version silently failed for untracked.
      await api.git.deleteFile(repo.path, file);
      toast.success(t('changes.fileDeleted'));
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('changes.deleteFailed'), String(e));
    }
  };

  const handleRevealFile = async (file: string) => {
    try {
      const fullPath = `${repo.path}/${file}`.replace(/\/+/g, '/');
      await api.git.revealInFileManager(fullPath);
    } catch (e) {
      toast.error(t('changes.revealFailed'), String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast.warning(t('changes.commitMessageRequired'));
      return;
    }
    // SmartGit: while the working tree is in a sequencer state (cherry-pick /
    // revert / rebase / bisect) only the state-resolving actions are allowed —
    // a plain commit would consume the operation. MERGE is the exception: a
    // plain commit is THE way to complete a (conflicted) merge.
    if (isCommitBlocked(status)) {
      toast.warning(
        status?.isCherryPicking ? 'Cherry-pick in progress'
          : status?.isReverting ? 'Revert in progress'
          : status?.isRebasing ? 'Rebase in progress'
          : 'Bisect in progress',
        'Finish it first: use the buttons in the banner above'
      );
      return;
    }
    try {
      // SmartGit Manual: AI Commit Messages — @ai placeholder → replace with AI-generated
      let finalMsg = commitMsg.trim();
      const placeholder = detectAIPlaceholder(finalMsg);
      if (placeholder && settings?.aiCommitMessagesEnabled) {
        const provider = buildAIProvider(settings);
        if (provider) {
          try {
            setAiGenerating(true);
            const diffText = await buildDiffForAI();
            const aiMessage = await generateCommitMessage({
              diff: diffText,
              provider,
              recentMessages: journal.slice(0, 5).map(j => j.subject),
            });
            finalMsg = applyAIPlaceholder(finalMsg, aiMessage, placeholder);
            setCommitMsg(finalMsg);
            toast.success(t('changes.aiMessageGenerated'), t('changes.reviewAndCommit'));
          } catch (e) {
            toast.warning(t('changes.aiGenFailedPlaceholder'), String(e));
            return;
          } finally {
            setAiGenerating(false);
          }
        }
      }
      // If commitAll is checked, stage everything first (git add .)
      if (commitAll) {
        await stageAll(repo.path);
      }
      const hash = await commit(repo.path, finalMsg, amend);
      toast.success(t('status.commitCreated'), t('changes.hashDetail', { hash: hash.substring(0, 7) }));
      // Save commit message to per-project history for reuse
      const prefs = loadProjectPrefs(repo.path);
      const history = prefs.commitMessageHistory || [];
      // Deduplicate: remove the same message if it already exists
      const filtered = history.filter(m => m !== finalMsg);
      // Add to front, cap at 50 entries
      const newHistory = [finalMsg, ...filtered].slice(0, 50);
      saveProjectPrefs(repo.path, { commitMessageHistory: newHistory });
      setCommitMsgHistory(newHistory);
      setCommitMsg('');
      setAmend(false);
      setCommitAll(false);
      await loadJournal();
    } catch (e) {
      toast.error(t('changes.commitFailed'), String(e));
    }
  };

  // AI Commit Messages helper — builds an LLMProvider from settings
  const [aiGenerating, setAiGenerating] = useState(false);
  // Commit message history dropdown
  const [showMsgHistory, setShowMsgHistory] = useState(false);
  const [commitMsgHistory, setCommitMsgHistory] = useState<string[]>([]);

  // Load commit message history when repo changes
  useEffect(() => {
    if (repo) {
      const prefs = loadProjectPrefs(repo.path);
      setCommitMsgHistory(prefs.commitMessageHistory || []);
    }
  }, [repo?.path]);

  const handleAIGenerate = async () => {
    if (!settings?.aiCommitMessagesEnabled) {
      toast.warning(t('changes.aiDisabled'), t('changes.aiEnableHint'));
      return;
    }
    const provider = buildAIProvider(settings);
    if (!provider) {
      toast.warning(t('changes.aiNoProvider'), t('changes.aiSetProviderHint'));
      return;
    }
    setAiGenerating(true);
    try {
      const diffText = await buildDiffForAI();
      if (!diffText.trim()) {
        toast.info(t('changes.aiNoChanges'));
        return;
      }
      const aiMessage = await generateCommitMessage({
        diff: diffText,
        provider,
        recentMessages: journal.slice(0, 5).map(j => j.subject),
      });
      setCommitMsg(aiMessage);
      toast.success(t('changes.aiMessageGenerated'), t('changes.reviewBeforeCommitting'));
    } catch (e) {
      toast.error(t('changes.aiGenerationFailed'), String(e));
    } finally {
      setAiGenerating(false);
    }
  };

  // Build a diff string for AI by combining staged + unstaged changes (truncated)
  const buildDiffForAI = async (): Promise<string> => {
    if (!status) return '';
    const files = [...status.staged.map(s => s.path), ...status.modified, ...status.not_added];
    const uniqueFiles = Array.from(new Set(files)).slice(0, 10); // Cap at 10 files
    const diffs: string[] = [];
    for (const f of uniqueFiles) {
      try {
        const result = await api.git.diff(repo.path, f);
        // Truncate each file diff to ~4KB to avoid token overflow
        const truncated = result.hunks.length === 0 ? '' : result.hunks.map(h => h.header + '\n' + h.lines.map(l => l.content).join('\n')).join('\n');
        diffs.push(`--- ${f} ---\n${truncated.slice(0, 4000)}`);
      } catch { /* skip */ }
    }
    return diffs.join('\n\n');
  };

  // SmartGit "Local | Stash Selection..." — the app menu dispatches this event
  // after navigating to Changes; stash exactly the files selected in the table.
  useEffect(() => {
    const handler = async () => {
      if (selectedFiles.size === 0) {
        toast.warning(t('changes.noFilesSelected'), t('changes.stashSelectionHint'));
        return;
      }
      const msg = await promptDialog({
        title: t('changes.stashSelectionTitle'),
        message: t('changes.stashSelectionMessage', { count: selectedFiles.size }),
        input: { initialValue: 'Selected files' },
      });
      if (!msg) return;
      try {
        await api.git.stashPush(repo.path, msg, true, false, Array.from(selectedFiles));
        toast.success(t('changes.stashedSelection', { count: selectedFiles.size }));
        setSelectedFiles(new Set());
        refreshStatus(repo.path);
      } catch (e) {
        toast.error(t('changes.stashFailed'), String(e));
      }
    };
    window.addEventListener('smartgit:stash-selection', handler);
    return () => window.removeEventListener('smartgit:stash-selection', handler);
  }, [selectedFiles, repo.path, refreshStatus, toast]);

  const handleCommitAndPush = async () => {
    await handleCommit();
    try {
      const res = await push(repo.path);
      const t = describePushResult(res);
      if (t.kind === 'error') toast.error(t.title, t.detail);
      else if (t.kind === 'info') toast.info(t.title, t.detail);
      else toast.success(t.title, t.detail);
    } catch (e) {
      toast.error(t('changes.pushFailed'), String(e));
    }
  };

  // ===== Cherry-pick state (SmartGit: "The working tree is in cherry-picking-state.") =====
  // While CHERRY_PICK_HEAD exists only Abort / Continue / Skip / Commit Empty
  // are allowed — every other HEAD-moving operation would discard the pick.
  const [cpBusy, setCpBusy] = useState(false);
  const runCherryPickOp = async (title: string, cmd: string, fn: () => Promise<void>, okMsg: string) => {
    setCpBusy(true);
    try {
      await useOperationLogStore.getState().logOperation(title, repo.path, cmd, fn);
      toast.success(okMsg);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(`${title} failed`, String(e));
    } finally {
      setCpBusy(false);
    }
  };
  const handleCpContinue = () => {
    if (!status?.isCherryPicking) return;
    void (async () => {
      setCpBusy(true);
      try {
        const res = await useOperationLogStore.getState().logOperation(
          'Cherry-pick Continue', repo.path, 'git cherry-pick --continue',
          () => api.git.cherryPickContinue(repo.path)
        );
        if (res?.empty) {
          toast.warning('The previous cherry-pick is now empty', 'Use Skip (drop it) or Commit Empty (commit it anyway)');
        } else {
          toast.success('Cherry-pick finished — commit created');
        }
        await refreshStatus(repo.path);
      } catch (e) {
        toast.error('Cherry-pick Continue failed', String(e));
      } finally {
        setCpBusy(false);
      }
    })();
  };
  const handleCpCommitEmpty = () => {
    if (!status?.isCherryPicking) return;
    void runCherryPickOp(
      'Cherry-pick Commit Empty', 'git commit --allow-empty',
      () => api.git.cherryPickContinue(repo.path, true).then(() => undefined),
      'Empty commit created — cherry-pick finished'
    );
  };
  const handleCpSkip = () => {
    if (!status?.isCherryPicking) return;
    void runCherryPickOp(
      'Cherry-pick Skip', 'git cherry-pick --skip',
      () => api.git.cherryPickSkip(repo.path),
      'Cherry-pick skipped'
    );
  };
  const handleCpAbort = async () => {
    if (!status?.isCherryPicking) return;
    if (!(await confirmDialog({
      title: 'Abort cherry-pick',
      message: 'Cancel the cherry-pick and restore the branch to its previous state?\n\nPicked changes will be discarded.',
      confirmLabel: 'Abort',
      danger: true,
    }))) return;
    void runCherryPickOp(
      'Cherry-pick Abort', 'git cherry-pick --abort',
      () => api.git.cherryPickAbort(repo.path),
      'Cherry-pick aborted'
    );
  };

  // ===== Revert state (SmartGit: "The working tree is in reverting-state.") =====
  const handleRvContinue = () => {
    if (!status?.isReverting) return;
    void runCherryPickOp(
      'Revert Continue', 'git revert --continue',
      () => api.git.revertContinue(repo.path),
      'Revert finished — commit created'
    );
  };
  const handleRvSkip = () => {
    if (!status?.isReverting) return;
    void runCherryPickOp(
      'Revert Skip', 'git revert --skip',
      () => api.git.revertSkip(repo.path),
      'Revert step skipped'
    );
  };
  const handleRvAbort = async () => {
    if (!status?.isReverting) return;
    if (!(await confirmDialog({
      title: 'Abort revert',
      message: 'Cancel the revert and restore the branch to its previous state?\n\nRevert changes will be discarded.',
      confirmLabel: 'Abort',
      danger: true,
    }))) return;
    void runCherryPickOp(
      'Revert Abort', 'git revert --abort',
      () => api.git.revertAbort(repo.path),
      'Revert aborted'
    );
  };

  // ===== Merge state (SmartGit: "The working tree is in merging-state.") =====
  // A plain COMMIT completes the merge (allowed); Abort Merge cancels it.
  const handleMergeAbort = async () => {
    if (!status?.isMerging) return;
    if (!(await confirmDialog({
      title: 'Abort merge',
      message: 'Cancel the merge and restore the branch to its pre-merge state?\n\nMerged changes will be discarded.',
      confirmLabel: 'Abort Merge',
      danger: true,
    }))) return;
    void runCherryPickOp(
      'Merge Abort', 'git merge --abort',
      () => api.git.abortMerge(repo.path),
      'Merge aborted'
    );
  };

  // ===== Rebase state (SmartGit: "The working tree is in rebasing-state.") =====
  const handleRbContinue = () => {
    if (!status?.isRebasing) return;
    void runCherryPickOp(
      'Rebase Continue', 'git rebase --continue',
      () => api.git.rebase(repo.path, '', { continue: true }),
      'Rebase continued'
    );
  };
  const handleRbSkip = () => {
    if (!status?.isRebasing) return;
    void runCherryPickOp(
      'Rebase Skip', 'git rebase --skip',
      () => api.git.rebase(repo.path, '', { skip: true }),
      'Rebase step skipped'
    );
  };
  const handleRbAbort = async () => {
    if (!status?.isRebasing) return;
    if (!(await confirmDialog({
      title: 'Abort rebase',
      message: 'Cancel the rebase and restore the branch to its original state?\n\nRebased commits will be discarded.',
      confirmLabel: 'Abort',
      danger: true,
    }))) return;
    void runCherryPickOp(
      'Rebase Abort', 'git rebase --abort',
      () => api.git.rebase(repo.path, '', { abort: true }),
      'Rebase aborted'
    );
  };

  // ===== Bisect state (SmartGit: "The working tree is in bisecting-state.") =====
  const handleBsGood = () => {
    if (!status?.isBisecting) return;
    void runCherryPickOp(
      'Bisect Good', 'git bisect good',
      () => api.git.bisectGood(repo.path),
      'Marked good — bisect continues'
    );
  };
  const handleBsBad = () => {
    if (!status?.isBisecting) return;
    void runCherryPickOp(
      'Bisect Bad', 'git bisect bad',
      () => api.git.bisectBad(repo.path),
      'Marked bad — bisect continues'
    );
  };
  const handleBsSkip = () => {
    if (!status?.isBisecting) return;
    void runCherryPickOp(
      'Bisect Skip', 'git bisect skip',
      () => api.git.bisectSkip(repo.path),
      'Revision skipped — bisect continues'
    );
  };
  const handleBsReset = async () => {
    if (!status?.isBisecting) return;
    if (!(await confirmDialog({
      title: 'Reset bisect',
      message: 'End the bisect session and return to the original branch?',
      confirmLabel: 'Reset',
    }))) return;
    void runCherryPickOp(
      'Bisect Reset', 'git bisect reset',
      () => api.git.bisectReset(repo.path),
      'Bisect finished — back on the original branch'
    );
  };

  // ===== Stash All + Abort (SmartGit escape hatch) =====
  // When conflicts are overwhelming, stash everything (incl. untracked)
  // then abort the in-progress operation. The stash is recoverable via
  // the Stashes page. This is the "start fresh" option SmartGit offers.
  const handleStashAll = async () => {
    if (!(await confirmDialog({
      title: 'Stash all and abort?',
      message: 'This will stash ALL local changes (including untracked files) and abort the current operation.\n\nThe stash is saved with a descriptive message and is recoverable via the Stashes page.',
      confirmLabel: 'Stash All & Abort',
      danger: true,
    }))) return;
    try {
      const stateLabel = status?.isMerging ? 'merge' : status?.isRebasing ? 'rebase' : status?.isCherryPicking ? 'cherry-pick' : status?.isReverting ? 'revert' : 'operation';
      await api.git.stashPush(repo.path, `auto-stash before abort (${stateLabel})`, true, false);
      toast.success('All changes stashed', 'Now aborting the operation…');
      // Abort the in-progress operation based on the active state
      if (status?.isMerging) await api.git.abortMerge(repo.path);
      else if (status?.isRebasing) await api.git.rebase(repo.path, '', { abort: true });
      else if (status?.isCherryPicking) await api.git.cherryPickAbort(repo.path);
      else if (status?.isReverting) await api.git.revertAbort(repo.path);
      else if (status?.isBisecting) await api.git.bisectReset(repo.path);
      toast.success('Operation aborted', 'Stash is available on the Stashes page.');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Stash & abort failed', String(e));
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

  // Memoize file lists to avoid re-sorting on every render (e.g. when
  // hovering over rows causes a re-render but status hasn't changed).
  const stagedFiles: FileStatus[] = useMemo(() => sortFiles((status?.files || []).filter((f) => {
    // Exclude conflicted files (UU/AU/UA/DD etc.) — they show in the
    // Conflicts section, NOT in Staged. A conflicted file has index='U'
    // or working_dir='U' in git porcelain status.
    const idx = f.index as string;
    const wd = f.working_dir as string;
    if (idx === 'U' || wd === 'U') return false;
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) return false;
    const stagedIdx = staged.index as string;
    return stagedIdx !== ' ' && stagedIdx !== '?' && stagedIdx !== '!' && stagedIdx !== 'U';
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
    })), [status, sortFiles, fileStatusFilter, fileStatusFilterSet]);

  const unstagedFiles: FileStatus[] = useMemo(() => sortFiles((status?.files || []).filter((f) => {
    // Exclude conflicted files — they show in the Conflicts section only.
    const idx = f.index as string;
    const wd = f.working_dir as string;
    if (idx === 'U' || wd === 'U') return false;
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) {
      // Exclude untracked ('??') — they render in their own Untracked section;
      // including them here duplicated every untracked file in both sections.
      return wd !== ' ' && wd !== '!' && !((f.index as string) === '?' && wd === '?');
    }
    const stagedWd = staged.working_dir as string;
    return stagedWd !== ' ' && stagedWd !== '!' && stagedWd !== 'U';
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
    })), [status, sortFiles, fileStatusFilter, fileStatusFilterSet]);

  // Conflicted files — shown in their OWN section (red accent) ABOVE staged.
  // These are files with index='U' or working_dir='U' in git porcelain.
  const conflictedFiles: FileStatus[] = useMemo(() => sortFiles((status?.files || []).filter((f) => {
    const idx = f.index as string;
    const wd = f.working_dir as string;
    return idx === 'U' || wd === 'U';
  }).filter((f) => matchesFileFilter(f.path))
    .filter(f => !fileExtensionFilter || f.path.toLowerCase().endsWith(fileExtensionFilter.toLowerCase()))
    .filter((f) => matchesDirScope(f.path))), [status, sortFiles]);

  const untrackedFiles: FileStatus[] = useMemo(() => sortFiles((status?.files || []).filter((f) => {
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
    })), [status, sortFiles, fileFilter, fileStatusFilter, fileStatusFilterSet, fileScopeDir]);

  // Ctrl/Cmd+A: select all visible files in the file list
  // (placed after stagedFiles/unstagedFiles/untrackedFiles are declared)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allFiles = [...stagedFiles, ...unstagedFiles, ...untrackedFiles];
        setSelectedFiles(new Set(allFiles.map(f => f.path)));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stagedFiles, unstagedFiles, untrackedFiles]);

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
      code === 'U' ? 'conflicted' :
      code === 'M' ? 'modified' :
      code === 'A' ? 'added' :
      code === 'D' ? 'deleted' :
      code === 'R' ? 'renamed' :
      code === 'C' ? 'copied' :
      'modified';
    const isUntracked = idx === '?' && wd === '?';
    const isConflicted = code === 'U' || idx === 'U' || wd === 'U';
    const stateKeys: Record<string, string> = {
      untracked: 'changes.statusUntracked',
      conflicted: 'changes.conflicted',
      modified: 'changes.statusModified',
      added: 'changes.stateAdded',
      deleted: 'changes.statusDeleted',
      renamed: 'changes.statusRenamed',
      copied: 'changes.stateCopied',
    };
    const stateLabel = t(stateKeys[statusCode] ?? 'changes.statusModified');
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
          // SmartGit behavior: right-clicking a file that is ALREADY part of
          // the multi-selection keeps the selection (menu actions then apply
          // to every selected file); right-clicking OUTSIDE it re-selects
          // just the clicked file.
          const keepSelection = selectedFiles.has(file.path);
          if (!keepSelection) {
            setSelectedFiles(new Set([file.path]));
          }
          setSelectedFile(file.path);
          selectFileGlobal(file.path);
          // Bulk targets = the kept selection scoped to THIS list's section
          // (staged vs unstaged/untracked): staging a staged file or
          // unstaging an unstaged one from a mixed selection would be wrong.
          const sectionPaths = isStaged
            ? stagedFiles.map((f) => f.path)
            : [...unstagedFiles, ...untrackedFiles].map((f) => f.path);
          const sectionSet = new Set(sectionPaths);
          const multiPaths = keepSelection
            ? Array.from(selectedFiles).filter((p) => sectionSet.has(p))
            : [file.path];
          const focusCommitBox = () => {
            const box = document.getElementById('commit-message-input') as HTMLTextAreaElement | null;
            box?.focus();
            box?.scrollIntoView({ block: 'nearest' });
          };
          const makeCtx = (indexFlags?: IndexFlags) => ({
            repoPath: repo.path,
            path: file.path,
            paths: multiPaths.length > 1 ? multiPaths : undefined,
            mode: 'changes' as const,
            isStaged,
            isUntracked,
            isConflicted,
            indexFlags,
            onShowChanges: () => {
              setSelectedFile(file.path);
              selectFileGlobal(file.path);
            },
            onOpenDiff: () => {
              // Navigate to the Diff tool with this file pre-selected.
              // Compare working tree vs HEAD for this file.
              setSelectedFile(file.path);
              selectFileGlobal(file.path);
              window.location.hash = '#/diff';
            },
            onSelectDirectory: handleSelectDir,
            onFocusCommit: focusCommitBox,
            refresh: () => refreshStatus(repo.path),
          });
          // SmartGit-style unified menu: fetch live index flags first so the
          // 'Assume Unchanged' / 'Skip Worktree' checkboxes show real state.
          const flagsPromise: Promise<IndexFlags | undefined> =
            isUntracked || isDirEntry ? Promise.resolve(undefined) : getIndexFlagsAsync(repo.path, file.path);
          flagsPromise.then((indexFlags) => {
            showContextMenu(buildFileMenu(makeCtx(indexFlags)), async (action) => {
              await runFileAction(action, makeCtx(indexFlags));
            });
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
          title={t('changes.linesAddedRemoved')}
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
          {isStaged ? (
            <button className="icon-btn !w-5 !h-5" title={t('changes.unstage')} onClick={(e) => { e.stopPropagation(); handleUnstageFile(file.path); }}>
              <Minus size={11} />
            </button>
          ) : (
            <>
              <button className="icon-btn !w-5 !h-5" title={t('changes.stage')} onClick={(e) => { e.stopPropagation(); handleStageFile(file.path); }}>
                <Plus size={11} />
              </button>
              {!isUntracked && (
                <button className="icon-btn !w-5 !h-5" title={t('changes.restore')} onClick={(e) => { e.stopPropagation(); handleRestoreFile(file.path); }}>
                  <RotateCcw size={11} />
                </button>
              )}
              {isUntracked && (
                <>
                  <button className="icon-btn !w-5 !h-5" title={t('changes.ignore')} onClick={(e) => { e.stopPropagation(); handleIgnoreFile(file.path); }}>
                    <EyeOff size={11} />
                  </button>
                  <button className="icon-btn !w-5 !h-5 hover:!text-status-deleted" title={t('common.delete')} onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.path); }}>
                    <Trash size={11} />
                  </button>
                </>
              )}
              <button className="icon-btn !w-5 !h-5" title={t('changes.revealInFileManager')} onClick={(e) => { e.stopPropagation(); handleRevealFile(file.path); }}>
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
          <span className="text-xs font-medium">{t('changes.files')}</span>
          {totalChanged > 0 && (
            <span className="text-2xs text-text-tertiary">
              {t('changes.stagedUnstagedCounts', { staged: stagedFiles.length, unstaged: unstagedFiles.length + untrackedFiles.length })}
            </span>
          )}
          {hiddenCount > 0 && (
            <button
              className="clickable-text text-2xs"
              title={t('changes.hiddenFilesTitle')}
              onClick={() => {
                // Toggle showing all tracked files (even unchanged).
                // We piggyback on the file status filter — when ALL is set,
                // the file list includes unchanged tracked files too.
                const store = useSelectionStore.getState();
                store.setFileStatusFilter(store.fileStatusFilter === 'all' ? 'modified' : 'all');
              }}
            >
              {t('changes.filesHidden', { count: hiddenCount.toLocaleString() })}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            className="text-xs w-32 px-2 py-0.5"
            placeholder={t('changes.fileFilter')}
            value={fileFilter}
            onChange={(e) => setFileFilter(e.target.value)}
          />
          <button
            className={cn('text-2xs px-1.5 py-0.5 border rounded font-mono',
              fileFilterRegex
                ? 'border-accent bg-accent-muted text-accent'
                : 'border-border-default bg-bg-tertiary text-text-secondary hover:text-text-primary')}
            onClick={toggleFileFilterRegex}
            title={t('changes.fileFilterRegexTitle')}
          >
            .*
          </button>
          {/* Multi-select status filter — SmartGit-style icon toolbar buttons + dropdown */}
          <div className="flex items-center gap-0.5">
            {/* Quick toggle buttons — SmartGit uses small icon buttons above the table */}
            {([
              { id: 'modified', label: 'M', title: t('changes.showModifiedFiles'), color: 'text-status-modified' },
              { id: 'added', label: 'A', title: t('changes.showAddedFiles'), color: 'text-status-added' },
              { id: 'deleted', label: 'D', title: t('changes.showDeletedFiles'), color: 'text-status-deleted' },
              { id: 'untracked', label: 'U', title: t('changes.showUntrackedFiles'), color: 'text-status-untracked' },
              { id: 'staged', label: 'S', title: t('changes.showStagedFiles'), color: 'text-status-added' },
              { id: 'unstaged', label: 'U2', title: t('changes.showUnstagedFiles'), color: 'text-status-modified' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                className={cn(
                  'text-2xs w-5 h-5 rounded flex items-center justify-center font-mono font-bold transition-colors',
                  fileStatusFilterSet.has(opt.id)
                    ? 'bg-accent-muted text-accent'
                    : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                )}
                title={opt.title}
                onClick={() => toggleFileStatusFilter(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* Dropdown for more options */}
          <div className="relative">
            <button
              className={cn('text-2xs px-2 py-0.5 border rounded flex items-center gap-1',
                fileStatusFilterSet.size > 0
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-border-default bg-bg-tertiary text-text-secondary')}
              onClick={() => setShowStatusPicker(!showStatusPicker)}
              title={t('changes.filterByStatusTitle')}
            >
              <span>{t('changes.statusLabel')}</span>
              <span>{fileStatusFilterSet.size > 0 ? t('changes.nFilters', { count: fileStatusFilterSet.size }) : t('common.all')}</span>
              <ChevronDown size={9} />
            </button>
            {showStatusPicker && (
              <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 min-w-56">
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer text-xs border-b border-border-subtle">
                  <input type="checkbox"
                    checked={fileStatusFilterSet.size === 4 && fileStatusFilterSet.has('modified') && fileStatusFilterSet.has('added') && fileStatusFilterSet.has('deleted') && fileStatusFilterSet.has('staged')}
                    onChange={() => clearFileStatusFilterSet()}
                  />
                  <span className="font-medium">{t('changes.defaultMads')}</span>
                </label>
                {([
                  { id: 'staged', label: t('changes.statusStaged') },
                  { id: 'unstaged', label: t('changes.statusUnstaged') },
                  { id: 'modified', label: t('changes.statusModified') },
                  { id: 'added', label: t('changes.statusAddedNew') },
                  { id: 'deleted', label: t('changes.statusDeleted') },
                  { id: 'renamed', label: t('changes.statusRenamed') },
                  { id: 'untracked', label: t('changes.statusUntracked') },
                ] as const).map(opt => (
                  <label key={opt.id} className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs">
                    <input type="checkbox" checked={fileStatusFilterSet.has(opt.id)}
                      onChange={() => toggleFileStatusFilter(opt.id)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
                <div className="px-3 py-1 border-t border-border-subtle flex justify-between">
                  <button className="text-2xs text-accent" onClick={() => clearFileStatusFilterSet()}>{t('common.clear')}</button>
                  <button className="text-2xs btn btn-primary !py-0.5 !px-2" onClick={() => setShowStatusPicker(false)}>{t('changes.done')}</button>
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
            title={t('changes.filterByExtensionTitle')}
          />
          {/* Directory tree panel toggle (folder scope lives in the tree) */}
          <button
            className={cn('icon-btn !w-5 !h-5', dirTreeVisible && 'active')}
            title={t('changes.toggleDirTree')}
            onClick={toggleDirTreeVisible}
          >
            {dirTreeVisible ? <FolderOpen size={11} /> : <Folder size={11} />}
          </button>
          {/* Path compression toggle — EyeOff = hide relative dir column */}
          <button
            className={cn('icon-btn !w-5 !h-5', !compressFilePaths && 'active')}
            title={compressFilePaths ? t('changes.showRelDirColumn') : t('changes.hideRelDirColumn')}
            onClick={() => setCompressFilePaths(!compressFilePaths)}
          >
            <EyeOff size={11} />
          </button>
          {/* Diff panel toggle — show/hide the right-side diff viewer */}
          <button
            className={cn('icon-btn !w-5 !h-5', showSplitView && 'active')}
            title={showSplitView ? t('changes.hideDiffPanel') : t('changes.showDiffPanel')}
            onClick={() => setShowSplitView(!showSplitView)}
          >
            <SplitSquareHorizontal size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title={t('common.refresh')} onClick={handleRefresh}>
            <RefreshCw size={11} />
          </button>
          <button
            className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
            title={t('changes.cleanTooltip')}
            onClick={handleCleanPreview}
          >
            <Trash size={11} />
          </button>
          {selectedFiles.size > 1 && (
            <>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-added" title={t('changes.stageNSelected', { count: selectedFiles.size })}
                onClick={async () => {
                  try {
                    await stageFiles(repo.path, Array.from(selectedFiles));
                    toast.success(t('changes.stagedNFiles', { count: selectedFiles.size }));
                    setSelectedFiles(new Set());
                  } catch (e) { toast.error(t('changes.bulkStageFailed'), String(e)); }
                }}>
                <Plus size={11} />
              </button>
              <button className="icon-btn !w-5 !h-5 hover:!text-status-modified" title={t('changes.stashNSelected', { count: selectedFiles.size })}
                onClick={async () => {
                  try {
                    await api.git.stashPush(repo.path, `Selected ${selectedFiles.size} files`, false, false, Array.from(selectedFiles));
                    toast.success(t('changes.stashedNFiles', { count: selectedFiles.size }));
                    setSelectedFiles(new Set());
                    refreshStatus(repo.path);
                  } catch (e) { toast.error(t('changes.stashFailed'), String(e)); }
                }}>
                <Download size={11} />
              </button>
            </>
          )}
          <button className="icon-btn !w-5 !h-5" title={t('changes.stageAll')} onClick={handleStageAll}>
            <Plus size={11} />
          </button>
        </div>
      </div>

      {/* SmartGit: "The working tree is in cherry-picking/merging/rebasing/reverting/bisecting-state." —
          only the state-resolving actions are allowed (Pull is blocked, Fetch stays available) */}
      {status && (status.isCherryPicking || status.isReverting || status.isMerging || status.isRebasing || status.isBisecting) && (
        <RepoStateBanner
          status={status}
          busy={cpBusy}
          handlers={{
            cherryPick: {
              onContinue: handleCpContinue,
              onSkip: handleCpSkip,
              onCommitEmpty: handleCpCommitEmpty,
              onAbort: handleCpAbort,
            },
            revert: { onContinue: handleRvContinue, onSkip: handleRvSkip, onAbort: handleRvAbort },
            merge: { onAbort: handleMergeAbort },
            rebase: { onContinue: handleRbContinue, onSkip: handleRbSkip, onAbort: handleRbAbort },
            bisect: { onGood: handleBsGood, onBad: handleBsBad, onSkip: handleBsSkip, onReset: handleBsReset },
            onStashAll: handleStashAll,
          }}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Directory tree panel (SmartGit-style) — selects the folder scope */}
        {dirTreeVisible && (
          <>
            <div className="flex flex-col overflow-hidden flex-shrink-0" style={{ width: treeWidth }}>
              <div className="flex items-center justify-between px-2 py-1 bg-bg-tertiary border-b border-border-default">
                <span className="text-2xs font-semibold uppercase text-text-secondary">{t('sidebar.repositories')}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    className="icon-btn !w-4 !h-4"
                    title={t('changes.expandAllFolders')}
                    onClick={expandAllDirs}
                  >
                    <ChevronsUpDown size={11} />
                  </button>
                  <button
                    className="icon-btn !w-4 !h-4"
                    title={t('changes.collapseAllFolders')}
                    onClick={collapseAllDirs}
                  >
                    <ChevronsDownUp size={11} />
                  </button>
                  {fileScopeDir && (
                    <button
                      className="icon-btn !w-4 !h-4"
                      title={t('changes.clearFolderScope')}
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
        <div className="flex flex-col overflow-hidden" style={{ width: showSplitView ? leftWidth : '100%', flexShrink: showSplitView ? 0 : 1 }}>
          {/* File list with table header */}
          {/* SmartGit background color highlighting: light red = committable files hidden,
              light yellow = name-filtered, gray = unchanged files shown by name match */}
          <div className={cn(
            'flex-1 overflow-y-auto transition-colors',
            // Light red: committable files (untracked/modified) are being hidden by state filter
            (fileStatusFilterSet.size > 0 && !fileStatusFilterSet.has('untracked') && !fileStatusFilterSet.has('modified')) ? 'bg-red-50 dark:bg-red-950/10' : '',
            // Light yellow: files are being name-filtered
            (fileFilter.trim().length > 0) ? 'bg-yellow-50 dark:bg-yellow-950/10' : '',
          )}>
            {/* Table header — click a column to sort (SmartGit-style) */}
            <div className="flex items-center gap-2 px-2 py-1 bg-bg-tertiary border-b border-border-default text-2xs font-semibold uppercase text-text-secondary sticky top-0 z-10">
              <span className="w-4"></span>
              <SortableHeader label={t('changes.colName')} sortKey="name" sort={fileSort} onSort={handleSort} />
              <span style={{ width: 74 }} title={t('changes.addedRemovedLines')}></span>
              <SortableHeader label={t('changes.colState')} sortKey="state" sort={fileSort} onSort={handleSort} width={colWidths.state} onResizeStart={(e) => startColResize(e, 'state')} />
              {!compressFilePaths && (
                <SortableHeader label={t('changes.colRelDir')} sortKey="dir" sort={fileSort} onSort={handleSort} width={colWidths.dir} onResizeStart={(e) => startColResize(e, 'dir')} />
              )}
              <span style={{ width: 92 }}></span>
            </div>

            {/* === Staged / Changes / Untracked in separate lists === */}
            {(
              <>
            {/* Conflicts — red accent, shown ABOVE staged when there are conflicted files */}
            {conflictedFiles.length > 0 && (
              <>
                <div
                  className="px-2 py-1 bg-status-conflict/8 text-2xs font-bold uppercase text-status-conflict border-b border-status-conflict/20 border-l-2 border-l-status-conflict/40 flex items-center justify-between"
                >
                  <span>{t('changes.conflictedCount', { count: conflictedFiles.length })}</span>
                  <span className="text-text-tertiary normal-case font-normal">{t('changes.resolveHint')}</span>
                </div>
                <div className="border-l-2 border-l-status-conflict/20">
                  <LazyFileList files={conflictedFiles} isStaged={false} renderRow={renderFileRow} />
                </div>
              </>
            )}
            {/* Staged — green accent left border, clickable header to stage all/unstage all */}
            {stagedFiles.length > 0 && (
              <div
                className="px-2 py-1 bg-status-added/8 text-2xs font-bold uppercase text-status-added border-b border-status-added/20 border-l-2 border-l-status-added/40 flex items-center justify-between cursor-pointer hover:bg-status-added/12 transition-colors"
                onClick={() => {
                  // Click on header = unstage all
                  if (repo) {
                    useOperationLogStore.getState().logOperation(
                      t('changes.unstageAll'), repo.path, 'git reset HEAD -- .',
                      () => api.git.raw(repo.path, ['reset', 'HEAD', '--', '.'])
                    ).then(() => refreshStatus(repo.path))
                     .catch((e: unknown) => toast.error(t('changes.bulkUnstageFailed'), String(e)));
                  }
                }}
                title={t('changes.clickToUnstageAll')}
              >
                <span>{t('changes.stagedCount', { count: stagedFiles.length })}</span>
                <span className="text-text-tertiary normal-case font-normal">{t('changes.clickToUnstageAllHint')}</span>
              </div>
            )}
            <div className={stagedFiles.length > 0 ? 'border-l-2 border-l-status-added/20' : ''}>
              <LazyFileList files={stagedFiles} isStaged={true} renderRow={renderFileRow} />
            </div>

            {/* Unstaged — orange accent */}
            {unstagedFiles.length > 0 && (
              <div
                className="px-2 py-1 bg-status-modified/8 text-2xs font-bold uppercase text-status-modified border-b border-status-modified/20 border-l-2 border-l-status-modified/40 flex items-center justify-between cursor-pointer hover:bg-status-modified/12 transition-colors"
                onClick={() => {
                  // Click on header = stage all unstaged
                  if (repo) {
                    useGitStore.getState().stageAll(repo.path);
                  }
                }}
                title={t('changes.clickToStageAll')}
              >
                <span>{t('changes.changesCount', { count: unstagedFiles.length })}</span>
                <span className="text-text-tertiary normal-case font-normal">{t('changes.clickToStageAllHint')}</span>
              </div>
            )}
            <div className={unstagedFiles.length > 0 ? 'border-l-2 border-l-status-modified/20' : ''}>
              <LazyFileList files={unstagedFiles} isStaged={false} renderRow={renderFileRow} />
            </div>

            {/* Untracked — cyan accent */}
            {untrackedFiles.length > 0 && (
              <div
                className="px-2 py-1 bg-status-untracked/8 text-2xs font-bold uppercase text-status-untracked border-b border-status-untracked/20 border-l-2 border-l-status-untracked/40 flex items-center justify-between cursor-pointer hover:bg-status-untracked/12 transition-colors"
                onClick={() => {
                  // Click on header = stage all untracked
                  if (repo) {
                    useGitStore.getState().stageAll(repo.path);
                  }
                }}
                title={t('changes.clickToStageAllUntracked')}
              >
                <span>{t('changes.untrackedCount', { count: untrackedFiles.length })}</span>
                <span className="text-text-tertiary normal-case font-normal">{t('changes.clickToStageAllHint')}</span>
              </div>
            )}
            <div className={untrackedFiles.length > 0 ? 'border-l-2 border-l-status-untracked/20' : ''}>
              <LazyFileList files={untrackedFiles} isStaged={false} renderRow={renderFileRow} />
            </div>
              </>
            )}

            {totalChanged === 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-status-added/5 border-b border-status-added/20 text-2xs text-status-added">
                <span className="w-1.5 h-1.5 rounded-full bg-status-added inline-block" />
                {t('changes.workingTreeClean')}
              </div>
            )}
          </div>

          {/* Journal panel (bottom) — shows recent commits like SmartGit */}
          <div className="flex-shrink-0" style={{ height: journalCollapsed ? 24 : journalHeight }}>
            {!journalCollapsed && (
              <ResizableSplitter direction="vertical" onResize={(d) => handleJournalResize(-d)} />
            )}
            <div className="flex items-center justify-between px-2 py-1 bg-bg-tertiary border-b border-border-default">
              <button
                className="flex items-center gap-1 text-2xs font-semibold uppercase text-text-secondary hover:text-text-primary transition-colors"
                onClick={() => setJournalCollapsed(!journalCollapsed)}
                title={journalCollapsed ? t('changes.expandJournal') : t('changes.collapseJournal')}
              >
                {journalCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                {t('changes.journal')}
              </button>
              <span className="text-2xs text-text-tertiary">{t('history.commits', { count: journal.length })}</span>
            </div>
            {!journalCollapsed && (
            <div className="overflow-y-auto" style={{ height: 'calc(100% - 24px)' }}>
              {journalLoading ? (
                <div className="px-2 py-2 text-xs text-text-tertiary flex items-center gap-2">
                  <span className="spinner" /> {t('common.loading')}
                </div>
              ) : journal.length === 0 ? (
                <div className="px-2 py-2 text-xs text-text-tertiary">{t('changes.noCommits')}</div>
              ) : (
                (() => {
                  // Group commits by relative time period for better scannability.
                  // Instead of repeating "5m ago" on every row, group them:
                  //   "3 commits · 5m ago"
                  //   "1 commit · 1h ago"
                  type Group = { label: string; entries: typeof journal };
                  const groups: Group[] = [];
                  let currentGroup: Group | null = null;
                  for (const entry of journal) {
                    const timeLabel = formatTime(entry.author.date);
                    if (!currentGroup || currentGroup.label !== timeLabel) {
                      currentGroup = { label: timeLabel, entries: [] };
                      groups.push(currentGroup);
                    }
                    currentGroup.entries.push(entry);
                  }
                  return groups.map((grp, gi) => (
                    <div key={gi}>
                      {grp.entries.length > 1 && (
                        <div className="px-2 py-0.5 bg-bg-tertiary/50 text-2xs text-text-tertiary border-b border-border-subtle">
                          {t('changes.commitsGroupLabel', { count: grp.entries.length, time: grp.label })}
                        </div>
                      )}
                      {grp.entries.map((entry) => {
                        const initials = getInitials(entry.author.name);
                        const color = getAuthorColor(entry.author.name);
                        return (
                          <div
                            key={entry.hash}
                            className="group flex items-center gap-2 px-2 py-1 text-xs border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
                            onClick={() => {
                              useSelectionStore.getState().selectCommit(entry.hash);
                              window.location.hash = '#/history';
                            }}
                            title={t('changes.viewInHistoryTitle')}
                          >
                            <span
                              className="flex-shrink-0 rounded author-badge text-center"
                              style={{ backgroundColor: color.bg, width: 24, height: 18, fontSize: 9, lineHeight: '18px' }}
                            >
                              {initials}
                            </span>
                            <RefBadges refs={entry.refs} max={3} hash={entry.hash} onChanged={loadJournal} />
                            <span className="flex-1 truncate font-medium text-text-primary">{entry.subject}</span>
                            <CommitHashLink hash={entry.hash} />
                            {grp.entries.length === 1 && (
                              <span className="text-text-tertiary flex-shrink-0">{grp.label}</span>
                            )}
                          </div>
                        );
                      })}

                    </div>
                  ));
                })()
              )}
            </div>
            )}
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
                {t('changes.amend')}
              </label>
              <label className="flex items-center gap-1 text-2xs text-text-secondary cursor-pointer" title={t('changes.commitAllTitle')}>
                <input
                  type="checkbox"
                  checked={commitAll}
                  onChange={(e) => setCommitAll(e.target.checked)}
                />
                {t('changes.commitAll')}
              </label>
              <button
                className={cn('text-2xs px-1.5 py-0.5 rounded', showMarkdownPreview ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
                onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                title={t('changes.toggleMarkdownPreview')}
              >
                MD
              </button>
              {/* SmartGit Manual: AI Commit Messages — generate button */}
              <button
                className={cn(
                  'text-2xs px-1.5 py-0.5 rounded flex items-center gap-1',
                  settings?.aiCommitMessagesEnabled
                    ? 'text-accent hover:bg-accent-muted'
                    : 'text-text-tertiary cursor-not-allowed opacity-50'
                )}
                onClick={handleAIGenerate}
                disabled={!settings?.aiCommitMessagesEnabled || aiGenerating}
                title={t('changes.aiGenerateTitle')}
              >
                <Sparkles size={10} className={aiGenerating ? 'animate-pulse' : ''} />
                AI
              </button>
              {/* Commit message history dropdown */}
              <div className="relative">
                <button
                  className={cn('text-2xs px-1.5 py-0.5 rounded flex items-center gap-1',
                    commitMsgHistory.length > 0 ? 'text-text-secondary hover:bg-bg-hover' : 'text-text-tertiary opacity-50 cursor-not-allowed')}
                  onClick={() => commitMsgHistory.length > 0 && setShowMsgHistory(!showMsgHistory)}
                  disabled={commitMsgHistory.length === 0}
                  title={t('changes.recentCommitMessages')}
                >
                  {t('nav.history')}
                </button>
                {showMsgHistory && commitMsgHistory.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 min-w-64 max-h-48 overflow-y-auto">
                    {commitMsgHistory.map((msg, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover truncate border-b border-border-subtle last:border-b-0"
                        title={msg}
                        onClick={() => {
                          setCommitMsg(msg);
                          setShowMsgHistory(false);
                        }}
                      >
                        {msg.split('\n')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1" />
              <button
                className="btn btn-secondary text-xs"
                onClick={handleCommitAndPush}
                disabled={!commitMsg.trim() || (!commitAll && stagedFiles.length === 0) || isCommitBlocked(status)}
                title={isCommitBlocked(status) ? t('changes.operationBlockedTitle') : t('changes.commitThenPushTitle')}
              >
                <GitPullRequest size={11} />
                {t('changes.commitAndPush')}
              </button>
              <button
                className="btn btn-primary text-xs"
                onClick={handleCommit}
                disabled={!commitMsg.trim() || (!commitAll && stagedFiles.length === 0) || isCommitBlocked(status)}
                title={isCommitBlocked(status) ? 'A git operation is in progress — finish it first (use the banner above)' : 'Ctrl+Enter'}
              >
                <GitCommit size={11} />
                Commit
              </button>
            </div>
            <div className="flex-1 flex overflow-hidden">
              <textarea
                id="commit-message-input"
                className="flex-1 text-sm font-mono resize-none p-2 bg-bg-primary border-r border-border-subtle"
                placeholder={t('changes.commitMessage')}
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
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowCleanDialog(false)}
        >
          <div className="panel w-[480px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium px-4 pt-4">{t('changes.cleanDialogTitle')}</h3>
            <div className="px-4 py-2 text-xs text-text-tertiary">
              {t('changes.cleanDialogBody')}
            </div>
            <div className="flex-1 overflow-y-auto mx-4 border border-border-default rounded bg-bg-tertiary">
              {cleanPreview.length === 0 ? (
                <div className="p-4 text-xs text-text-tertiary text-center">
                  {t('changes.cleanNothing')}
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
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary hover:!bg-status-deleted"
                onClick={handleCleanExecute}
                disabled={cleanBusy || cleanPreview.length === 0}
              >
                <Trash size={13} />
                {cleanPreview.length > 0 ? t('changes.cleanNPaths', { count: cleanPreview.length }) : t('changes.clean')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
