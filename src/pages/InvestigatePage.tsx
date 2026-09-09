import { useState, useEffect, useCallback } from 'react';
import { Search, FileText, Loader, GitCommit, CornerDownRight, ExternalLink } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type LogEntry } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';

export function InvestigatePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [filePath, setFilePath] = useState('');
  const [followRenames, setFollowRenames] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [searched, setSearched] = useState(false);

  const handleInvestigate = useCallback(async () => {
    if (!filePath.trim()) {
      toast.warning('File path is required');
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const result = await api.git.log(repo.path, {
        maxCount: 100,
        file: filePath,
        follow: followRenames,
        all: false,
      });
      setEntries(result);
      setSelected(result[0] || null);
    } catch (e) {
      toast.error('Investigate failed', String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [repo.path, filePath, followRenames, toast]);

  const handleOpenInBrowser = async (entry: LogEntry) => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        const url = `${info.webUrl}/commit/${entry.hash}`;
        api.app.openExternal(url);
      } else {
        toast.info('Repository has no remote URL');
      }
    } catch (e) {
      toast.error('Failed to open in browser', String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <FileText size={14} />
        <span className="text-sm font-medium">Investigate</span>
        <span className="text-2xs text-text-tertiary">File history with rename following</span>
      </div>

      <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary">
        <input
          type="text"
          className="flex-1 text-sm mono"
          placeholder="path/to/file.txt"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleInvestigate()}
        />
        <label className="flex items-center gap-1 text-xs cursor-pointer text-text-secondary">
          <input
            type="checkbox"
            checked={followRenames}
            onChange={(e) => setFollowRenames(e.target.checked)}
          />
          Follow renames
        </label>
        <button
          className="btn btn-primary text-xs"
          onClick={handleInvestigate}
          disabled={loading || !filePath.trim()}
        >
          {loading ? <Loader size={12} className="spin" /> : <Search size={12} />}
          Investigate
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* History list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
              <Loader size={14} className="spin" />
              Investigating file history...
            </div>
          ) : !searched ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
              <FileText size={32} className="mb-2 opacity-50" />
              <div className="text-sm">No file investigated</div>
              <div className="text-xs mt-1">Enter a file path to see its history</div>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
              <FileText size={32} className="mb-2 opacity-50" />
              <div className="text-sm">No commits found for this file</div>
            </div>
          ) : (
            entries.map((entry, idx) => (
              <div
                key={entry.hash + idx}
                className={cn(
                  'group flex items-start gap-3 px-3 py-2 cursor-pointer border-b border-border-subtle',
                  selected?.hash === entry.hash ? 'bg-bg-selected' : 'hover:bg-bg-hover'
                )}
                onClick={() => setSelected(entry)}
              >
                <GitCommit size={14} className="text-text-tertiary mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-primary truncate">{entry.subject}</div>
                  <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                    <span className="font-medium text-text-secondary">{entry.author.name}</span>
                    <span>·</span>
                    <span>{formatDate(entry.author.date)}</span>
                    {entry.refs.length > 0 && (
                      <>
                        <span>·</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {entry.refs.slice(0, 3).map((ref, i) => (
                            <span key={i} className="badge badge-renamed">{ref.replace(/^tag:\s*/, '')}</span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <code className="text-xs font-mono text-text-tertiary flex-shrink-0">
                  {shortHash(entry.hash)}
                </code>
              </div>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-80 border-l border-border-default bg-bg-secondary overflow-y-auto">
            <div className="p-4">
              <div className="text-sm font-medium mb-2">{selected.subject}</div>
              <div className="flex items-center gap-2 mb-4">
                <code className="text-xs font-mono px-2 py-1 bg-bg-tertiary rounded">
                  {selected.hash}
                </code>
                <button
                  className="icon-btn"
                  title="Open in browser"
                  onClick={() => handleOpenInBrowser(selected)}
                >
                  <ExternalLink size={12} />
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs uppercase text-text-tertiary mb-1">Author</div>
                  <div className="text-text-primary">{selected.author.name}</div>
                  <div className="text-xs text-text-secondary">{selected.author.email}</div>
                  <div className="text-xs text-text-tertiary">
                    {new Date(selected.author.date).toLocaleString()}
                  </div>
                </div>
                {selected.parents.length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-text-tertiary mb-1">Parents</div>
                    {selected.parents.map((p, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <CornerDownRight size={11} className="text-text-tertiary" />
                        <code className="text-xs font-mono text-accent">{shortHash(p)}</code>
                      </div>
                    ))}
                  </div>
                )}
                {selected.body && (
                  <div>
                    <div className="text-xs uppercase text-text-tertiary mb-1">Message</div>
                    <pre className="text-xs font-mono whitespace-pre-wrap text-text-secondary bg-bg-tertiary p-2 rounded">
                      {selected.body}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
