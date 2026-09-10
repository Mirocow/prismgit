import { useEffect, useState, Suspense, lazy, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Toolbar, GitToolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmDialogHost } from './components/ConfirmDialog';
import { WelcomeScreen } from './components/WelcomeScreen';
import { RebasePanel } from './components/RebasePanel';
import { FindObjectDialog } from './components/FindObjectDialog';
import { SequencerPanel } from './components/SequencerPanel';
import { MergeInProgressPanel } from './components/MergeInProgressPanel';
import { CommandPalette } from './components/CommandPalette';
import { KeyboardShortcutsOverlay } from './components/KeyboardShortcutsOverlay';
import { CommandLogPanel } from './components/CommandLogPanel';
import { DragDropHandler } from './components/DragDropHandler';
import { DeepLinkHandler } from './components/DeepLinkHandler';
import { HelpBanner } from './components/HelpBanner';
import { ResizableSplitter } from './components/ResizableSplitter';
import { NAV_SHORTCUTS } from './components/navItems';
import { RefActionDialog, type RefAction } from './components/RefActionDialog';
import { useChunkPreload } from './hooks/useChunkPreload';

// Heavy dialogs are code-split: they are never needed for first paint, and
// pulling them out of the initial bundle makes the app window show faster.
// Their chunks are warmed on idle by useChunkPreload, so the first open of
// each dialog stays instant (no fetch/parse penalty for the user).
const CloneModal = lazy(() => import('./components/CloneModal').then(m => ({ default: m.CloneModal })));
const InitModal = lazy(() => import('./components/InitModal').then(m => ({ default: m.InitModal })));
const GitFlowDialog = lazy(() => import('./components/GitFlowDialog').then(m => ({ default: m.GitFlowDialog })));
const InteractiveRebaseDialog = lazy(() => import('./components/InteractiveRebaseDialog').then(m => ({ default: m.InteractiveRebaseDialog })));
const ConflictSolver = lazy(() => import('./components/ConflictSolver').then(m => ({ default: m.ConflictSolver })));
const RepoInfoDialog = lazy(() => import('./components/RepoInfoDialog').then(m => ({ default: m.RepoInfoDialog })));
const ApplyPatchModal = lazy(() => import('./components/ApplyPatchModal').then(m => ({ default: m.ApplyPatchModal })));
const IndexEditorDialog = lazy(() => import('./components/IndexEditorDialog').then(m => ({ default: m.IndexEditorDialog })));
const RepoSettingsDialog = lazy(() => import('./components/RepoSettingsDialog').then(m => ({ default: m.RepoSettingsDialog })));
import { promptDialog, confirmDialog } from './components/ConfirmDialog';
import { t as i18nT, useI18nStore } from './lib/i18n';
import { clearProjectPrefs } from './lib/projectPrefs';
import { useWindowStyleStore } from './components/WindowStyleSwitcher';
import { useRepositoryStore } from './stores/repositoryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useToastStore } from './stores/toastStore';
import { useGitStore } from './stores/gitStore';
import { useSelectionStore } from './stores/selectionStore';
import { useBackgroundFetch } from './hooks/useBackgroundFetch';
import { useRemotePolling } from './hooks/useRemotePolling';
import { api } from './lib/api';
import { loadProjectPrefs, saveProjectPrefs } from './lib/projectPrefs';
import {
  buildCurrentDeepLink,
  clearPendingDeepLinkPage,
  currentHashPath,
  isValidDeepLinkPath,
  takePendingDeepLinkPage,
} from './lib/deepLinks';

// Lazy-load pages for smaller initial bundle
const ChangesPage = lazy(() => import('./pages/ChangesPage').then(m => ({ default: m.ChangesPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then(m => ({ default: m.HistoryPage })));
const DiffPage = lazy(() => import('./pages/DiffPage').then(m => ({ default: m.DiffPage })));
const AnnotatePage = lazy(() => import('./pages/AnnotatePage').then(m => ({ default: m.AnnotatePage })));
const BlamePage = lazy(() => import('./pages/BlamePage').then(m => ({ default: m.BlamePage })));
const InvestigatePage = lazy(() => import('./pages/InvestigatePage').then(m => ({ default: m.InvestigatePage })));
const JournalPage = lazy(() => import('./pages/JournalPage').then(m => ({ default: m.JournalPage })));
const GitFlowPage = lazy(() => import('./pages/GitFlowPage').then(m => ({ default: m.GitFlowPage })));
const PullRequestsPage = lazy(() => import('./pages/PullRequestsPage').then(m => ({ default: m.PullRequestsPage })));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage').then(m => ({ default: m.ReviewsPage })));
const LfsPage = lazy(() => import('./pages/LfsPage').then(m => ({ default: m.LfsPage })));
const BranchesPage = lazy(() => import('./pages/BranchesPage').then(m => ({ default: m.BranchesPage })));
const StashesPage = lazy(() => import('./pages/StashesPage').then(m => ({ default: m.StashesPage })));
const TagsPage = lazy(() => import('./pages/TagsPage').then(m => ({ default: m.TagsPage })));
const SubmodulesPage = lazy(() => import('./pages/SubmodulesPage').then(m => ({ default: m.SubmodulesPage })));
const WorktreesPage = lazy(() => import('./pages/WorktreesPage').then(m => ({ default: m.WorktreesPage })));
const ReflogPage = lazy(() => import('./pages/ReflogPage').then(m => ({ default: m.ReflogPage })));
const RecyclablePage = lazy(() => import('./pages/RecyclablePage').then(m => ({ default: m.RecyclablePage })));
const RemotesPage = lazy(() => import('./pages/RemotesPage').then(m => ({ default: m.RemotesPage })));
const BisectPage = lazy(() => import('./pages/BisectPage').then(m => ({ default: m.BisectPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const NotesPage = lazy(() => import('./pages/NotesPage').then(m => ({ default: m.NotesPage })));
const SubtreesPage = lazy(() => import('./pages/SubtreesPage').then(m => ({ default: m.SubtreesPage })));

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
      <div className="animate-fade-in">Loading...</div>
    </div>
  );
}

export default function App() {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const loadRepos = useRepositoryStore((s) => s.loadRepos);
  const loadMetadata = useRepositoryStore((s) => s.loadMetadata);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadAuth = useAuthStore((s) => s.loadAuthState);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const status = useGitStore((s) => s.status);
  const toast = useToastStore();
  const windowStyle = useWindowStyleStore((s) => s.style);
  const setWindowStyle = useWindowStyleStore((s) => s.setStyle);
  const navigate = useNavigate();
  const [showClone, setShowClone] = useState(false);
  const [showInit, setShowInit] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showGitFlow, setShowGitFlow] = useState(false);
  const [showIRebase, setShowIRebase] = useState(false);
  const [showRepoInfo, setShowRepoInfo] = useState(false);
  const [showApplyPatch, setShowApplyPatch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [dismissRebase, setDismissRebase] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showCommandLog, setShowCommandLog] = useState(false);
  const [commandLogHeight, setCommandLogHeight] = useState(260);
  const [refAction, setRefAction] = useState<RefAction | null>(null);
  const [indexEditorFile, setIndexEditorFile] = useState<string | null | undefined>(undefined);
  const [showIndexEditor, setShowIndexEditor] = useState(false);
  const [showRepoSettings, setShowRepoSettings] = useState(false);
  const [gitFlowType, setGitFlowType] = useState<'feature' | 'release' | 'hotfix' | undefined>(undefined);

  // SmartGit-style background "Poll or Fetch" for remotes marked in Configure remote properties
  useBackgroundFetch();
  // Periodic remote check for the repository list (fetch --all + ↓/↑ badges)
  useRemotePolling();
  // Warm lazily-loaded page/dialog chunks during idle time so every tool and
  // dialog opens instantly (no first-open chunk fetch/parse penalty).
  useChunkPreload();

  // Locale sync: notify the main process so the native application menu is
  // rebuilt in the active UI language (main initializes from the OS locale).
  const locale = useI18nStore((s) => s.locale);
  useEffect(() => {
    window.smartgit?.app?.setLocale?.(locale);
  }, [locale]);

  useEffect(() => {
    loadRepos();
    loadMetadata();
    loadSettings();
    loadAuth();
  }, [loadRepos, loadMetadata, loadSettings, loadAuth]);

  // Initialize the IPC listener for operation-log events from main process.
  // This captures ALL git operations (checkout, merge, cherry-pick, revert,
  // rebase, stash, tag, clone, etc.) — not just the ones manually logged in
  // the UI layer — and feeds them into the Operations tab.
  useEffect(() => {
    import('./stores/operationLogStore').then(({ initOperationLogIpcListener }) => {
      const cleanup = initOperationLogIpcListener();
      return cleanup;
    }).catch(() => { /* ignore — test env without electron */ });
  }, []);

  // Listen for repo-closed events to clear global selections and free memory
  useEffect(() => {
    const handler = () => {
      useSelectionStore.getState().clearAll();
      // A pending deep link targets the OLD repo context — drop it
      clearPendingDeepLinkPage();
      // Navigate back to welcome screen
      window.location.hash = '#/';
    };
    window.addEventListener('smartgit:repo-closed', handler);
    return () => window.removeEventListener('smartgit:repo-closed', handler);
  }, []);

  // Per-project UI preferences (the user's request: "настройки интерфейса
  // должны запоминаться на проект"). Two effects:
  //   1. When a repo opens, load its saved UI prefs into selectionStore.
  //   2. While a repo is open, subscribe to selectionStore and save the
  //      preference keys back (debounced) whenever they change.
  const repoPath = currentRepo?.path ?? null;
  // Track repo switches: selections (commit/file/branch/tag/stash) belong to a
  // specific repository — carrying them across repos would make History open a
  // foreign pathFilter or Notes attach to a foreign commit. View prefs are
  // per-project (applied right after) and are NOT touched.
  const lastRepoPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repoPath) {
      lastRepoPathRef.current = null;
      return;
    }
    if (lastRepoPathRef.current !== null && lastRepoPathRef.current !== repoPath) {
      useSelectionStore.getState().clearAll();
    }
    lastRepoPathRef.current = repoPath;
    useSelectionStore.getState().applyProjectPrefs(loadProjectPrefs(repoPath));
  }, [repoPath]);
  useEffect(() => {
    if (!repoPath) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useSelectionStore.subscribe((state, prev) => {
      const changed =
        state.fileViewMode !== prev.fileViewMode ||
        state.commitViewMode !== prev.commitViewMode ||
        state.compressFilePaths !== prev.compressFilePaths ||
        state.fileStatusFilter !== prev.fileStatusFilter ||
        state.fileStatusFilterSet !== prev.fileStatusFilterSet ||
        state.fileSort !== prev.fileSort ||
        state.fileFilterRegex !== prev.fileFilterRegex ||
        state.dirTreeVisible !== prev.dirTreeVisible ||
        state.colWidths !== prev.colWidths;
      if (!changed) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = useSelectionStore.getState();
        saveProjectPrefs(repoPath, {
          fileViewMode: s.fileViewMode,
          commitViewMode: s.commitViewMode,
          compressFilePaths: s.compressFilePaths,
          fileStatusFilter: s.fileStatusFilter,
          fileStatusFilterSet: Array.from(s.fileStatusFilterSet),
          fileSort: s.fileSort,
          fileFilterRegex: s.fileFilterRegex,
          dirTreeVisible: s.dirTreeVisible,
          colWidths: s.colWidths,
        });
      }, 400);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [repoPath]);

  // Listen for menu events
  useEffect(() => {
    const handleOpenRepo = (path: string) => {
      useRepositoryStore.getState().openRepository(path).catch((e) => {
        toast.error('Failed to open repository', String(e));
      });
    };
    const handleClone = () => setShowClone(true);
    const handleInit = () => setShowInit(true);
    const handleCommit = () => { window.location.hash = '#/changes'; };
    const handlePush = () => {
      const repo = useRepositoryStore.getState().currentRepo;
      if (!repo) return;
      useGitStore.getState().push(repo.path)
        .then(() => toast.success('Pushed successfully'))
        .catch((e) => toast.error('Push failed', String(e)));
    };
    const handlePull = () => {
      const repo = useRepositoryStore.getState().currentRepo;
      if (!repo) return;
      // SmartGit Manual: Smart Pull — prevents divergence after remote force-push
      api.git.smartPull(repo.path)
        .then((result) => {
          toast.success(`Smart pull: ${result.strategy}`, result.message);
          useGitStore.getState().refreshStatus(repo.path);
        })
        .catch((e) => toast.error('Pull failed', String(e)));
    };
    const handleFetch = () => {
      const repo = useRepositoryStore.getState().currentRepo;
      if (!repo) return;
      useGitStore.getState().fetch(repo.path)
        .then(() => toast.success('Fetched successfully'))
        .catch((e) => toast.error('Fetch failed', String(e)));
    };
    const handleToggleTheme = () => useSettingsStore.getState().toggleTheme();
    const handleGitFlow = () => setShowGitFlow(true);
    const handleIRebase = () => setShowIRebase(true);
    const handleShowShortcuts = () => setShowShortcuts(true);
    const handleToggleCommandLog = () => setShowCommandLog(s => !s);

    // ===== SmartGit-style command helpers =====
    const requireRepo = () => useRepositoryStore.getState().currentRepo;
    const selectedFile = () => useSelectionStore.getState().selectedFilePath;
    const warnNoFile = () => toast.warning('No file selected', 'Select a file in Changes first');
    const infoBox = (title: string, message: string) =>
      confirmDialog({ title, message: message.slice(0, 3000), confirmLabel: 'Close', hideCancel: true });

    const handleCheckout = () => setRefAction('checkout');
    const handleMerge = () => setRefAction('merge');
    const handleRebase = () => setRefAction('rebase');
    const handleCherryPick = () => setRefAction('cherry-pick');
    const handleRevert = () => setRefAction('revert');

    const handleAddTag = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const name = await promptDialog({
        title: 'Add Tag',
        message: 'Tag name (created at the commit selected in History, or HEAD)',
        input: { placeholder: 'v1.0.0' },
      });
      if (!name) return;
      const target = useSelectionStore.getState().selectedCommitHash;
      try {
        await api.git.createTag(repo.path, name, undefined, target || undefined);
        toast.success(`Tag ${name} created${target ? ` at ${target.slice(0, 7)}` : ''}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Add tag failed', String(e)); }
    };

    const handleSetTracked = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const branch = await api.git.currentBranch(repo.path).catch(() => null);
      if (!branch) { toast.warning('No local branch checked out'); return; }
      const remoteBranch = await promptDialog({
        title: 'Set Tracked Branch',
        message: `Remote branch that "${branch}" should track`,
        input: { placeholder: 'origin/main' },
      });
      if (!remoteBranch) return;
      try {
        await api.git.raw(repo.path, ['branch', '--set-upstream-to', remoteBranch, branch]);
        toast.success(`${branch} now tracks ${remoteBranch}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Set tracked branch failed', String(e)); }
    };

    const handleStopTracking = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const branch = await api.git.currentBranch(repo.path).catch(() => null);
      if (!branch) return;
      try {
        await api.git.raw(repo.path, ['branch', '--unset-upstream', branch]);
        toast.success(`${branch} no longer tracks a remote branch`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Stop tracking failed', String(e)); }
    };

    // ===== Bisect =====
    const bisect = async (op: 'start' | 'bad' | 'good' | 'skip' | 'reset' | 'log') => {
      const repo = requireRepo();
      if (!repo) return;
      const g = useGitStore.getState();
      const refresh = () => g.refreshStatus(repo.path).catch(() => {});
      try {
        switch (op) {
          case 'start':
            await api.git.bisectStart(repo.path);
            await api.git.bisectBad(repo.path, 'HEAD');
            toast.info('Bisect started', 'HEAD marked as bad — now mark a good commit (Branch | Bisect)');
            break;
          case 'bad': await api.git.bisectBad(repo.path); toast.success('HEAD marked as bad'); break;
          case 'good': await api.git.bisectGood(repo.path); toast.success('HEAD marked as good'); break;
          case 'skip': await api.git.bisectSkip(repo.path); toast.success('Commit skipped'); break;
          case 'reset': await api.git.bisectReset(repo.path); toast.success('Bisect finished'); break;
          case 'log': {
            const logText = await api.git.bisectLog(repo.path);
            await infoBox('Bisect Log', logText);
            break;
          }
        }
        refresh();
      } catch (e) { toast.error('Bisect failed', String(e)); }
    };

    // ===== Local operations =====
    const handleStage = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      try { await api.git.add(repo.path, [f]); toast.success(`Staged ${f}`); useGitStore.getState().refreshStatus(repo.path); }
      catch (e) { toast.error('Stage failed', String(e)); }
    };
    const handleUnstage = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      try { await api.git.resetFile(repo.path, f); toast.success(`Unstaged ${f}`); useGitStore.getState().refreshStatus(repo.path); }
      catch (e) { toast.error('Unstage failed', String(e)); }
    };
    const handleStageAll = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try { await useGitStore.getState().stageAll(repo.path); toast.success('All changes staged'); }
      catch (e) { toast.error('Stage failed', String(e)); }
    };
    const handleDiscard = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      const ok = await confirmDialog({
        title: 'Discard changes',
        message: `Discard ALL changes of "\u200b${f}" in the Working Tree?\nThis cannot be undone.`,
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.git.restore(repo.path, [f]);
        toast.success(`Discarded changes in ${f}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Discard failed', String(e)); }
    };
    const handleEditLastCommitMessage = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try {
        const entries = await api.git.log(repo.path, { maxCount: 1 });
        const current = entries[0]?.message ?? '';
        const message = await promptDialog({
          title: 'Edit Last Commit Message',
          message: 'New commit message for HEAD',
          input: { initialValue: current },
        });
        if (!message || message === current) return;
        await api.git.editCommitMessage(repo.path, 'HEAD', message);
        toast.success('Commit message updated');
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Edit message failed', String(e)); }
    };
    const handleEditCommitAuthor = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const value = await promptDialog({
        title: 'Edit Commit Author',
        message: 'Author of the commit selected in History (or HEAD): Name <email>',
        input: { placeholder: 'Ada Lovelace <ada@example.com>' },
      });
      if (!value) return;
      const m = value.match(/^([^<]+)<([^>]+)>\s*$/);
      if (!m) { toast.error('Invalid format', 'Use: Name <email>'); return; }
      const target = useSelectionStore.getState().selectedCommitHash || 'HEAD';
      try {
        await api.git.editCommitAuthor(repo.path, target, m[1].trim(), m[2].trim());
        toast.success(`Author of ${target === 'HEAD' ? 'HEAD' : target.slice(0, 7)} changed to ${m[1].trim()}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Edit author failed', String(e)); }
    };
    const handleUndoLastCommit = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const ok = await confirmDialog({
        title: 'Undo Last Commit',
        message: 'Move the last commit\u2019s changes back into the Index? The commit itself will be removed (soft reset).',
        confirmLabel: 'Undo Commit',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.git.reset(repo.path, 'soft', 'HEAD~1');
        toast.success('Last commit undone — changes are back in the Index');
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Undo commit failed', String(e)); }
    };
    const handleStashSelection = () => {
      window.location.hash = '#/changes';
      // ChangesPage listens and stashes its selected files
      setTimeout(() => window.dispatchEvent(new CustomEvent('smartgit:stash-selection')), 60);
    };
    const handleApplyStash = () => {
      const repo = requireRepo();
      if (!repo) return;
      window.location.hash = '#/stashes';
      toast.info('Select a stash and click Apply');
    };

    const handleIgnore = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      try { await api.git.ignore(repo.path, [f]); toast.success(`${f} added to .gitignore`); useGitStore.getState().refreshStatus(repo.path); }
      catch (e) { toast.error('Ignore failed', String(e)); }
    };
    const handleEditIgnoreFile = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try { await api.git.editIgnoreFile(repo.path, 'local'); toast.success('.gitignore opened in the default editor'); }
      catch (e) { toast.error('Failed to open .gitignore', String(e)); }
    };
    const handleIndexFlag = async (flag: 'assume-unchanged' | 'skip-worktree') => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      try {
        const flags = await api.git.getIndexFlags(repo.path, f);
        const current = flag === 'assume-unchanged' ? flags.assumeUnchanged : flags.skipWorktree;
        await api.git.setIndexFlag(repo.path, f, flag, !current);
        toast.success(`${f}: ${flag} ${!current ? 'ON' : 'OFF'}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Toggle failed', String(e)); }
    };
    const handleMoveRename = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      const target = await promptDialog({
        title: 'Move or Rename',
        message: 'New path for the file (git mv — the rename is staged)',
        input: { initialValue: f },
      });
      if (!target || target === f) return;
      try {
        await api.git.moveFile(repo.path, f, target);
        toast.success(`${f} → ${target}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Move/rename failed', String(e)); }
    };
    const handleDeleteFile = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      const ok = await confirmDialog({
        title: 'Delete file',
        message: `Delete "${f}" from the Working Tree AND the repository?\nThis cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try { await api.git.deleteFile(repo.path, f); toast.success(`${f} deleted`); useGitStore.getState().refreshStatus(repo.path); }
      catch (e) { toast.error('Delete failed', String(e)); }
    };
    const handleRemoveFile = async () => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      try {
        await api.git.raw(repo.path, ['rm', '--cached', '--', f]);
        toast.success(`${f} removed from the repository (kept in Working Tree)`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Remove failed', String(e)); }
    };

    // ===== Resolve submenu =====
    const resolveConflict = async (mode: 'ours' | 'theirs' | 'resolved') => {
      const repo = requireRepo();
      const f = selectedFile();
      if (!repo) return;
      if (!f) { warnNoFile(); return; }
      try {
        if (mode !== 'resolved') {
          await api.git.raw(repo.path, ['checkout', `--${mode}`, '--', f]);
        }
        await api.git.add(repo.path, [f]);
        toast.success(`${f}: ${mode === 'resolved' ? 'marked resolved' : `took ${mode}`}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Resolve failed', String(e)); }
    };
    const handleConflictSolver = () => {
      const f = selectedFile();
      if (!f) { warnNoFile(); return; }
      setConflictFile(f);
    };

    // ===== LFS =====
    const lfsOp = async (op: 'install' | 'lock' | 'unlock') => {
      const repo = requireRepo();
      if (!repo) return;
      try {
        if (op === 'install') {
          await api.git.lfsInstall(repo.path);
          toast.success('Git LFS installed for this repository');
        } else {
          const f = selectedFile();
          if (!f) { warnNoFile(); return; }
          if (op === 'lock') { await api.git.lfsLock(repo.path, f); toast.success(`Locked ${f}`); }
          else { await api.git.lfsUnlock(repo.path, f); toast.success(`Unlocked ${f}`); }
        }
      } catch (e) { toast.error('LFS operation failed', String(e)); }
    };
    const handleLfsTrack = () => {
      window.location.hash = '#/lfs';
      toast.info('Use the Track button on the LFS page');
    };

    // ===== Remote =====
    const handlePushTo = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const remote = await promptDialog({
        title: 'Push To...',
        message: 'Remote to push the current branch to',
        input: { initialValue: 'origin' },
      });
      if (!remote) return;
      const branch = await api.git.currentBranch(repo.path).catch(() => null);
      try {
        await api.git.push(repo.path, remote, branch ?? undefined, true);
        toast.success(`Pushed ${branch ?? ''} to ${remote}`);
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Push failed', String(e)); }
    };
    const handlePullOptions = () => {
      const repo = requireRepo();
      if (!repo) return;
      window.location.hash = '#/branches';
      toast.info('Right-click the branch → Pull... for options (merge/rebase/ff-only)');
    };
    const handleFetchAll = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try { await api.git.fetchAll(repo.path); toast.success('Fetched all remotes'); useGitStore.getState().refreshStatus(repo.path); }
      catch (e) { toast.error('Fetch all failed', String(e)); }
    };
    const handleFetchMore = () => {
      window.location.hash = '#/branches';
      toast.info('Right-click a remote → Fetch More... (or Set Depth... for shallow clones)');
    };

    // ===== Query / Tools =====
    const handleVerifyDatabase = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try {
        const report = await api.git.verifyDatabase(repo.path);
        await infoBox('Verify Database (git fsck --full)', report.trim() || 'No problems found — repository is healthy.');
      } catch (e) { toast.error('Verify failed', String(e)); }
    };
    const handleGarbageCollect = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try {
        const stats = await api.git.garbageCollect(repo.path);
        await infoBox('Garbage Collect (git gc)', stats.trim() || 'Done.');
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('GC failed', String(e)); }
    };
    const handleOpenTerminal = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const ok = await api.fs.openTerminal(repo.path);
      if (!ok) toast.error('Could not open a terminal');
    };
    const handleOpenInVscode = async () => {
      const repo = requireRepo();
      if (!repo) return;
      try {
        const res = await api.vscode.open(repo.path);
        if (res.ok) toast.success(i18nT('vscode.opened'));
        else toast.error(i18nT('vscode.openFailed'));
      } catch (e) {
        toast.error(i18nT('vscode.openFailed'), String(e));
      }
    };
    const handleFormatPatch = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const commit = useSelectionStore.getState().selectedCommitHash;
      const outDir = await promptDialog({
        title: 'Format Patch',
        message: 'Output directory for the .patch file(s)',
        input: { initialValue: `${repo.path}/patches`, hint: 'Writes the selected commit, or HEAD when nothing is selected' },
      });
      if (!outDir) return;
      try {
        const files = await api.git.formatPatch(repo.path, { outputDir: outDir, commit: commit || 'HEAD' });
        await infoBox('Format Patch', `Written:\n${files.join('\n')}`);
      } catch (e) { toast.error('Format patch failed', String(e)); }
    };

    // ===== Git-Flow (dialog-driven; flow type preset through initialFlow) =====
    const gitFlow = (flow?: string) => {
      if (flow === 'feature' || flow === 'release' || flow === 'hotfix') setGitFlowType(flow);
      else setGitFlowType(undefined);
      setShowGitFlow(true);
    };

    const handleAbortSequence = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const st = useGitStore.getState().status;
      try {
        if (st?.isRebasing) await api.git.rebase(repo.path, 'HEAD', { abort: true });
        else if (st?.isCherryPicking) await api.git.cherryPickAbort(repo.path);
        else if (st?.isReverting) await api.git.revertAbort(repo.path);
        else if (st?.isMerging) await api.git.abortMerge(repo.path);
        else { toast.info('Nothing to abort'); return; }
        toast.success('Operation aborted — repository restored');
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Abort failed', String(e)); }
    };
    const handleContinueSequence = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const st = useGitStore.getState().status;
      try {
        if (st?.isRebasing) await api.git.rebase(repo.path, 'HEAD', { continue: true });
        else if (st?.isCherryPicking) await api.git.cherryPickContinue(repo.path);
        else if (st?.isReverting) await api.git.revertContinue(repo.path);
        else if (st?.isMerging) await api.git.continueMerge(repo.path);
        else { toast.info('Nothing to continue'); return; }
        toast.success('Operation continued');
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Continue failed', String(e)); }
    };
    // Skip the current commit in a cherry-pick / revert / rebase sequence.
    // Used when a commit produces an empty result (changes already applied).
    const handleSkipSequence = async () => {
      const repo = requireRepo();
      if (!repo) return;
      const st = useGitStore.getState().status;
      try {
        if (st?.isRebasing) await api.git.rebase(repo.path, 'HEAD', { skip: true });
        else if (st?.isCherryPicking) await api.git.cherryPickSkip(repo.path);
        else if (st?.isReverting) await api.git.revertSkip(repo.path);
        else { toast.info('Nothing to skip (merge has no skip)'); return; }
        toast.info('Commit skipped — sequence continues with the next one');
        useGitStore.getState().refreshStatus(repo.path);
      } catch (e) { toast.error('Skip failed', String(e)); }
    };

    const handleWindowStyle = (style: unknown) => {
      if (style === 'standard' || style === 'log' || style === 'working-tree') {
        setWindowStyle(style);
        toast.info(`Window style: ${style}`);
      }
    };
    const handleResetPerspective = async () => {
      const repo = requireRepo();
      if (!repo) return;
      clearProjectPrefs(repo.path);
      useSelectionStore.getState().clearAll();
      toast.success('Perspective reset — layout preferences cleared');
    };
    const handleNavigate = (path: unknown) => {
      if (typeof path === 'string' && requireRepo()) navigate(path);
    };

    // ===== Deep links (View → Go to / Copy Deep Link) — defined below as
    // useCallbacks so the Command Palette can trigger them too =====
    const cleanups = [
      window.smartgit.events.on('menu:openRepository', (path) => handleOpenRepo(path as string)),
      window.smartgit.events.on('menu:cloneRepository', handleClone),
      window.smartgit.events.on('menu:initRepository', handleInit),
      window.smartgit.events.on('menu:commit', handleCommit),
      window.smartgit.events.on('menu:push', handlePush),
      window.smartgit.events.on('menu:pull', handlePull),
      window.smartgit.events.on('menu:fetch', handleFetch),
      window.smartgit.events.on('menu:toggleTheme', handleToggleTheme),
      window.smartgit.events.on('menu:gitFlow', () => gitFlow()),
      window.smartgit.events.on('menu:gitFlowStartFeature', () => gitFlow('feature')),
      window.smartgit.events.on('menu:gitFlowFinishFeature', () => gitFlow('feature')),
      window.smartgit.events.on('menu:gitFlowStartRelease', () => gitFlow('release')),
      window.smartgit.events.on('menu:gitFlowFinishRelease', () => gitFlow('release')),
      window.smartgit.events.on('menu:gitFlowStartHotfix', () => gitFlow('hotfix')),
      window.smartgit.events.on('menu:gitFlowFinishHotfix', () => gitFlow('hotfix')),
      window.smartgit.events.on('menu:gitFlowIntegrateDevelop', () => gitFlow('feature')),
      window.smartgit.events.on('menu:interactiveRebase', handleIRebase),
      window.smartgit.events.on('menu:showShortcuts', handleShowShortcuts),
      window.smartgit.events.on('menu:commandLog', handleToggleCommandLog),
      // Branch menu
      window.smartgit.events.on('menu:checkout', handleCheckout),
      window.smartgit.events.on('menu:merge', handleMerge),
      window.smartgit.events.on('menu:rebase', handleRebase),
      window.smartgit.events.on('menu:cherryPick', handleCherryPick),
      window.smartgit.events.on('menu:revert', handleRevert),
      window.smartgit.events.on('menu:addTag', handleAddTag),
      window.smartgit.events.on('menu:setTracked', handleSetTracked),
      window.smartgit.events.on('menu:stopTracking', handleStopTracking),
      window.smartgit.events.on('menu:bisectStart', () => bisect('start')),
      window.smartgit.events.on('menu:bisectBad', () => bisect('bad')),
      window.smartgit.events.on('menu:bisectGood', () => bisect('good')),
      window.smartgit.events.on('menu:bisectSkip', () => bisect('skip')),
      window.smartgit.events.on('menu:bisectReset', () => bisect('reset')),
      window.smartgit.events.on('menu:bisectLog', () => bisect('log')),
      window.smartgit.events.on('menu:abortSequence', handleAbortSequence),
      window.smartgit.events.on('menu:continueSequence', handleContinueSequence),
      window.smartgit.events.on('menu:skipSequence', handleSkipSequence),
      // Local menu
      window.smartgit.events.on('menu:stage', handleStage),
      window.smartgit.events.on('menu:unstage', handleUnstage),
      window.smartgit.events.on('menu:stageAll', handleStageAll),
      window.smartgit.events.on('menu:discard', handleDiscard),
      window.smartgit.events.on('menu:editLastCommitMessage', handleEditLastCommitMessage),
      window.smartgit.events.on('menu:editCommitAuthor', handleEditCommitAuthor),
      window.smartgit.events.on('menu:undoLastCommit', handleUndoLastCommit),
      window.smartgit.events.on('menu:stash', handleStashSelection),
      window.smartgit.events.on('menu:stashSelection', handleStashSelection),
      window.smartgit.events.on('menu:applyStash', handleApplyStash),
      window.smartgit.events.on('menu:indexEditor', () => { setShowIndexEditor(true); setIndexEditorFile(selectedFile()); }),
      window.smartgit.events.on('menu:ignore', handleIgnore),
      window.smartgit.events.on('menu:editIgnoreFile', handleEditIgnoreFile),
      window.smartgit.events.on('menu:assumeUnchanged', () => handleIndexFlag('assume-unchanged')),
      window.smartgit.events.on('menu:skipWorktree', () => handleIndexFlag('skip-worktree')),
      window.smartgit.events.on('menu:moveRename', handleMoveRename),
      window.smartgit.events.on('menu:deleteFile', handleDeleteFile),
      window.smartgit.events.on('menu:removeFile', handleRemoveFile),
      window.smartgit.events.on('menu:conflictSolver', handleConflictSolver),
      window.smartgit.events.on('menu:resolveOurs', () => resolveConflict('ours')),
      window.smartgit.events.on('menu:resolveTheirs', () => resolveConflict('theirs')),
      window.smartgit.events.on('menu:markResolved', () => resolveConflict('resolved')),
      window.smartgit.events.on('menu:lfsInstall', () => lfsOp('install')),
      window.smartgit.events.on('menu:lfsTrack', handleLfsTrack),
      window.smartgit.events.on('menu:lfsLock', () => lfsOp('lock')),
      window.smartgit.events.on('menu:lfsUnlock', () => lfsOp('unlock')),
      // Remote menu
      window.smartgit.events.on('menu:pushTo', handlePushTo),
      window.smartgit.events.on('menu:pullOptions', handlePullOptions),
      window.smartgit.events.on('menu:fetchAll', handleFetchAll),
      window.smartgit.events.on('menu:fetchMore', handleFetchMore),
      window.smartgit.events.on('menu:remoteAdd', () => handleNavigate('/remotes')),
      window.smartgit.events.on('menu:remoteRename', () => handleNavigate('/remotes')),
      window.smartgit.events.on('menu:remoteDelete', () => handleNavigate('/remotes')),
      window.smartgit.events.on('menu:remoteProperties', () => handleNavigate('/remotes')),
      window.smartgit.events.on('menu:setDepth', handleFetchMore),
      // Repository menu
      window.smartgit.events.on('menu:repoSettings', () => setShowRepoSettings(true)),
      window.smartgit.events.on('menu:editGitConfig', () => handleNavigate('/settings')),
      window.smartgit.events.on('menu:openTerminal', handleOpenTerminal),
      window.smartgit.events.on('menu:openInVscode', handleOpenInVscode),
      window.smartgit.events.on('menu:preferences', () => handleNavigate('/settings')),
      // Query / Tools
      window.smartgit.events.on('menu:navigate', handleNavigate),
      window.smartgit.events.on('menu:goDeepLink', () => handleGoDeepLink()),
      window.smartgit.events.on('menu:copyDeepLink', handleCopyDeepLink),
      window.smartgit.events.on('menu:findObject', handleFind),
      window.smartgit.events.on('menu:verifyDatabase', handleVerifyDatabase),
      window.smartgit.events.on('menu:garbageCollect', handleGarbageCollect),
      window.smartgit.events.on('menu:applyPatch', () => setShowApplyPatch(true)),
      window.smartgit.events.on('menu:formatPatch', handleFormatPatch),
      // Window menu
      window.smartgit.events.on('menu:windowStyle', handleWindowStyle),
      window.smartgit.events.on('menu:resetPerspective', handleResetPerspective),
    ];
    return () => cleanups.forEach((fn) => fn && fn());
  }, [toast]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      // Command palette — works even from inputs (standard UX), toggles
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isInInput) {
        e.preventDefault();
        setShowFind(true);
      }
      // F5 / Ctrl+R — refresh git status (never reload the window)
      if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'r' || e.key === 'R'))) {
        e.preventDefault();
        const repo = useRepositoryStore.getState().currentRepo;
        if (repo) useGitStore.getState().refreshStatus(repo.path);
        return;
      }
      // '?' — plain question mark opens shortcuts help; Ctrl+?/Ctrl+/ (below)
      // handles the toggle variant
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !isInInput) {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        useSettingsStore.getState().toggleTheme();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G' && !isInInput) {
        e.preventDefault();
        setShowGitFlow(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R' && !isInInput) {
        e.preventDefault();
        setShowIRebase(true);
      }
      // Keyboard shortcuts overlay: Ctrl+? (Shift+/ produces ?) or Ctrl+/
      // Idempotent OPEN (not toggle): the native menu accelerator
      // (Keyboard Shortcuts..., Ctrl+/) also opens the dialog — a toggle here
      // would open+close it in the same keystroke. (Bug class: renderer
      // keydown duplicated native menu accelerators → double execution.)
      if ((e.ctrlKey || e.metaKey) && (e.key === '?' || e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(true);
      }
      // Alt+number navigation: Alt+1=Changes, Alt+2=History, Alt+3=Diff,
      // Alt+4=Branches, Alt+5=Tags, Alt+6=Stashes, Alt+, =Settings
      // (read the repo from the store — a closure here would be stale since
      // this effect has stable deps and runs once)
      if (e.altKey && !isInInput) {
        const altMap: Record<string, string> = {
          '1': '/changes',
          '2': '/history',
          '3': '/diff',
          '4': '/branches',
          '5': '/tags',
          '6': '/stashes',
          ',': '/settings',
        };
        const target = altMap[e.key];
        if (target && useRepositoryStore.getState().currentRepo) {
          e.preventDefault();
          navigate(target);
        }
      }
      // NOTE — git-operation shortcuts (Ctrl+Shift+P/L/F/A), window style
      // (Ctrl+Shift+1/2/3), Clone (Ctrl+Shift+O) and the Output panel
      // (Ctrl+Shift+U) are handled by the NATIVE application menu
      // (electron/menu.ts accelerators → menu:* events). Do NOT duplicate them
      // here: on Windows/Linux Electron does NOT consume the keydown when a
      // menu accelerator fires, so both handlers ran — e.g. Fetch downloaded
      // everything TWICE per keystroke (user-reported bug). The menu is the
      // single owner of these shortcuts.
      // Ctrl+1..9 — quick page navigation (only with an open repository)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9' && !isInInput) {
        const path = Object.entries(NAV_SHORTCUTS).find(([, sc]) => sc === `Ctrl+${e.key}`)?.[0];
        if (path && useRepositoryStore.getState().currentRepo) {
          e.preventDefault();
          navigate(path);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

  // Shortcuts dialog can be opened from the Command Palette via this event
  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener('prismgit:show-shortcuts', handler);
    return () => window.removeEventListener('prismgit:show-shortcuts', handler);
  }, []);

  // Repository Settings dialog — triggered from Sidebar context menu
  useEffect(() => {
    const handler = () => setShowRepoSettings(true);
    window.addEventListener('prismgit:repo-settings', handler);
    return () => window.removeEventListener('prismgit:repo-settings', handler);
  }, []);

  // SmartGit Manual: Command-Line Options
  // Handle --open / --log / --blame / --investigate / --anchor-commit sent from electron/main.ts
  useEffect(() => {
    const cleanupOpen = window.smartgit.events.on('cli:open', (data: unknown) => {
      const { path } = data as { path: string };
      useRepositoryStore.getState().openRepository(path).catch((e) => {
        toast.error('Failed to open repository', String(e));
      });
    });
    const cleanupLog = window.smartgit.events.on('cli:log', (data: unknown) => {
      const { path, anchorCommit } = data as { path: string; anchorCommit?: string };
      // If path is a directory → open repo + navigate to History
      // If path is a file → open repo + set path filter + navigate to History
      useRepositoryStore.getState().openRepository(path).then(() => {
        if (anchorCommit) useSelectionStore.getState().selectCommit(anchorCommit);
        navigate('/history');
      }).catch((e) => toast.error('Failed to open', String(e)));
    });
    const cleanupBlame = window.smartgit.events.on('cli:blame', (data: unknown) => {
      const { path, anchorCommit } = data as { path: string; anchorCommit?: string };
      useRepositoryStore.getState().openRepository(path).then(() => {
        if (anchorCommit) useSelectionStore.getState().selectCommit(anchorCommit);
        navigate('/blame');
      }).catch((e) => toast.error('Failed to open', String(e)));
    });
    const cleanupInvestigate = window.smartgit.events.on('cli:investigate', (data: unknown) => {
      const { path, anchorCommit } = data as { path: string; anchorCommit?: string };
      useRepositoryStore.getState().openRepository(path).then(() => {
        if (anchorCommit) useSelectionStore.getState().selectCommit(anchorCommit);
        navigate('/history');
      }).catch((e) => toast.error('Failed to open', String(e)));
    });
    return () => { cleanupOpen(); cleanupLog(); cleanupBlame(); cleanupInvestigate(); };
  }, [navigate, toast]);

  // File watcher: start/stop when repo changes + auto-refresh on changes.
  // Debounce strategy: leading-rate-limited + TRAILING guaranteed.
  // Each watcher event schedules a refresh at most MIN_REFRESH_INTERVAL after
  // the previous one; if events arrive faster, they coalesce into one trailing
  // refresh — a change is never dropped (the old code silently discarded
  // events inside the 2s window, so edits could stay invisible indefinitely).
  const refreshInFlight = useRef<Promise<unknown> | null>(null);
  const lastRefreshTime = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentRepo) return;
    const repoPath = currentRepo.path;
    api.watcher.start(repoPath);

    const doRefresh = () => {
      lastRefreshTime.current = Date.now();
      const p = refreshStatus(repoPath).catch(() => { /* status errors shown elsewhere */ });
      // Chain so a trailing refresh can wait for the in-flight one to settle
      refreshInFlight.current = p.finally(() => {
        if (refreshInFlight.current === p) refreshInFlight.current = null;
      });
    };

    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      const elapsed = Date.now() - lastRefreshTime.current;
      const delay = Math.max(0, 2000 - elapsed);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        if (refreshInFlight.current) {
          // A refresh started before the latest change — wait for it, then refresh again
          void Promise.resolve(refreshInFlight.current).then(() => {
            if (!refreshTimer.current) doRefresh();
          });
        } else {
          doRefresh();
        }
      }, delay);
    };

    const cleanup = api.watcher.onChanged(() => scheduleRefresh());
    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      api.watcher.stop(repoPath);
      cleanup();
    };
  }, [currentRepo, refreshStatus]);

  // Navigate when window style changes — only when user explicitly switches
  const prevStyle = useRef(windowStyle);
  useEffect(() => {
    if (!currentRepo) return;
    // Only navigate if style actually changed (not on first render)
    if (prevStyle.current !== windowStyle) {
      prevStyle.current = windowStyle;
      // Per user request: Changes should always be the default landing page,
      // even when window style is 'log' (which only affects visual chrome).
      // Users who want History can navigate there manually.
      navigate('/changes');
    }
  }, [windowStyle, currentRepo, navigate]);

  // Refresh status when repository changes (only once, not on every render)
  useEffect(() => {
    if (currentRepo) {
      refreshStatus(currentRepo.path);
      setDismissRebase(false);
      // A cold-start deep link (e.g. '#/history?file=X' before any repo was
      // open) remembers its target page — land there instead of Changes.
      const pendingPage = takePendingDeepLinkPage();
      // Default landing page is Changes (per user request). Even if the user
      // was on Settings or another page, opening a repo should show it first.
      navigate(pendingPage || '/changes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo?.path]);

  const showRebasePanel = currentRepo && status?.isRebasing && !dismissRebase;
  // Cherry-pick / revert sequences used to have NO visible continuation UI
  // (the SequencerPanel existed but was never rendered) — mount it the same
  // way RebasePanel is mounted, driven by git status flags.
  const sequencerKind: 'cherry-pick' | 'revert' | null =
    status?.isCherryPicking ? 'cherry-pick' : status?.isReverting ? 'revert' : null;
  const [dismissSequencer, setDismissSequencer] = useState(false);
  const showSequencerPanel = currentRepo && sequencerKind && !dismissSequencer;
  useEffect(() => {
    setDismissSequencer(false);
  }, [currentRepo?.path, status?.isCherryPicking, status?.isReverting]);
  // Merge in progress: auto-mount a MergeInProgressPanel (the full MergePanel
  // is a START dialog and requires a targetBranch). This surfaces
  // Continue/Abort + conflicted-file list for merges started from terminal.
  const [dismissMerge, setDismissMerge] = useState(false);
  const showMergePanel = currentRepo && status?.isMerging && !dismissMerge;
  useEffect(() => {
    setDismissMerge(false);
  }, [currentRepo?.path, status?.isMerging]);

  const handleFind = useCallback(() => setShowFind(true), []);

  // ===== Deep links (View → Go to / Copy Deep Link, Command Palette) =====
  const handleCopyDeepLink = useCallback(() => {
    if (!useRepositoryStore.getState().currentRepo) return;
    const link = buildCurrentDeepLink(currentHashPath());
    const href = `${window.location.href.split('#')[0]}#${link}`;
    navigator.clipboard.writeText(href)
      .then(() => toast.success('Deep link copied', link))
      .catch((e) => toast.error('Copy failed', String(e)));
  }, [toast]);
  const handleGoDeepLink = useCallback(async () => {
    if (!useRepositoryStore.getState().currentRepo) return;
    const value = await promptDialog({
      title: 'Go to Deep Link',
      message: 'Enter a deep-link path — page plus selection params, e.g. '
        + '/history?file=src/App.tsx, /blame?file=README.md, /history?branch=main&author=Ivan',
      input: {
        initialValue: buildCurrentDeepLink(currentHashPath()),
        placeholder: '/history?file=src/App.tsx',
      },
      confirmLabel: 'Go',
    });
    if (!value) return;
    const path = value.trim().replace(/^#+/, '');
    if (!isValidDeepLinkPath(path)) {
      toast.error('Invalid deep link', 'Expected a path like /history?file=src/App.tsx');
      return;
    }
    navigate(path);
  }, [navigate, toast]);

  // Default route is always Changes (per user request — window style only affects chrome)
  const defaultRoute = '/changes';

  if (!currentRepo) {
    return (
      <div className="flex flex-col h-screen">
        <Toolbar onFind={handleFind} onGitFlow={() => setShowGitFlow(true)} onInteractiveRebase={() => setShowIRebase(true)} onRepoInfo={() => setShowRepoInfo(true)} onShowShortcuts={() => setShowShortcuts(true)} onShowClone={() => setShowClone(true)} onShowInit={() => setShowInit(true)} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-hidden flex flex-col">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<WelcomeScreen onClone={() => setShowClone(true)} onInit={() => setShowInit(true)} />} />
              </Routes>
            </Suspense>
          </div>
        </div>
        <StatusBar
          showCommandLog={showCommandLog}
          onToggleCommandLog={() => setShowCommandLog(s => !s)}
        />
        <ToastContainer />
        <ConfirmDialogHost />
        <DragDropHandler />
        <DeepLinkHandler />
        <Suspense fallback={null}><CloneModal open={showClone} onClose={() => setShowClone(false)} /></Suspense>
        <Suspense fallback={null}><InitModal open={showInit} onClose={() => setShowInit(false)} /></Suspense>
        <FindObjectDialog open={showFind} onClose={() => setShowFind(false)} />
        <CommandPalette
          open={showPalette}
          onClose={() => setShowPalette(false)}
          triggers={{
            onFind: () => setShowFind(true),
            onGitFlow: () => setShowGitFlow(true),
            onInteractiveRebase: () => setShowIRebase(true),
            onRepoInfo: () => setShowRepoInfo(true),
            onApplyPatch: () => setShowApplyPatch(true),
            onClone: () => setShowClone(true),
            onInit: () => setShowInit(true),
            onGoDeepLink: handleGoDeepLink,
            onCopyDeepLink: handleCopyDeepLink,
          }}
        />
        <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <Toolbar
        onFind={handleFind}
        onGitFlow={() => setShowGitFlow(true)}
        onInteractiveRebase={() => setShowIRebase(true)}
        onRepoInfo={() => setShowRepoInfo(true)}
        onShowShortcuts={() => setShowShortcuts(true)}
        onShowClone={() => setShowClone(true)}
        onShowInit={() => setShowInit(true)}
        onToggleCommandLog={() => setShowCommandLog(s => !s)}
      />
      <GitToolbar
        onGitFlow={() => setShowGitFlow(true)}
        onInteractiveRebase={() => setShowIRebase(true)}
      />
      <div className="flex flex-1 overflow-hidden no-drag">
        {/* Sidebar always visible — navigation must be accessible */}
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <HelpBanner />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to={defaultRoute} replace />} />
              <Route path="/changes" element={<ChangesPage onResolveConflict={(f) => setConflictFile(f)} />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/diff" element={<DiffPage />} />
              {/* Annotate: file-history investigation (SmartGit "Log of file") */}
              <Route path="/annotate" element={<AnnotatePage />} />
              {/* Investigate renamed to Search */}
              <Route path="/investigate" element={<Navigate to="/search" replace />} />
              <Route path="/search" element={<InvestigatePage />} />
              <Route path="/blame" element={<BlamePage />} />
              {/* Journal: reflog-based journal of the current branch activity */}
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/gitflow" element={<GitFlowPage />} />
              <Route path="/pulls" element={<PullRequestsPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/lfs" element={<LfsPage />} />
              <Route path="/branches" element={<BranchesPage />} />
              <Route path="/stashes" element={<StashesPage />} />
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/submodules" element={<SubmodulesPage />} />
              <Route path="/subtrees" element={<SubtreesPage />} />
              <Route path="/worktrees" element={<WorktreesPage />} />
              <Route path="/reflog" element={<ReflogPage />} />
              <Route path="/recyclable" element={<RecyclablePage />} />
              <Route path="/remotes" element={<RemotesPage />} />
              <Route path="/bisect" element={<BisectPage />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {showCommandLog && (
        <>
          <ResizableSplitter direction="vertical" onResize={(d) => setCommandLogHeight(h => Math.max(100, Math.min(600, h - d)))} />
          <div style={{ height: commandLogHeight, flexShrink: 0 }}>
            <CommandLogPanel onClose={() => setShowCommandLog(false)} />
          </div>
        </>
      )}
      <StatusBar
        showCommandLog={showCommandLog}
        onToggleCommandLog={() => setShowCommandLog(s => !s)}
      />
      <ToastContainer />
      <ConfirmDialogHost />
      <DragDropHandler />
      <DeepLinkHandler />
      <Suspense fallback={null}><CloneModal open={showClone} onClose={() => setShowClone(false)} /></Suspense>
      <Suspense fallback={null}><InitModal open={showInit} onClose={() => setShowInit(false)} /></Suspense>
      <FindObjectDialog open={showFind} onClose={() => setShowFind(false)} />
      <Suspense fallback={null}>
        <GitFlowDialog open={showGitFlow} onClose={() => { setShowGitFlow(false); setGitFlowType(undefined); }} initialFlow={gitFlowType} />
        <InteractiveRebaseDialog open={showIRebase} onClose={() => setShowIRebase(false)} />
        <RepoInfoDialog open={showRepoInfo} onClose={() => setShowRepoInfo(false)} />
        <ApplyPatchModal open={showApplyPatch} onClose={() => setShowApplyPatch(false)} />
      </Suspense>
      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {refAction && <RefActionDialog action={refAction} onClose={() => setRefAction(null)} />}
      {showIndexEditor && (
        <Suspense fallback={null}>
          <IndexEditorDialog filePath={indexEditorFile} onClose={() => setShowIndexEditor(false)} />
        </Suspense>
      )}
      {showRepoSettings && (
        <Suspense fallback={null}>
          <RepoSettingsDialog onClose={() => setShowRepoSettings(false)} />
        </Suspense>
      )}
      {conflictFile && (
        <Suspense fallback={null}>
          <ConflictSolver filePath={conflictFile} onClose={() => setConflictFile(null)} />
        </Suspense>
      )}
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        triggers={{
          onFind: () => setShowFind(true),
          onGitFlow: () => setShowGitFlow(true),
          onInteractiveRebase: () => setShowIRebase(true),
          onRepoInfo: () => setShowRepoInfo(true),
          onApplyPatch: () => setShowApplyPatch(true),
          onClone: () => setShowClone(true),
          onInit: () => setShowInit(true),
          onGoDeepLink: handleGoDeepLink,
          onCopyDeepLink: handleCopyDeepLink,
        }}
      />
      {showRebasePanel && (
        <RebasePanel onClose={() => setDismissRebase(true)} />
      )}
      {showSequencerPanel && sequencerKind && (
        <SequencerPanel
          kind={sequencerKind}
          repoPath={currentRepo.path}
          onClose={() => setDismissSequencer(true)}
        />
      )}
      {showMergePanel && (
        <MergeInProgressPanel
          repoPath={currentRepo.path}
          onClose={() => setDismissMerge(true)}
        />
      )}
    </div>
  );
}
