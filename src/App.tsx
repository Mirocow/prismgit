import { useEffect, useState, Suspense, lazy, useCallback, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Toolbar, GitToolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmDialogHost } from './components/ConfirmDialog';
import { WelcomeScreen } from './components/WelcomeScreen';
import { CloneModal } from './components/CloneModal';
import { InitModal } from './components/InitModal';
import { RebasePanel } from './components/RebasePanel';
import { FindObjectDialog } from './components/FindObjectDialog';
import { GitFlowDialog } from './components/GitFlowDialog';
import { InteractiveRebaseDialog } from './components/InteractiveRebaseDialog';
import { ConflictSolver } from './components/ConflictSolver';
import { RepoInfoDialog } from './components/RepoInfoDialog';
import { SequencerPanel } from './components/SequencerPanel';
import { ApplyPatchModal } from './components/ApplyPatchModal';
import { CommandPalette } from './components/CommandPalette';
import { KeyboardShortcutsOverlay } from './components/KeyboardShortcutsOverlay';
import { CommandLogPanel } from './components/CommandLogPanel';
import { DragDropHandler } from './components/DragDropHandler';
import { HelpBanner } from './components/HelpBanner';
import { NAV_SHORTCUTS } from './components/navItems';
import { useWindowStyleStore } from './components/WindowStyleSwitcher';
import { useRepositoryStore } from './stores/repositoryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useToastStore } from './stores/toastStore';
import { useGitStore } from './stores/gitStore';
import { useSelectionStore } from './stores/selectionStore';
import { useBackgroundFetch } from './hooks/useBackgroundFetch';
import { api } from './lib/api';
import { loadProjectPrefs, saveProjectPrefs } from './lib/projectPrefs';

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
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));

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

  // SmartGit-style background "Poll or Fetch" for remotes marked in Configure remote properties
  useBackgroundFetch();

  useEffect(() => {
    loadRepos();
    loadMetadata();
    loadSettings();
    loadAuth();
  }, [loadRepos, loadMetadata, loadSettings, loadAuth]);

  // Listen for repo-closed events to clear global selections and free memory
  useEffect(() => {
    const handler = () => {
      useSelectionStore.getState().clearAll();
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
  useEffect(() => {
    if (!repoPath) return;
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
      useGitStore.getState().pull(repo.path)
        .then(() => toast.success('Pulled successfully'))
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

    const cleanups = [
      window.smartgit.events.on('menu:openRepository', (path) => handleOpenRepo(path as string)),
      window.smartgit.events.on('menu:cloneRepository', handleClone),
      window.smartgit.events.on('menu:initRepository', handleInit),
      window.smartgit.events.on('menu:commit', handleCommit),
      window.smartgit.events.on('menu:push', handlePush),
      window.smartgit.events.on('menu:pull', handlePull),
      window.smartgit.events.on('menu:fetch', handleFetch),
      window.smartgit.events.on('menu:toggleTheme', handleToggleTheme),
      window.smartgit.events.on('menu:gitFlow', handleGitFlow),
      window.smartgit.events.on('menu:interactiveRebase', handleIRebase),
      window.smartgit.events.on('menu:showShortcuts', handleShowShortcuts),
      window.smartgit.events.on('menu:commandLog', handleToggleCommandLog),
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
      if ((e.ctrlKey || e.metaKey) && (e.key === '?' || e.key === '/')) {
        e.preventDefault();
        setShowShortcuts(s => !s);
      }
      // Ctrl+Shift+U — toggle Output panel (command log)
      // (J was taken by Pull, O by Clone — U is "Output" mnemonic, like VS Code uses Ctrl+Shift+U)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'U' && !isInInput) {
        e.preventDefault();
        setShowCommandLog(s => !s);
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
      // Window style shortcuts: Ctrl+Shift+1/2/3
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !isInInput) {
        if (e.key === '1') { e.preventDefault(); setWindowStyle('standard'); }
        if (e.key === '2') { e.preventDefault(); setWindowStyle('log'); }
        if (e.key === '3') { e.preventDefault(); setWindowStyle('working-tree'); }
      }
      // Git operation shortcuts (promised by the shortcuts overlay) —
      // push / pull / fetch / stage all, repo required
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !isInInput) {
        const repo = useRepositoryStore.getState().currentRepo;
        const git = useGitStore.getState();
        if (e.key === 'P' && repo) {
          e.preventDefault();
          git.push(repo.path).then(() => toast.success('Pushed successfully')).catch((err) => toast.error('Push failed', String(err)));
        } else if (e.key === 'L' && repo) {
          e.preventDefault();
          git.pull(repo.path).then(() => toast.success('Pulled successfully')).catch((err) => toast.error('Pull failed', String(err)));
        } else if (e.key === 'F' && repo) {
          e.preventDefault();
          git.fetch(repo.path).then(() => toast.success('Fetched successfully')).catch((err) => toast.error('Fetch failed', String(err)));
        } else if (e.key === 'A' && repo) {
          e.preventDefault();
          git.stageAll(repo.path).then(() => toast.success('All changes staged')).catch((err) => toast.error('Stage failed', String(err)));
        } else if (e.key === 'O') {
          e.preventDefault();
          setShowClone(true);
        }
      }
      // Ctrl+O — open repository picker
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'o' && !isInInput) {
        e.preventDefault();
        useRepositoryStore.getState().openRepositoryPicker();
      }
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
  }, [setWindowStyle, navigate]);

  // Shortcuts dialog can be opened from the Command Palette via this event
  useEffect(() => {
    const handler = () => setShowShortcuts(true);
    window.addEventListener('prismgit:show-shortcuts', handler);
    return () => window.removeEventListener('prismgit:show-shortcuts', handler);
  }, []);

  // File watcher: start/stop when repo changes + auto-refresh on changes
  // Use a ref to track in-flight refresh and debounce to avoid loops.
  // The debounce is 2s (not 1s) to reduce git status spawn frequency —
  // each status call spawns a git process which uses ~20-50MB of RAM.
  // At 1s debounce, saving files rapidly can spawn 5+ status processes
  // in quick succession. At 2s, they coalesce into 1.
  const refreshInFlight = useRef(false);
  const lastRefreshTime = useRef(0);

  useEffect(() => {
    if (!currentRepo) return;
    api.watcher.start(currentRepo.path);
    const cleanup = api.watcher.onChanged((data) => {
      // Skip if a refresh is already in-flight
      if (refreshInFlight.current) return;
      // Debounce: at least 2 seconds between watcher-triggered refreshes
      const now = Date.now();
      if (now - lastRefreshTime.current < 2000) return;
      lastRefreshTime.current = now;
      refreshInFlight.current = true;
      refreshStatus(currentRepo.path).finally(() => {
        refreshInFlight.current = false;
      });
    });
    return () => {
      api.watcher.stop(currentRepo.path);
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
      // Always navigate to Changes view when repo opens — this is the
      // primary landing page. Even if the user was on Settings or another
      // page, opening a repo should show Changes first.
      navigate('/changes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo?.path]);

  const showRebasePanel = currentRepo && status?.isRebasing && !dismissRebase;

  const handleFind = useCallback(() => setShowFind(true), []);

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
        <CloneModal open={showClone} onClose={() => setShowClone(false)} />
        <InitModal open={showInit} onClose={() => setShowInit(false)} />
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
              {/* Annotate removed — merged into History via file filter */}
              <Route path="/annotate" element={<Navigate to="/history" replace />} />
              {/* Investigate renamed to Search */}
              <Route path="/investigate" element={<Navigate to="/search" replace />} />
              <Route path="/search" element={<InvestigatePage />} />
              <Route path="/blame" element={<BlamePage />} />
              {/* Journal removed — merged into Reflog */}
              <Route path="/journal" element={<Navigate to="/reflog" replace />} />
              <Route path="/gitflow" element={<GitFlowPage />} />
              <Route path="/pulls" element={<PullRequestsPage />} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/lfs" element={<LfsPage />} />
              <Route path="/branches" element={<BranchesPage />} />
              <Route path="/stashes" element={<StashesPage />} />
              <Route path="/tags" element={<TagsPage />} />
              <Route path="/submodules" element={<SubmodulesPage />} />
              <Route path="/worktrees" element={<WorktreesPage />} />
              <Route path="/reflog" element={<ReflogPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      {showCommandLog && (
        <CommandLogPanel onClose={() => setShowCommandLog(false)} />
      )}
      <StatusBar
        showCommandLog={showCommandLog}
        onToggleCommandLog={() => setShowCommandLog(s => !s)}
      />
      <ToastContainer />
      <ConfirmDialogHost />
      <DragDropHandler />
      <CloneModal open={showClone} onClose={() => setShowClone(false)} />
      <InitModal open={showInit} onClose={() => setShowInit(false)} />
      <FindObjectDialog open={showFind} onClose={() => setShowFind(false)} />
      <GitFlowDialog open={showGitFlow} onClose={() => setShowGitFlow(false)} />
      <InteractiveRebaseDialog open={showIRebase} onClose={() => setShowIRebase(false)} />
      <RepoInfoDialog open={showRepoInfo} onClose={() => setShowRepoInfo(false)} />
      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {conflictFile && (
        <ConflictSolver filePath={conflictFile} onClose={() => setConflictFile(null)} />
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
        }}
      />
      {showRebasePanel && (
        <RebasePanel onClose={() => setDismissRebase(true)} />
      )}
    </div>
  );
}
