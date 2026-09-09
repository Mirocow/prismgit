import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';

export function StatusBar() {
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const status = useGitStore((s) => s.status);
  const lastRefresh = useGitStore((s) => s.lastRefresh);

  if (!currentRepo) {
    return (
      <footer className="h-6 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
        <span>Ready</span>
        <span>SmartGit Electron v1.0</span>
      </footer>
    );
  }

  const changed = status?.files.length ?? 0;
  const staged = status?.staged.length ?? 0;

  return (
    <footer className="h-6 bg-bg-tertiary border-t border-border-default flex items-center justify-between px-3 text-2xs text-text-tertiary flex-shrink-0">
      <div className="flex items-center gap-4">
        <span>
          {staged > 0 ? `${staged} staged` : 'No staged changes'}
          {changed > 0 && ` · ${changed} changed`}
        </span>
        {status?.ahead ? <span className="text-status-added">↑{status.ahead}</span> : null}
        {status?.behind ? <span className="text-status-modified">↓{status.behind}</span> : null}
      </div>
      <div className="flex items-center gap-4">
        {status?.current && <span>{status.current}</span>}
        {lastRefresh > 0 && (
          <span>updated {new Date(lastRefresh).toLocaleTimeString()}</span>
        )}
      </div>
    </footer>
  );
}
