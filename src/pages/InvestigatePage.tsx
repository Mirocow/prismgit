import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Loader, GitCommit, CornerDownRight, ExternalLink, Copy, History, FolderOpen, ChevronDown, ChevronRight } from '../components/icons';
import { RefBadges } from '../lib/refBadge';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type LogEntry } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';
import { parseGrepOutput, highlight, filterTrackedFiles, type GrepMatch } from '../lib/searchUtils';

type Tab = 'commits' | 'files' | 'history' | 'grep' | 'revparse';

export function InvestigatePage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('commits');

  // === Commit message search tab (git log --grep, LIVE as-you-type) ===
  const [commitQuery, setCommitQuery] = useState('');
  const [commitLiveQuery, setCommitLiveQuery] = useState(''); // debounced
  const [commitIgnoreCase, setCommitIgnoreCase] = useState(true);
  const [commitEntries, setCommitEntries] = useState<LogEntry[]>([]);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitSearched, setCommitSearched] = useState(false);
  const commitSeq = useRef(0);

  // Debounce the commit query — search runs automatically while typing
  useEffect(() => {
    const t = setTimeout(() => setCommitLiveQuery(commitQuery), 300);
    return () => clearTimeout(t);
  }, [commitQuery]);

  useEffect(() => {
    const q = commitLiveQuery.trim();
    if (q.length < 2) {
      setCommitEntries([]);
      setCommitSearched(false);
      return;
    }
    const seq = ++commitSeq.current;
    setCommitLoading(true);
    setCommitSearched(true);
    api.git.log(repo.path, { maxCount: 200, all: true, grep: q, grepIgnoreCase: commitIgnoreCase })
      .then((result) => { if (commitSeq.current === seq) setCommitEntries(result); })
      .catch((e) => {
        if (commitSeq.current === seq) { toast.error('Commit search failed', String(e)); setCommitEntries([]); }
      })
      .finally(() => { if (commitSeq.current === seq) setCommitLoading(false); });
  }, [commitLiveQuery, commitIgnoreCase, repo.path, toast]);

  // === Tracked files (shared by the Files tab + File History path helper) ===
  const [trackedFiles, setTrackedFiles] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setTrackedFiles([]);
    api.git.trackedFiles(repo.path)
      .then((files) => { if (!cancelled) setTrackedFiles(files); })
      .catch(() => { /* Files tab degrades to manual path entry */ });
    return () => { cancelled = true; };
  }, [repo.path]);

  // === Files tab — live file-NAME search over git ls-files ===
  const [fileQuery, setFileQuery] = useState('');
  const fileResults = useMemo(
    () => filterTrackedFiles(trackedFiles, fileQuery, 200),
    [trackedFiles, fileQuery]
  );

  const openFileHistory = useCallback((path: string) => {
    setFilePath(path);
    setHistQuery(path);
    setTab('history');
    // Cross-tool: the picked file becomes the global selection (Toolbar chip,
    // Changes, Blame, LFS all follow).
    useSelectionStore.getState().selectFile(path);
  }, []);
  const openInChanges = useCallback((path: string) => {
    useSelectionStore.getState().selectFile(path);
    navigate('/changes');
  }, [navigate]);

  // === File history tab ===
  const [filePath, setFilePath] = useState('');
  const [histQuery, setHistQuery] = useState(''); // drives the path-helper dropdown
  const [followRenames, setFollowRenames] = useState(true);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [searched, setSearched] = useState(false);
  const histPathHelper = useMemo(() => {
    const q = histQuery.trim().toLowerCase();
    if (!q) return [];
    return trackedFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 12);
  }, [trackedFiles, histQuery]);

  // Prefill the File History path from the file selected elsewhere in the app
  // (Changes / History) — makes the tab instantly usable without typing paths.
  useEffect(() => {
    const sel = useSelectionStore.getState().selectedFilePath;
    if (sel) { setFilePath(sel); setHistQuery(sel); }
  }, []);

  // Repo switch: stale results from the previous repository must not survive.
  // The tracked-files effect above reloads on repo.path; here we clear every
  // tab-local search result.
  useEffect(() => {
    setEntries([]);
    setSelected(null);
    setSearched(false);
    setGrepMatches([]);
    setGrepSearched(false);
    setGrepError('');
    setRevResult(null);
    setRevError(null);
    setRevInput('HEAD');
  }, [repo.path]);

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

  // === Content search (git grep) tab ===
  const [grepPattern, setGrepPattern] = useState('');
  const [grepIgnoreCase, setGrepIgnoreCase] = useState(false);
  const [grepWord, setGrepWord] = useState(false);
  const [grepUntracked, setGrepUntracked] = useState(false);
  const [grepPathspec, setGrepPathspec] = useState('');
  const [grepMatches, setGrepMatches] = useState<GrepMatch[]>([]);
  const [grepLoading, setGrepLoading] = useState(false);
  const [grepSearched, setGrepSearched] = useState(false);
  const [grepError, setGrepError] = useState('');
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const handleGrep = useCallback(async () => {
    if (!grepPattern.trim()) {
      toast.warning('Search pattern is required');
      return;
    }
    setGrepLoading(true);
    setGrepSearched(true);
    setGrepError('');
    try {
      const options = ['--line-number'];
      if (grepIgnoreCase) options.push('-i');
      if (grepWord) options.push('-w');
      if (grepUntracked) options.push('--untracked');
      const raw = await api.git.grep(repo.path, grepPattern, options, grepPathspec || undefined);
      setGrepMatches(parseGrepOutput(raw));
    } catch (e) {
      const msg = String(e);
      // git grep exits with code 1 when there are no matches — treat as empty result
      if (msg.includes('exit code 1') || msg.includes('no matches')) {
        setGrepMatches([]);
      } else {
        setGrepError(msg);
        setGrepMatches([]);
      }
    } finally {
      setGrepLoading(false);
    }
  }, [repo.path, grepPattern, grepIgnoreCase, grepWord, grepUntracked, grepPathspec, toast]);

  // Group grep matches per file, preserving git's order
  const grepGroups = useMemo(() => {
    const map = new Map<string, GrepMatch[]>();
    for (const m of grepMatches) {
      const arr = map.get(m.file);
      if (arr) arr.push(m);
      else map.set(m.file, [m]);
    }
    return Array.from(map.entries());
  }, [grepMatches]);

  // === Rev-parse tab ===
  const [revInput, setRevInput] = useState('HEAD');
  const [revResult, setRevResult] = useState<string | null>(null);
  const [revError, setRevError] = useState<string | null>(null);
  const [revBusy, setRevBusy] = useState(false);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

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
    { id: 'commits', label: 'Commits', title: 'Live commit-message search across ALL branches (git log --grep --all)' },
    { id: 'files', label: 'Files', title: 'Find tracked files by name (git ls-files)' },
    { id: 'history', label: 'File History', title: 'Commit history of a single file (with rename following)' },
    { id: 'grep', label: 'Content', title: 'git grep — search tracked file contents, optionally narrowed to a path' },
    { id: 'revparse', label: 'Rev-Parse', title: 'Evaluate git rev-parse expressions (HEAD~3, main@{yesterday}, v1.0^{commit}, ...)' },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <Search size={14} />
        <span className="text-sm font-medium">Search</span>
        <span className="text-2xs text-text-tertiary truncate" title={repo.path}>{repo.name}</span>
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

      {/* ================= Commit message search tab (LIVE) ================= */}
      {tab === 'commits' && (
        <>
          <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary">
            <Search size={14} className="text-text-tertiary flex-shrink-0" />
            <input
              type="text"
              className="flex-1 text-sm"
              placeholder="Search commit messages — live as you type (regex supported), across ALL branches"
              value={commitQuery}
              autoFocus
              onChange={(e) => setCommitQuery(e.target.value)}
            />
            <label className="flex items-center gap-1 text-xs cursor-pointer text-text-secondary" title="-i">
              <input type="checkbox" checked={commitIgnoreCase} onChange={(e) => setCommitIgnoreCase(e.target.checked)} />
              Ignore case
            </label>
            {commitLoading && <Loader size={13} className="spin text-text-tertiary" />}
          </div>
          <div className="flex-1 overflow-y-auto">
            {commitQuery.trim().length < 2 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <GitCommit size={32} className="mb-2 opacity-50" />
                <div className="text-sm">Type at least 2 characters</div>
                <div className="text-xs mt-1">Searches commit messages on all branches — results appear live</div>
              </div>
            ) : commitSearched && !commitLoading && commitEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <GitCommit size={32} className="mb-2 opacity-50" />
                <div className="text-sm">No commits match “{commitQuery}”</div>
              </div>
            ) : (
              <>
                <div className="px-3 py-1.5 text-2xs text-text-tertiary border-b border-border-default bg-bg-secondary">
                  {commitLoading ? 'Searching…' : `${commitEntries.length} commit${commitEntries.length === 1 ? '' : 's'} match “${commitLiveQuery}”`}
                  <span className="ml-2 opacity-70">· click a commit to open it in History</span>
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
                        <RefBadges refs={entry.refs} size={7} hash={entry.hash} className="flex-wrap" />
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

      {/* ================= Files tab — live file-name search ================= */}
      {tab === 'files' && (
        <>
          <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary">
            <Search size={14} className="text-text-tertiary flex-shrink-0" />
            <input
              type="text"
              className="flex-1 text-sm font-mono"
              placeholder="Find tracked files by name — live (e.g. util, .tsx, config)"
              value={fileQuery}
              autoFocus
              onChange={(e) => setFileQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && fileResults[0]) openFileHistory(fileResults[0]); }}
            />
            <span className="text-2xs text-text-tertiary flex-shrink-0">
              {fileQuery.trim() ? `${fileResults.length}${fileResults.length === 200 ? '+' : ''} of ${trackedFiles.length} tracked files` : `${trackedFiles.length} tracked files`}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {!fileQuery.trim() ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <FileText size={32} className="mb-2 opacity-50" />
                <div className="text-sm">Type a file name or part of a path</div>
                <div className="text-xs mt-1">Click a result: History · <FileText size={9} className="inline" />: open in Changes</div>
              </div>
            ) : fileResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <FileText size={32} className="mb-2 opacity-50" />
                <div className="text-sm">No tracked file matches “{fileQuery}”</div>
              </div>
            ) : (
              fileResults.map((f) => {
                const base = f.slice(f.lastIndexOf('/') + 1);
                return (
                  <div
                    key={f}
                    className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-subtle hover:bg-bg-hover text-xs"
                    title={`${f} — click: file history`}
                    onClick={() => openFileHistory(f)}
                  >
                    <FileText size={12} className="text-text-tertiary flex-shrink-0" />
                    <span className="font-mono truncate flex-1 min-w-0">
                      {f.slice(0, f.length - base.length)}
                      <span className="text-text-primary font-medium">{base}</span>
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                      title="Open in Changes"
                      onClick={(e) => { e.stopPropagation(); openInChanges(f); }}
                    >
                      <FolderOpen size={11} />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                      title="File history"
                      onClick={(e) => { e.stopPropagation(); openFileHistory(f); }}
                    >
                      <History size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* ================= File history tab ================= */}
      {tab === 'history' && (
        <>
          <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary">
            <div className="relative flex-1">
              <input
                type="text"
                className="w-full text-sm mono"
                placeholder="path/to/file.txt — type to pick from tracked files"
                value={histQuery}
                onChange={(e) => { setHistQuery(e.target.value); setFilePath(e.target.value); }}
                onKeyDown={(e) => e.key === 'Enter' && handleInvestigate()}
              />
              {histPathHelper.length > 0 && histQuery.trim() !== filePath && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 max-h-64 overflow-y-auto">
                  {histPathHelper.map((f) => (
                    <div
                      key={f}
                      className="px-2 py-1 text-xs font-mono hover:bg-bg-hover cursor-pointer truncate"
                      onClick={() => { setFilePath(f); setHistQuery(f); useSelectionStore.getState().selectFile(f); }}
                    >
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
                  <div className="text-xs mt-1">Enter a file path (or pick one from the Files tab)</div>
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
                    onClick={() => {
                      setSelected(entry);
                      // Cross-tool: also the GLOBAL commit selection so the
                      // commit shows up in Toolbar/History/Diff/Notes.
                      useSelectionStore.getState().selectCommit(entry.hash);
                    }}
                  >
                    <GitCommit size={14} className="text-text-tertiary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{entry.subject}</div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                        <span className="font-medium text-text-secondary">{entry.author.name}</span>
                        <span>·</span>
                        <span>{formatDate(entry.author.date)}</span>
                        <RefBadges refs={entry.refs} size={7} hash={entry.hash} className="flex-wrap" />
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
            <input
              type="text"
              className="w-44 text-xs mono"
              placeholder="path filter (e.g. src/*.ts)"
              value={grepPathspec}
              onChange={(e) => setGrepPathspec(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGrep()}
              title="Optional pathspec — narrow the search to matching paths only"
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
            ) : grepError ? (
              <div className="p-6">
                <div className="border border-status-deleted/40 rounded bg-status-deleted/10 p-3">
                  <div className="text-2xs uppercase text-status-deleted mb-1">Grep error</div>
                  <code className="font-mono text-xs text-status-deleted break-all">{grepError}</code>
                </div>
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
                  {grepGroups.length} file{grepGroups.length === 1 ? '' : 's'}
                  {grepPathspec.trim() && <> · path: <code className="font-mono">{grepPathspec}</code></>}
                </div>
                {grepGroups.map(([file, matches]) => {
                  const collapsed = collapsedFiles.has(file);
                  return (
                    <div key={file}>
                      <div
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border-b border-border-subtle cursor-pointer hover:bg-bg-hover"
                        onClick={() => setCollapsedFiles((prev) => {
                          const next = new Set(prev);
                          if (next.has(file)) next.delete(file); else next.add(file);
                          return next;
                        })}
                        title={collapsed ? 'Expand matches' : 'Collapse matches'}
                      >
                        {collapsed ? <ChevronRight size={11} className="text-text-tertiary" /> : <ChevronDown size={11} className="text-text-tertiary" />}
                        <FileText size={11} className="text-text-tertiary flex-shrink-0" />
                        <code className="font-mono text-xs text-text-primary truncate flex-1 min-w-0">{file}</code>
                        <span className="text-2xs text-text-tertiary flex-shrink-0">{matches.length}</span>
                        <button
                          className="opacity-0 hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                          title="File history"
                          onClick={(e) => { e.stopPropagation(); openFileHistory(file); }}
                        >
                          <History size={11} />
                        </button>
                      </div>
                      {!collapsed && matches.map((m, i) => (
                        <div
                          key={`${m.file}:${m.line}:${i}`}
                          className="group flex items-start gap-2 pl-6 pr-3 py-1 border-b border-border-subtle hover:bg-bg-hover text-xs cursor-pointer"
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
                          <code className="font-mono text-text-tertiary flex-shrink-0 w-10 text-right">{m.line}</code>
                          <pre className="font-mono whitespace-pre-wrap break-all text-text-primary flex-1 min-w-0">
                            {highlight(m.text, grepPattern, grepIgnoreCase).map((seg, j) =>
                              seg.hit
                                ? <mark key={j} className="bg-status-added/30 text-text-primary rounded-sm px-0.5">{seg.seg}</mark>
                                : <span key={j}>{seg.seg}</span>
                            )}
                          </pre>
                        </div>
                      ))}
                    </div>
                  );
                })}
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
