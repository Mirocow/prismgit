import { useEffect, useState, Suspense, lazy, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { CloneModal } from './components/CloneModal';
import { InitModal } from './components/InitModal';
import { RebasePanel } from './components/RebasePanel';
import { FindObjectDialog } from './components/FindObjectDialog';
import { GitFlowDialog } from './components/GitFlowDialog';
import { InteractiveRebaseDialog } from './components/InteractiveRebaseDialog';
import { ConflictSolver } from './components/ConflictSolver';
import { useRepositoryStore } from './stores/repositoryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useToastStore } from './stores/toastStore';
import { useGitStore } from './stores/gitStore';

// Lazy-load pages for smaller initial bundle
const ChangesPage = lazy(() => import('./pages/ChangesPage').then(m => ({ default: m.ChangesPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then(m => ({ default: m.HistoryPage })));
const BlamePage = lazy(() => import('./pages/BlamePage').then(m => ({ default: m.BlamePage })));
const InvestigatePage = lazy(() => import('./pages/InvestigatePage').then(m => ({ default: m.InvestigatePage })));
const JournalPage = lazy(() => import('./pages/JournalPage').then(m => ({ default: m.JournalPage })));
const GitFlowPage = lazy(() => import('./pages/GitFlowPage').then(m => ({ default: m.GitFlowPage })));
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
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadAuth = useAuthStore((s) => s.loadAuthState);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const status = useGitStore((s) => s.status);
  const toast = useToastStore();
  const [showClone, setShowClone] = useState(false);
  const [showInit, setShowInit] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showGitFlow, setShowGitFlow] = useState(false);
  const [showIRebase, setShowIRebase] = useState(false);
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [dismissRebase, setDismissRebase] = useState(false);

  useEffect(() => {
    loadRepos();
    loadSettings();
    loadAuth();
  }, [loadRepos, loadSettings, loadAuth]);

  // Listen for menu events
  useEffect(() => {
    const handleOpenRepo = (path: string) => {
      useRepositoryStore.getState().openRepository(path).catch((e) => {
        toast.error('Failed to open repository', String(e));
      });
    };
    const handleClone = () => setShowClone(true);
    const handleInit = () => setShowInit(true);
    const handleCommit = () => {
      window.location.hash = '#/changes';
    };
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
    ];
    return () => cleanups.forEach((fn) => fn && fn());
  }, [toast]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      // Ctrl+F: Find object
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !isInInput) {
        e.preventDefault();
        setShowFind(true);
      }
      // Ctrl+Shift+T: Toggle theme
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        useSettingsStore.getState().toggleTheme();
      }
      // Ctrl+Shift+G: Git-Flow dialog
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'G' && !isInInput) {
        e.preventDefault();
        setShowGitFlow(true);
      }
      // Ctrl+Shift+R: Interactive Rebase
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R' && !isInInput) {
        e.preventDefault();
        setShowIRebase(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Auto-open Conflict Solver when conflicts appear
  useEffect(() => {
    if (status?.conflicted && status.conflicted.length > 0 && !conflictFile) {
      // Don't auto-open, but show a hint
      toast.warning(
        `${status.conflicted.length} merge conflicts`,
        'Use the Changes view to resolve them — click a conflicted file to open the Conflict Solver'
      );
    }
  }, [status?.conflicted, conflictFile, toast]);

  // Refresh status when repository changes
  useEffect(() => {
    if (currentRepo) {
      refreshStatus(currentRepo.path);
      setDismissRebase(false);
    }
  }, [currentRepo, refreshStatus]);

  // Auto-refresh status every 30s when repo is open
  useEffect(() => {
    if (!currentRepo) return;
    const interval = setInterval(() => {
      refreshStatus(currentRepo.path);
    }, 30000);
    return () => clearInterval(interval);
  }, [currentRepo, refreshStatus]);

  const showRebasePanel = currentRepo && status?.isRebasing && !dismissRebase;

  const handleFind = useCallback(() => setShowFind(true), []);

  if (!currentRepo) {
    return (
      <div className="flex flex-col h-screen">
        <Toolbar
          onFind={handleFind}
          onGitFlow={() => setShowGitFlow(true)}
          onInteractiveRebase={() => setShowIRebase(true)}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex-1 overflow-auto">
            <WelcomeScreen />
          </div>
        </div>
        <StatusBar />
        <ToastContainer />
        <CloneModal open={showClone} onClose={() => setShowClone(false)} />
        <InitModal open={showInit} onClose={() => setShowInit(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <Toolbar
        onFind={handleFind}
        onGitFlow={() => setShowGitFlow(true)}
        onInteractiveRebase={() => setShowIRebase(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/changes" replace />} />
              <Route path="/changes" element={<ChangesPage onResolveConflict={(f) => setConflictFile(f)} />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/investigate" element={<InvestigatePage />} />
              <Route path="/blame" element={<BlamePage />} />
              <Route path="/journal" element={<JournalPage />} />
              <Route path="/gitflow" element={<GitFlowPage />} />
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
      <StatusBar />
      <ToastContainer />
      <CloneModal open={showClone} onClose={() => setShowClone(false)} />
      <InitModal open={showInit} onClose={() => setShowInit(false)} />
      <FindObjectDialog open={showFind} onClose={() => setShowFind(false)} />
      <GitFlowDialog open={showGitFlow} onClose={() => setShowGitFlow(false)} />
      <InteractiveRebaseDialog open={showIRebase} onClose={() => setShowIRebase(false)} />
      {conflictFile && (
        <ConflictSolver filePath={conflictFile} onClose={() => setConflictFile(null)} />
      )}
      {showRebasePanel && (
        <RebasePanel onClose={() => setDismissRebase(true)} />
      )}
    </div>
  );
}
