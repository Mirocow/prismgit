import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, FileText, Loader, RefreshCw, GitCommit } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type BlameResult } from '../lib/api';
import { cn, shortHash, formatDate } from '../lib/utils';

export function BlamePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [filePath, setFilePath] = useState('');
  // Blame the ref selected elsewhere in the app (tag/branch from Toolbar or
  // Tags/Branches) when there is one — otherwise plain HEAD.
  const [ref, setRef] = useState(
    useSelectionStore.getState().selectedTag
    ?? useSelectionStore.getState().selectedBranch
    ?? 'HEAD'
  );
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [loading, setLoading] = useState(false);
  // Read global file selection — when user clicks "Blame this file" from Changes/History,
  // the file path is pre-filled here AND we auto-trigger the blame.
  const globalFilePath = useSelectionStore((s) => s.selectedFilePath);
  useEffect(() => {
    if (globalFilePath) {
      setFilePath(globalFilePath);
      // Auto-trigger blame after setting the path
      // Use a small delay to ensure state is updated
      setTimeout(() => {
        handleBlameRef.current?.(globalFilePath);
      }, 50);
    }
  }, [globalFilePath]);

  // Ref to avoid stale closure in handleBlame
  const handleBlameRef = useRef<(path?: string) => void>();
  handleBlameRef.current = (overridePath?: string) => {
    const path = overridePath || filePath;
    if (!path.trim()) {
      toast.warning('File path is required');
      return;
    }
    setLoading(true);
    api.git.blame(repo.path, path, ref || undefined)
      .then((result) => {
        setBlame(result);
        // The file being blamed becomes the global file selection — other
        // tools (Changes file list, History file filter, Diff) follow it.
        if (path.trim()) useSelectionStore.getState().selectFile(path.trim());
      })
      .catch((e) => { toast.error('Blame failed', String(e)); setBlame(null); })
      .finally(() => setLoading(false));
  };

  const handleBlame = useCallback(() => {
    handleBlameRef.current?.();
  }, []);

  // Group blame lines by commit hash for color visualization
  const colorMap = useMemo(() => {
    if (!blame) return new Map<string, string>();
    const uniqueHashes = Array.from(new Set(blame.lines.map((l) => l.hash)));
    const colors = [
      'rgba(14, 99, 156, 0.15)',
      'rgba(115, 201, 145, 0.15)',
      'rgba(226, 192, 141, 0.15)',
      'rgba(199, 78, 57, 0.15)',
      'rgba(105, 164, 255, 0.15)',
      'rgba(170, 102, 200, 0.15)',
      'rgba(255, 167, 38, 0.15)',
      'rgba(0, 188, 212, 0.15)',
    ];
    const map = new Map<string, string>();
    uniqueHashes.forEach((h, i) => {
      map.set(h, colors[i % colors.length]);
    });
    return map;
  }, [blame]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <FileText size={14} />
        <span className="text-sm font-medium">Blame</span>
      </div>

      <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary">
        <input
          type="text"
          className="flex-1 text-sm font-mono"
          placeholder="path/to/file.txt"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleBlame()}
        />
        <input
          type="text"
          className="w-32 text-sm font-mono"
          placeholder="HEAD"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <button
          className="btn btn-primary text-xs"
          onClick={handleBlame}
          disabled={loading || !filePath.trim()}
        >
          {loading ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
          Blame
        </button>
      </div>

      <div className="flex-1 overflow-auto bg-bg-primary">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
            <Loader size={14} className="animate-spin" />
            Loading blame information...
          </div>
        ) : !blame ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <FileText size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No blame information</div>
            <div className="text-xs mt-1">Enter a file path and click Blame to see line-by-line authorship</div>
          </div>
        ) : (
          <div className="font-mono text-xs">
            {blame.lines.map((line, idx) => (
              <div
                key={idx}
                className="flex items-start hover:bg-bg-hover border-b border-border-subtle"
                style={{ backgroundColor: colorMap.get(line.hash) || 'transparent' }}
              >
                <div className="w-32 flex-shrink-0 px-2 py-1 border-r border-border-subtle text-text-tertiary truncate">
                  <div className="flex items-center gap-1">
                    <GitCommit size={9} />
                    <CommitHashLink hash={line.hash} />
                  </div>
                  <div className="text-2xs mt-0.5">{line.author || 'unknown'}</div>
                </div>
                <div className="w-12 flex-shrink-0 px-2 py-1 text-right text-text-tertiary border-r border-border-subtle">
                  {line.finalLineNumber}
                </div>
                <pre
                  className="flex-1 px-2 py-1 whitespace-pre-wrap break-all text-text-primary"
                  style={{ fontFamily: 'inherit' }}
                >
                  {line.content || ' '}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {blame && blame.lines.length > 0 && (
        <div className="border-t border-border-default bg-bg-secondary p-2 text-xs text-text-tertiary">
          {blame.lines.length} lines · {new Set(blame.lines.map((l) => l.hash)).size} unique commits
        </div>
      )}
    </div>
  );
}
