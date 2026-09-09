import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, FileText, Loader, RefreshCw, GitCommit } from 'lucide-react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type BlameResult } from '../lib/api';
import { cn, shortHash, formatDate } from '../lib/utils';

export function BlamePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [filePath, setFilePath] = useState('');
  const [ref, setRef] = useState('HEAD');
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBlame = useCallback(async () => {
    if (!filePath.trim()) {
      toast.warning('File path is required');
      return;
    }
    setLoading(true);
    try {
      const result = await api.git.blame(repo.path, filePath, ref || undefined);
      setBlame(result);
    } catch (e) {
      toast.error('Blame failed', String(e));
      setBlame(null);
    } finally {
      setLoading(false);
    }
  }, [repo.path, filePath, ref, toast]);

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
                    <span className="text-accent">{shortHash(line.hash)}</span>
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
