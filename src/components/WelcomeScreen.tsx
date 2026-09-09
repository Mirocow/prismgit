import { Folder, Plus, Github, BookOpen } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';

export function WelcomeScreen() {
  const openRepo = useRepositoryStore((s) => s.openRepositoryPicker);

  return (
    <div className="h-full flex items-center justify-center p-8 bg-bg-primary">
      <div className="max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center shadow-lg">
            <Plus size={40} className="text-white" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-text-primary mb-2">SmartGit Electron</h1>
        <p className="text-sm text-text-secondary mb-8">
          A modern, cross-platform Git client built on Electron. Open a repository to start managing branches, commits, and history.
        </p>

        <div className="flex flex-col gap-3 max-w-xs mx-auto">
          <button className="btn btn-primary justify-center" onClick={openRepo}>
            <Folder size={16} />
            Open Repository
          </button>
          <button
            className="btn btn-secondary justify-center"
            onClick={() => (window.location.hash = '#/clone')}
          >
            <Github size={16} />
            Clone from GitHub
          </button>
        </div>

        <div className="mt-12 pt-8 border-t border-border-default">
          <div className="flex items-center justify-center gap-2 text-xs text-text-tertiary">
            <BookOpen size={12} />
            <span>Press Ctrl+O to open, Ctrl+Shift+O to clone</span>
          </div>
        </div>
      </div>
    </div>
  );
}
