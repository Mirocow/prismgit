import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Loader, GitCommit, CornerDownRight, ExternalLink, Copy, History } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type LogEntry } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';

type Tab = 'commits' | 'history' | 'grep' | 'revparse';

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

function parseGrepOutput(raw: string): GrepMatch[] {
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const first = l.indexOf(':');
      if (first === -1) return null;
      const second = l.indexOf(':', first + 1);
      if (second === -1) return null;
      const file = l.slice(0, first);
      const line = parseInt(l.slice(first + 1, second), 10);
      if (Number.isNaN(line)) return null;
      return { file, line, text: l.slice(second + 1) };
    })
    .filter((m): m is GrepMatch => m !== null);
}

export function InvestigatePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('commits');

  // === Commit message search tab (git log --grep) ===
  const [commitQuery, setCommitQuery] = useState('');
  const [commitIgnoreCase, setCommitIgnoreCase] = useState(true);
  const [commitEntries, setCommitEntries] = useState<LogEntry[]>([]);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitSearched, setCommitSearched] = useState(false);

  // === File history tab ===
  const [filePath, setFilePath] = useState('');
  const [followRenames, setFollowRenames] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [searched, setSearched] = useState(false);

  // === Content search (git grep) tab ===
  const [grepPattern, setGrepPattern] = useState('');
  const [grepIgnoreCase, setGrepIgnoreCase] = useState(false);
  const [grepWord, setGrepWord] = useState(false);
  const [grepUntracked, setGrepUntracked] = useState(false);
  const [grepMatches, setGrepMatches] = useState<GrepMatch[]>([]);
  const [grepLoading, setGrepLoading] = useState(false);
  const [grepSearched, setGrepSearched] = useState(false);

  // === Rev-parse tab ===
  const [revInput, setRevInput] = useState('HEAD');
  const [revResult, setRevResult] = useState<string | null>(null);
  const [revError, setRevError] = useState<string | null>(null);
  const [revBusy, setRevBusy] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  // Prefill the File History path from the file selected elsewhere in the app
  // (Changes / History) — makes the tab instantly usable without typing paths.
  useEffect(() => {
    const sel = useSelectionStore.getState().selectedFilePath;
    if (sel) setFilePath(sel);
  }, []);

  const handleCommitSearch = useCallback(async () => {
    if (!commitQuery.trim()) {
      toast.warning('Search pattern is required');
      return;
    }
    setCommitLoading(true);
    setCommitSearched(true);
    try {
      const result = await api.git.log(repo.path, {
        maxCount: 200,
        all: true,
        grep: commitQuery,
        grepIgnoreCase: commitIgnoreCase,
      });
      setCommitEntries(result);
    } catch (e) {
      toast.error('Commit search failed', String(e));
      setCommitEntries([]);
    } finally {
      setCommitLoading(false);
    }
  }, [repo.path, commitQuery, commitIgnoreCase, toast]);

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

  const handleGrep = useCallback(async () => {
    if (!grepPattern.trim()) {
      toast.warning('Search pattern is required');
      return;
    }
    setGrepLoading(true);
    setGrepSearched(true);
    try {
      const options = ['--line-number'];
      if (grepIgnoreCase) options.push('-i');
      if (grepWord) options.push('-w');
      if (grepUntracked) options.push('--untracked');
      const raw = await api.git.grep(repo.path, grepPattern, options);
      setGrepMatches(parseGrepOutput(raw));
    } catch (e) {
      // git grep exits with code 1 when there are no matches — treat as empty result
      if (String(e).includes('exit code 1') || String(e).includes('no matches')) {
        setGrepMatches([]);
      } else {
        toast.error('Grep failed', String(e));
        setGrepMatches([]);
      }
    } finally {
      setGrepLoading(false);
    }
  }, [repo.path, grepPattern, grepIgnoreCase, grepWord, grepUntracked, toast]);

  const handleRevParse = useCallback(async () => {
    setRevBusy(true);
    setRevError(null);
    setRevResult(null);
    try {
      const args = revInput.trim().split(/\s+/).filter(Boolean);
      if (args.length === 0) return;
      const result = await api.git.revParseArgs(repo.path, args);
      setRevResult(result.trim());
    } catch (e) {
      setRevError(String(e));
    } finally {
      setRevBusy(false);
    }
  }, [repo.path, revInput]);

  // Load current branch when the rev-parse tab opens
  const handleTabChange = useCallback(async (t: Tab) => {
    setTab(t);
    if (t === 'revparse' && currentBranch === null) {
      try {
        setCurrentBranch(await api.git.currentBranch(repo.path));
      } catch {
        setCurrentBranch(null);
      }
    }
  }, [repo.path, currentBranch]);

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

  const TABS: { id: Tab; label: string; title: string }[] = [
    { id: 'commits', label: 'Commits', title: 'Search commit messages across ALL branches (git log --grep --all)' },
    { id: 'history', label: 'File History', title: 'Commit history of a single file (with rename following)' },
    { id: 'grep', label: 'Content Search', title: 'git grep — search tracked file contents' },
    { id: 'revparse', label: 'Rev-Parse', title: 'Evaluate git rev-parse expressions (HEAD~3, main@{yesterday}, v1.0^{commit}, ...)' },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <Search size={14} />
        <span className="text-sm font-medium">Investigate</span>
        <div className="flex items-center gap-1 ml-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                tab === t.id
                  ? 'bg-accent-muted text-accent font-medium'
                  : 'text-text-secondary hover:bg-bg-hover'
              )}
              title={t.title}
              onClick={() => handleTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ================= Commit message search tab ================= */}
      {tab === 'commits' && (
        <>
          <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary">
            <input
              type="text"
              className="flex-1 text-sm"
              placeholder="Search commit messages (regex supported) — e.g. 'fix: stash', 'rebase'"
              value={commitQuery}
              autoFocus
              onChange={(e) => setCommitQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCommitSearch()}
            />
            <label className="flex items-center gap-1 text-xs cursor-pointer text-text-secondary" title="-i">
              <input type="checkbox" checked={commitIgnoreCase} onChange={(e) => setCommitIgnoreCase(e.target.checked)} />
              Ignore case
            </label>
            <button
              className="btn btn-primary text-xs"
              onClick={handleCommitSearch}
              disabled={commitLoading || !commitQuery.trim()}
            >
              {commitLoading ? <Loader size={12} className="spin" /> : <Search size={12} />}
              Search
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {commitLoading ? (
              <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
                <Loader size={14} className="spin" />
                Searching commit messages...
              </div>
            ) : !commitSearched ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <GitCommit size={32} className="mb-2 opacity-50" />
                <div className="text-sm">No commit search yet</div>
                <div className="text-xs mt-1">Searches ALL branches — type a pattern above</div>
              </div>
            ) : commitEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <GitCommit size={32} className="mb-2 opacity-50" />
                <div className="text-sm">No commits match “{commitQuery}”</div>
              </div>
            ) : (
              <>
                <div className="px-3 py-1.5 text-2xs text-text-tertiary border-b border-border-default bg-bg-secondary">
                  {commitEntries.length} commit{commitEntries.length === 1 ? '' : 's'} match “{commitQuery}”
                </div>
                {commitEntries.map((entry, idx) => (
                  <div
                    key={entry.hash + idx}
                    className="group flex items-start gap-3 px-3 py-2 cursor-pointer border-b border-border-subtle hover:bg-bg-hover"
                    title="Click: open in History"
                    onClick={() => {
                      useSelectionStore.getState().selectCommit(entry.hash);
                      navigate('/history');
                    }}
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
                    <code className="text-xs font-mono text-text-tertiary flex-shrink-0">{shortHash(entry.hash)}</code>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {/* ================= File history tab ================= */}
      {tab === 'history' && (
        <>
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
                    {/* Cross-tool links — the found commit becomes the global
                        selection and opens in History / Diff like anywhere else */}
                    <button
                      className="icon-btn"
                      title="View in History (Log)"
                      onClick={() => {
                        useSelectionStore.getState().selectCommit(selected.hash);
                        window.location.hash = '#/history';
                      }}
                    >
                      <History size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Open in Diff tool"
                      onClick={() => {
                        useSelectionStore.getState().selectCommit(selected.hash);
                        useSelectionStore.getState().selectFile('.');
                        window.location.hash = '#/diff';
                      }}
                    >
                      <FileText size={12} />
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
        </>
      )}

      {/* ================= Content search (git grep) tab ================= */}
      {tab === 'grep' && (
        <>
          <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary flex-wrap">
            <input
              type="text"
              className="flex-1 min-w-48 text-sm mono"
              placeholder="pattern (regex by default)"
              value={grepPattern}
              autoFocus
              onChange={(e) => setGrepPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGrep()}
            />
            <label className="flex items-center gap-1 text-xs cursor-pointer text-text-secondary" title="-i">
              <input type="checkbox" checked={grepIgnoreCase} onChange={(e) => setGrepIgnoreCase(e.target.checked)} />
              Ignore case
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer text-text-secondary" title="-w">
              <input type="checkbox" checked={grepWord} onChange={(e) => setGrepWord(e.target.checked)} />
              Whole words
            </label>
            <label className="flex items-center gap-1 text-xs cursor-pointer text-text-secondary" title="--untracked">
              <input type="checkbox" checked={grepUntracked} onChange={(e) => setGrepUntracked(e.target.checked)} />
              Include untracked
            </label>
            <button
              className="btn btn-primary text-xs"
              onClick={handleGrep}
              disabled={grepLoading || !grepPattern.trim()}
            >
              {grepLoading ? <Loader size={12} className="spin" /> : <Search size={12} />}
              Search
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {grepLoading ? (
              <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
                <Loader size={14} className="spin" />
                Searching tracked files...
              </div>
            ) : !grepSearched ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <Search size={32} className="mb-2 opacity-50" />
                <div className="text-sm">No content search yet</div>
                <div className="text-xs mt-1">git grep across the working tree — enter a pattern above</div>
              </div>
            ) : grepMatches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <Search size={32} className="mb-2 opacity-50" />
                <div className="text-sm">No matches</div>
              </div>
            ) : (
              <>
                <div className="px-3 py-1.5 text-2xs text-text-tertiary border-b border-border-default bg-bg-secondary">
                  {grepMatches.length} match{grepMatches.length === 1 ? '' : 'es'} in{' '}
                  {new Set(grepMatches.map((m) => m.file)).size} file
                  {new Set(grepMatches.map((m) => m.file)).size === 1 ? '' : 's'}
                </div>
                {grepMatches.map((m, i) => (
                  <div
                    key={`${m.file}:${m.line}:${i}`}
                    className="group flex items-start gap-2 px-3 py-1 border-b border-border-subtle hover:bg-bg-hover text-xs cursor-pointer"
                    title={`${m.file}:${m.line} — click to show the file in Changes`}
                    onClick={() => {
                      useSelectionStore.getState().selectFile(m.file);
                      navigate('/changes');
                    }}
                  >
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-4 !h-4 flex-shrink-0 mt-0.5"
                      title="Copy file:line reference"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(`${m.file}:${m.line}`);
                        toast.success('Reference copied');
                      }}
                    >
                      <Copy size={10} />
                    </button>
                    <code className="font-mono text-accent flex-shrink-0 truncate max-w-50" title={m.file}>
                      {m.file}
                    </code>
                    <code className="font-mono text-text-tertiary flex-shrink-0">{m.line}</code>
                    <pre className="font-mono whitespace-pre-wrap break-all text-text-primary flex-1 min-w-0">
                      {m.text}
                    </pre>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {/* ================= Rev-parse tab ================= */}
      {tab === 'revparse' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <GitCommit size={13} />
              Current branch:
              <code className="font-mono text-accent">{currentBranch || 'detached / unknown'}</code>
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">
                rev-parse expression (any git revision syntax, multiple args allowed)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 text-sm font-mono"
                  placeholder="HEAD~3  |  v1.0^{commit}  |  --abbrev-ref HEAD  |  main@{upstream}"
                  value={revInput}
                  onChange={(e) => setRevInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRevParse()}
                />
                <button className="btn btn-primary text-xs" onClick={handleRevParse} disabled={revBusy || !revInput.trim()}>
                  {revBusy ? <Loader size={12} className="spin" /> : <CornerDownRight size={12} />}
                  Evaluate
                </button>
              </div>
            </div>
            {revResult !== null && (
              <div className="border border-border-default rounded bg-bg-tertiary p-3">
                <div className="text-2xs uppercase text-text-tertiary mb-1">Result</div>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm text-accent break-all flex-1">{revResult}</code>
                  <button
                    className="icon-btn !w-6 !h-6"
                    title="Copy result"
                    onClick={() => {
                      navigator.clipboard.writeText(revResult);
                      toast.success('Copied');
                    }}
                  >
                    <Copy size={11} />
                  </button>
                </div>
              </div>
            )}
            {revError && (
              <div className="border border-status-deleted/40 rounded bg-status-deleted/10 p-3">
                <div className="text-2xs uppercase text-status-deleted mb-1">Error</div>
                <code className="font-mono text-xs text-status-deleted break-all">{revError}</code>
              </div>
            )}
            <div className="text-xs text-text-tertiary space-y-1 pt-2 border-t border-border-default">
              <div className="font-semibold text-text-secondary mb-1">Useful expressions:</div>
              <div><code className="text-accent">HEAD~5</code> — 5 commits before HEAD</div>
              <div><code className="text-accent">v1.0{'{'}commit{'}'}</code> — the commit a tag points to</div>
              <div><code className="text-accent">--abbrev-ref HEAD</code> — current branch name</div>
              <div><code className="text-accent">main@{'{'}upstream{'}'}</code> — upstream ref of main</div>
              <div><code className="text-accent">HEAD@{'{'}1.hour.ago{'}'}</code> — where HEAD was an hour ago</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
