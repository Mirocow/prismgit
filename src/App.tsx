import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { ToastContainer } from './components/ToastContainer';
import { WelcomeScreen } from './components/WelcomeScreen';
import { CloneModal } from './components/CloneModal';
import { InitModal } from './components/InitModal';
import { ChangesPage } from './pages/ChangesPage';
import { HistoryPage } from './pages/HistoryPage';
import { BranchesPage } from './pages/BranchesPage';
import { StashesPage } from './pages/StashesPage';
import { TagsPage } from './pages/TagsPage';
import { SubmodulesPage } from './pages/SubmodulesPage';
import { WorktreesPage } from './pages/WorktreesPage';
import { ReflogPage } from './pages/ReflogPage';
import { BlamePage } from './pages/BlamePage';
import { SettingsPage } from './pages/SettingsPage';
import { useRepositoryStore } from './stores/repositoryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useAuthStore } from './stores/authStore';
import { useToastStore } from './stores/toastStore';
import { useGitStore } from './stores/gitStore';

export default function App() {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const loadRepos = useRepositoryStore((s) => s.loadRepos);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loadAuth = useAuthStore((s) => s.loadAuthState);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [showClone, setShowClone] = useState(false);
  const [showInit, setShowInit] = useState(false);

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
    const handleClone = () => {
      setShowClone(true);
    };
    const handleInit = () => {
      setShowInit(true);
    };
    const handleCommit = () => {
      window.location.hash = '#/changes';
    };
    const handlePush = () => {
      const repo = useRepositoryStore.getState().currentRepo;
      if (!repo) return;
      useGitStore.getState().push(repo.path).then(() => {
        toast.success('Pushed successfully');
      }).catch((e) => {
        toast.error('Push failed', String(e));
      });
    };
    const handlePull = () => {
      const repo = useRepositoryStore.getState().currentRepo;
      if (!repo) return;
      useGitStore.getState().pull(repo.path).then(() => {
        toast.success('Pulled successfully');
      }).catch((e) => {
        toast.error('Pull failed', String(e));
      });
    };
    const handleFetch = () => {
      const repo = useRepositoryStore.getState().currentRepo;
      if (!repo) return;
      useGitStore.getState().fetch(repo.path).then(() => {
        toast.success('Fetched successfully');
      }).catch((e) => {
        toast.error('Fetch failed', String(e));
      });
    };
    const handleToggleTheme = () => {
      useSettingsStore.getState().toggleTheme();
    };

    const cleanups = [
      window.smartgit.events.on('menu:openRepository', (path) => handleOpenRepo(path as string)),
      window.smartgit.events.on('menu:cloneRepository', handleClone),
      window.smartgit.events.on('menu:initRepository', handleInit),
      window.smartgit.events.on('menu:commit', handleCommit),
      window.smartgit.events.on('menu:push', handlePush),
      window.smartgit.events.on('menu:pull', handlePull),
      window.smartgit.events.on('menu:fetch', handleFetch),
      window.smartgit.events.on('menu:toggleTheme', handleToggleTheme),
    ];
    return () => cleanups.forEach((fn) => fn && fn());
  }, [toast]);

  // Refresh status when repository changes
  useEffect(() => {
    if (currentRepo) {
      refreshStatus(currentRepo.path);
    }
  }, [currentRepo, refreshStatus]);

  if (!currentRepo) {
    return (
      <div className="flex flex-col h-screen">
        <Toolbar />
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
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={<Navigate to="/changes" replace />} />
            <Route path="/changes" element={<ChangesPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/blame" element={<BlamePage />} />
            <Route path="/branches" element={<BranchesPage />} />
            <Route path="/stashes" element={<StashesPage />} />
            <Route path="/tags" element={<TagsPage />} />
            <Route path="/submodules" element={<SubmodulesPage />} />
            <Route path="/worktrees" element={<WorktreesPage />} />
            <Route path="/reflog" element={<ReflogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <StatusBar />
      <ToastContainer />
      <CloneModal open={showClone} onClose={() => setShowClone(false)} />
      <InitModal open={showInit} onClose={() => setShowInit(false)} />
    </div>
  );
}
