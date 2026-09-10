import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, FileText, Loader, RefreshCw, GitCommit, History } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type BlameResult } from '../lib/api';
import { shortHash } from '../lib/utils';

export function BlamePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [filePath, setFilePath] = useState('');
  const globalBranch = useSelectionStore((s) => s.selectedBranch);
  const globalTag = useSelectionStore((s) => s.selectedTag);
  const [ref, setRef] = useState(globalTag ?? globalBranch ?? 'HEAD');

  useEffect(() => {
    const newRef = globalTag ?? globalBranch ?? 'HEAD';
    setRef(newRef);
  }, [globalTag, globalBranch]);

  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [loading, setLoading] = useState(false);
  const globalFilePath = useSelectionStore((s) => s.selectedFilePath);

  const handleBlameRef = useRef<(path?: string, refOverride?: string) => void>();
  handleBlameRef.current = (overridePath?: string, refOverride?: string) => {
    const path = overridePath || filePath;
    const effectiveRef = refOverride || ref;
    if (!path.trim()) {
      toast.warning('File path is required');
      return;
    }
    setLoading(true);
    api.git.blame(repo.path, path, effectiveRef || undefined)
      .then((result) => {
        setBlame(result);
        if (path.trim()) useSelectionStore.getState().selectFile(path.trim());
      })
      .catch((e) => { toast.error('Blame failed', String(e)); setBlame(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (globalFilePath) {
      setFilePath(globalFilePath);
      const timer = setTimeout(() => {
        handleBlameRef.current?.(globalFilePath);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [globalFilePath]);

  const handleBlame = useCallback(() => {
    handleBlameRef.current?.();
  }, []);

  // Click a commit hash → navigate to History with that commit + file filter
  const handleCommitClick = useCallback((hash: string) => {
    useSelectionStore.getState().selectCommit(hash);
    if (filePath.trim()) {
      useSelectionStore.getState().setPathFilter(filePath.trim());
    }
    window.location.hash = '#/history';
  }, [filePath]);

  const colorMap = useMemo(() => {
    if (!blame) return new Map<string, string>();
    const uniqueHashes = Array.from(new Set(blame.lines.map((l) => l.hash)));
    const colors = [
      'rgba(14, 99, 156, 0.15)', 'rgba(115, 201, 145, 0.15)',
      'rgba(226, 192, 141, 0.15)', 'rgba(199, 78, 57, 0.15)',
      'rgba(105, 164, 255, 0.15)', 'rgba(170, 102, 200, 0.15)',
      'rgba(255, 167, 38, 0.15)', 'rgba(0, 188, 212, 0.15)',
    ];
    const map = new Map<string, string>();
    uniqueHashes.forEach((h, i) => { map.set(h, colors[i % colors.length]); });
    return map;
  }, [blame]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <FileText size={14} />
        <span className="text-sm font-medium">Blame</span>
        {filePath && (
          <span className="text-2xs text-text-tertiary ml-2 truncate">
            {filePath} @ {ref || 'HEAD'}
          </span>
        )}
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
            <div className="text-xs mt-1">
              Enter a file path and click Blame, or right-click a file in
              Changes and select "Blame this file".
            </div>
            <div className="text-xs mt-1 text-text-tertiary">
              Click a commit hash in the results to view it in History.
            </div>
          </div>
        ) : (
          <div className="font-mono text-xs">
            {blame.lines.map((line, idx) => (
              <div
                key={idx}
                className="flex items-start hover:bg-bg-hover border-b border-border-subtle group"
                style={{ backgroundColor: colorMap.get(line.hash) || 'transparent' }}
              >
                <div className="w-36 flex-shrink-0 px-2 py-1 border-r border-border-subtle text-text-tertiary truncate">
                  <div className="flex items-center gap-1">
                    <GitCommit size={9} />
                    <button
                      className="text-accent hover:underline cursor-pointer font-mono"
                      title={`View commit ${shortHash(line.hash)} in History (with file filter: ${filePath})`}
                      onClick={() => handleCommitClick(line.hash)}
                    >
                      {shortHash(line.hash)}
                    </button>
                  </div>
                  <div className="text-2xs mt-0.5 truncate">{line.author || 'unknown'}</div>
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
                {/* Hover button: jump to this commit in History */}
                <button
                  className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0 m-1 transition-opacity"
                  title="View this commit in History (with file filter)"
                  onClick={() => handleCommitClick(line.hash)}
                >
                  <History size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {blame && blame.lines.length > 0 && (
        <div className="border-t border-border-default bg-bg-secondary p-2 text-xs text-text-tertiary">
          {blame.lines.length} lines · {new Set(blame.lines.map((l) => l.hash)).size} unique commits
          {filePath && <span className="ml-2">· file: <code className="mono">{filePath}</code></span>}
        </div>
      )}
    </div>
  );
}
