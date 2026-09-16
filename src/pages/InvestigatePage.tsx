import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, FileText, Loader, GitCommit, CornerDownRight,
  ExternalLink, Copy, History, FolderOpen,
  ChevronDown, ChevronRight, AlertCircle, GitBranch, X, Filter,
} from '../components/icons';
import { RefBadges } from '../lib/refBadge';
import { Avatar } from '../components/Avatar';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type LogEntry } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';
import { parseGrepOutput, highlight, filterTrackedFiles, type GrepMatch } from '../lib/searchUtils';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';

/**
 * Result category. The unified search runs multiple queries in parallel and
 * groups results by category. Each row in a category has a `kind` so the
 * open-file/open-history/commit-link actions can be picked without inspecting
 * the row shape.
 */
type Category = 'commits' | 'files' | 'content';
type Mode = 'all' | 'commits' | 'files' | 'content' | 'advanced';

/**
 * Unified Search page.
 *
 * What changed vs the previous "5-tab" design:
 *   - One search bar at the top — the user types once and sees results from
 *     ALL categories (commits, files, content) in one scrollable list.
 *   - Filter chips below the bar narrow which categories are searched
 *     (All / Commits / Files / Content / Advanced). "Advanced" exposes the
 *     rev-parse evaluator and the per-tab knobs (ignore-case, whole-words,
 *     pathspec) without leaving the page.
 *   - All queries are debounced 200ms and run in parallel — the user sees
 *     results populate progressively instead of waiting on one big query.
 *   - Each result row carries an explicit `kind` so the open-history /
 *     open-changes / open-commit-in-browser actions work uniformly.
 *   - The grep parser was patched to handle empty output, exit code 1
 *     (no matches → not an error), and Windows-style paths.
 *   - Empty results show a friendly "no matches found" with the query echoed.
 */
export function InvestigatePage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const navigate = useNavigate();

  // ─── Unified search input ────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [mode, setMode] = useState<Mode>('all');
  // Common search options — apply to all categories
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [wholeWords, setWholeWords] = useState(false);
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [pathspec, setPathspec] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Debounce the search query — 200ms is short enough to feel live but long
  // enough to coalesce rapid typing. The previous design debounced per-tab
  // (commits: 300ms) which felt sluggish.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  // ─── Tracked files (loaded once per repo, used by the files category) ────
  const [trackedFiles, setTrackedFiles] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    setTrackedFiles([]);
    api.git.trackedFiles(repo.path)
      .then((files) => { if (!cancelled) setTrackedFiles(files); })
      .catch(() => { /* files category degrades to no-results */ });
    return () => { cancelled = true; };
  }, [repo.path]);

  // ─── Commit results (git log --grep --all) ───────────────────────────────
  const [commits, setCommits] = useState<LogEntry[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const commitSeq = useRef(0);

  useEffect(() => {
    const q = debouncedQuery.trim();
    // Only run commit search when the user asked for it (mode all/commits)
    // and the query is at least 2 chars (git --grep is slow on huge histories).
    if (q.length < 2 || (mode !== 'all' && mode !== 'commits')) {
      setCommits([]);
      return;
    }
    const seq = ++commitSeq.current;
    setCommitsLoading(true);
    api.git.log(repo.path, {
      maxCount: 100, all: true, grep: q, grepIgnoreCase: ignoreCase,
    })
      .then((result) => { if (commitSeq.current === seq) setCommits(result); })
      .catch((e) => {
        if (commitSeq.current === seq) {
          // git log --grep on a corrupted reflog can fail; surface a soft
          // error rather than crashing the whole search.
          console.warn('[search] commit search failed:', e);
          setCommits([]);
        }
      })
      .finally(() => { if (commitSeq.current === seq) setCommitsLoading(false); });
  }, [debouncedQuery, mode, ignoreCase, repo.path]);

  // ─── File results (filter trackedFiles) ──────────────────────────────────
  const fileResults = useMemo(() => {
    const q = debouncedQuery.trim();
    if (q.length < 1 || (mode !== 'all' && mode !== 'files')) return [];
    return filterTrackedFiles(trackedFiles, q, 50);
  }, [trackedFiles, debouncedQuery, mode]);

  // ─── Content results (git grep) ──────────────────────────────────────────
  const [contentMatches, setContentMatches] = useState<GrepMatch[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState('');
  const grepSeq = useRef(0);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2 || (mode !== 'all' && mode !== 'content')) {
      setContentMatches([]);
      setContentError('');
      return;
    }
    const seq = ++grepSeq.current;
    setContentLoading(true);
    setContentError('');
    const options = ['--line-number'];
    if (ignoreCase) options.push('-i');
    if (wholeWords) options.push('-w');
    if (includeUntracked) options.push('--untracked');
    api.git.grep(repo.path, q, options, pathspec || undefined)
      .then((raw) => {
        if (grepSeq.current === seq) {
          setContentMatches(parseGrepOutput(raw).slice(0, 200));
        }
      })
      .catch((e) => {
        if (grepSeq.current === seq) {
          // exit code 1 = no matches (already handled in the service); only
          // show real errors (bad regex, missing files, etc.).
          const msg = String(e);
          if (!msg.includes('exit code 1') && !msg.includes('no matches')) {
            setContentError(msg);
          }
          setContentMatches([]);
        }
      })
      .finally(() => { if (grepSeq.current === seq) setContentLoading(false); });
  }, [debouncedQuery, mode, ignoreCase, wholeWords, includeUntracked, pathspec, repo.path]);

  // Reset state when the repo changes — stale results from the previous
  // repository must not survive.
  useEffect(() => {
    setQuery('');
    setDebouncedQuery('');
    setCommits([]);
    setContentMatches([]);
    setContentError('');
    setPathspec('');
  }, [repo.path]);

  // ─── Cross-tool navigation helpers ────────────────────────────────────────
  const openCommitInHistory = useCallback((hash: string) => {
    useSelectionStore.getState().selectCommit(hash);
    navigate('/history');
  }, [navigate]);

  const openFileInChanges = useCallback((path: string) => {
    useSelectionStore.getState().selectFile(path);
    navigate('/changes');
  }, [navigate]);

  const openFileInDiff = useCallback((path: string) => {
    useSelectionStore.getState().selectFile(path);
    navigate('/diff');
  }, [navigate]);

  const openFileHistory = useCallback((path: string) => {
    useSelectionStore.getState().selectFile(path);
    navigate('/history');
  }, [navigate]);

  const openInBlame = useCallback((path: string) => {
    useSelectionStore.getState().selectFile(path);
    navigate('/blame');
  }, [navigate]);

  const handleOpenCommitInBrowser = useCallback(async (entry: LogEntry) => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        api.app.openExternal(`${info.webUrl}/commit/${entry.hash}`);
      } else {
        toast.info(t('pages.noRemoteUrl'));
      }
    } catch (e) {
      toast.error(t('pages.openInBrowserFailed'), String(e));
    }
  }, [repo.path, toast, t]);

  const copyToClipboard = useCallback((text: string, label?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(label || t('common.copied', { defaultValue: 'Copied' }));
    }).catch(() => {
      toast.error(t('common.copyFailed', { defaultValue: 'Copy failed' }));
    });
  }, [toast, t]);

  // ─── Group content matches per file (preserving git's order) ─────────────
  const contentGroups = useMemo(() => {
    const map = new Map<string, GrepMatch[]>();
    for (const m of contentMatches) {
      const arr = map.get(m.file);
      if (arr) arr.push(m);
      else map.set(m.file, [m]);
    }
    return Array.from(map.entries());
  }, [contentMatches]);

  // ─── Result counts for the chips + the empty/no-results check ────────────
  const hasAnyResult = commits.length > 0 || fileResults.length > 0 || contentMatches.length > 0;
  const anyLoading = commitsLoading || contentLoading;
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length >= 2;
  const showEmpty = !anyLoading && hasQuery && !hasAnyResult && !contentError;

  const MODES: { id: Mode; label: string }[] = [
    { id: 'all', label: t('pages.searchModeAll', { defaultValue: 'All' }) },
    { id: 'commits', label: t('pages.invTabCommits') },
    { id: 'files', label: t('pages.invTabFiles') },
    { id: 'content', label: t('pages.invTabContent') },
    { id: 'advanced', label: t('pages.searchModeAdvanced', { defaultValue: 'Advanced' }) },
  ];

  // ─── Advanced tab (rev-parse evaluator + grep pathspec) ───────────────────
  // Kept as a separate panel inside the same page — was a separate tab before,
  // which forced the user to leave the search context. Now it lives behind the
  // "Advanced" mode chip so power users can still reach it without the normal
  // user having to see it.
  const [revInput, setRevInput] = useState('HEAD');
  const [revResult, setRevResult] = useState<string | null>(null);
  const [revError, setRevError] = useState<string | null>(null);
  const [revBusy, setRevBusy] = useState(false);

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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* ===== Header ===== */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <Search size={14} />
        <span className="text-sm font-medium">{t('nav.search')}</span>
        <span className="text-2xs text-text-tertiary truncate" title={repo.path}>{repo.name}</span>
        {/* Mode chips */}
        <div className="flex items-center gap-1 ml-4">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={cn(
                'px-2.5 py-1 text-xs rounded transition-colors',
                mode === m.id
                  ? 'bg-accent-muted text-accent font-medium'
                  : 'text-text-secondary hover:bg-bg-hover'
              )}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Unified search bar ===== */}
      <div className="flex flex-col gap-2 p-3 border-b border-border-default bg-bg-tertiary">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-text-tertiary flex-shrink-0" />
          <input
            type="text"
            className="flex-1 text-sm"
            placeholder={t('pages.searchPlaceholder', {
              defaultValue: 'Search commits, files, and content (Ctrl+Enter to grep, Esc to clear)...'
            })}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) { setQuery(''); }
            }}
            title={t('pages.searchPlaceholderTooltip', {
              defaultValue: 'Commits: matches subject/body via git log --grep. Files: matches tracked file paths. Content: matches file contents via git grep.'
            })}
          />
          {query && (
            <button
              className="icon-btn !w-6 !h-6 flex-shrink-0"
              title={t('common.clear', { defaultValue: 'Clear' })}
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
          <button
            className="icon-btn !w-7 !h-7 flex-shrink-0"
            title={showAdvanced
              ? t('pages.searchHideAdvanced', { defaultValue: 'Hide search options' })
              : t('pages.searchShowAdvanced', { defaultValue: 'Show search options (ignore case, whole words, path filter, etc.)' })}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Filter size={13} className={cn(showAdvanced && 'text-accent')} />
          </button>
        </div>
        {/* Advanced search options — collapsible row of checkboxes + pathspec */}
        {showAdvanced && (
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <label className="flex items-center gap-1 cursor-pointer text-text-secondary" title="-i">
              <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />
              {t('pages.ignoreCase')}
            </label>
            <label className="flex items-center gap-1 cursor-pointer text-text-secondary" title="-w (content only)">
              <input type="checkbox" checked={wholeWords} onChange={(e) => setWholeWords(e.target.checked)} />
              {t('pages.wholeWords')}
            </label>
            <label className="flex items-center gap-1 cursor-pointer text-text-secondary" title="--untracked (content only)">
              <input type="checkbox" checked={includeUntracked} onChange={(e) => setIncludeUntracked(e.target.checked)} />
              {t('pages.includeUntracked')}
            </label>
            <div className="flex items-center gap-1">
              <span className="text-text-tertiary">{t('pages.pathLabel', { defaultValue: 'Path:' })}</span>
              <input
                type="text"
                className="w-40 text-xs mono px-2 py-0.5 bg-bg-primary border border-border-default rounded"
                placeholder={t('pages.invGrepPathPlaceholder')}
                value={pathspec}
                onChange={(e) => setPathspec(e.target.value)}
                title={t('pages.invGrepPathTitle')}
              />
            </div>
          </div>
        )}
      </div>

      {/* ===== Result counts summary ===== */}
      {(hasQuery || anyLoading) && mode !== 'advanced' && (
        <div className="px-3 py-1.5 text-2xs text-text-tertiary border-b border-border-subtle bg-bg-secondary flex items-center gap-3">
          {anyLoading && <Loader size={11} className="spin" />}
          {mode !== 'files' && (
            <span>
              {commitsLoading ? '…' : commits.length} {t('pages.invTabCommits')}
            </span>
          )}
          {mode !== 'content' && (
            <span>
              {fileResults.length} {t('pages.invTabFiles')}
            </span>
          )}
          {mode !== 'commits' && (
            <span>
              {contentLoading ? '…' : contentMatches.length} {t('pages.invTabContent')}
            </span>
          )}
        </div>
      )}

      {/* ===== Results ===== */}
      <div className="flex-1 overflow-y-auto">
        {mode === 'advanced' ? (
          // ─── Advanced: rev-parse evaluator + pathspec helper ─────────────
          <div className="p-4">
            <div className="max-w-2xl mx-auto space-y-4">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  {t('pages.revParseLabel', { defaultValue: 'rev-parse expression (any git revision syntax, multiple args allowed)' })}
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
                    {t('pages.revParseButton', { defaultValue: 'Evaluate' })}
                  </button>
                </div>
              </div>
              {revResult !== null && (
                <div className="border border-border-default rounded bg-bg-tertiary p-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1">{t('pages.revParseResult', { defaultValue: 'Result' })}</div>
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-sm text-accent break-all flex-1">{revResult}</code>
                    <button
                      className="icon-btn !w-6 !h-6"
                      title={t('common.copy', { defaultValue: 'Copy' })}
                      onClick={() => copyToClipboard(revResult)}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                </div>
              )}
              {revError && (
                <div className="border border-status-deleted/40 rounded bg-status-deleted/10 p-3">
                  <div className="text-2xs uppercase text-status-deleted mb-1">{t('pages.revParseError', { defaultValue: 'Error' })}</div>
                  <code className="font-mono text-xs text-status-deleted break-all">{revError}</code>
                </div>
              )}
              <div className="text-xs text-text-tertiary space-y-1 pt-2 border-t border-border-default">
                <div className="font-semibold text-text-secondary mb-1">{t('pages.revParseExamples', { defaultValue: 'Useful expressions:' })}</div>
                <div><code className="text-accent">HEAD~5</code> — 5 commits before HEAD</div>
                <div><code className="text-accent">v1.0{'{'}commit{'}'}</code> — the commit a tag points to</div>
                <div><code className="text-accent">--abbrev-ref HEAD</code> — current branch name</div>
                <div><code className="text-accent">main@{'{'}upstream{'}'}</code> — upstream ref of main</div>
              </div>
            </div>
          </div>
        ) : !hasQuery ? (
          // ─── Empty state: no query yet ───────────────────────────────────
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Search size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.searchEmpty', { defaultValue: 'Type at least 2 characters to search' })}</div>
            <div className="text-xs mt-1 max-w-md text-center">
              {t('pages.searchEmptyHint', { defaultValue: 'Searches commits (subject + body), tracked file paths, and file contents — all in parallel.' })}
            </div>
          </div>
        ) : showEmpty ? (
          // ─── Empty state: query ran, no results ──────────────────────────
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.searchNoResults', { defaultValue: 'No matches for "{q}"', q: trimmedQuery })}</div>
            <div className="text-xs mt-1 max-w-md text-center">
              {t('pages.searchNoResultsHint', { defaultValue: 'Try a shorter substring, enable Ignore case, or switch the search mode above.' })}
            </div>
          </div>
        ) : contentError ? (
          // ─── Content search error (bad regex, etc.) ──────────────────────
          <div className="p-6">
            <div className="border border-status-deleted/40 rounded bg-status-deleted/10 p-3">
              <div className="text-2xs uppercase text-status-deleted mb-1">{t('pages.grepError')}</div>
              <code className="font-mono text-xs text-status-deleted break-all">{contentError}</code>
            </div>
          </div>
        ) : (
          // ─── Results: commits → files → content (in that order) ──────────
          <>
            {/* ─── Commits ─── */}
            {(mode === 'all' || mode === 'commits') && commits.length > 0 && (
              <section>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center gap-2 sticky top-0 z-10">
                  <GitCommit size={11} />
                  {t('pages.invTabCommits')}
                  <span className="text-2xs text-text-tertiary font-normal">({commits.length})</span>
                  {commitsLoading && <Loader size={11} className="spin ml-auto" />}
                </div>
                {commits.map((entry, idx) => (
                  <div
                    key={entry.hash + idx}
                    className="group flex items-start gap-3 px-3 py-2 cursor-pointer border-b border-border-subtle hover:bg-bg-hover"
                    title={t('pages.invClickOpenHistory')}
                    onClick={() => openCommitInHistory(entry.hash)}
                  >
                    <GitCommit size={14} className="text-text-tertiary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">
                        {highlight(entry.subject, trimmedQuery, ignoreCase).map((seg, j) =>
                          seg.hit
                            ? <mark key={j} className="bg-status-added/30 text-text-primary rounded-sm px-0.5">{seg.seg}</mark>
                            : <span key={j}>{seg.seg}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                        <Avatar name={entry.author.name} email={entry.author.email} size={14} />
                        <span className="font-medium text-text-secondary">{entry.author.name}</span>
                        <span>·</span>
                        <span>{formatDate(entry.author.date)}</span>
                        <RefBadges refs={entry.refs} size={7} hash={entry.hash} className="flex-wrap" />
                      </div>
                    </div>
                    <code className="text-xs font-mono text-text-tertiary flex-shrink-0">{shortHash(entry.hash)}</code>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                      title={t('pages.openInBrowser')}
                      onClick={(e) => { e.stopPropagation(); handleOpenCommitInBrowser(entry); }}
                    >
                      <ExternalLink size={11} />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                      title={t('common.copyHash', { defaultValue: 'Copy commit hash' })}
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(entry.hash); }}
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                ))}
              </section>
            )}

            {/* ─── Files ─── */}
            {(mode === 'all' || mode === 'files') && fileResults.length > 0 && (
              <section>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center gap-2 sticky top-0 z-10">
                  <FileText size={11} />
                  {t('pages.invTabFiles')}
                  <span className="text-2xs text-text-tertiary font-normal">({fileResults.length}{fileResults.length === 50 ? '+' : ''})</span>
                </div>
                {fileResults.map((f) => {
                  const base = f.slice(f.lastIndexOf('/') + 1);
                  return (
                    <div
                      key={f}
                      className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-subtle hover:bg-bg-hover text-xs"
                      title={t('pages.invFileRowHint', { path: f })}
                      onClick={() => openFileHistory(f)}
                    >
                      <FileText size={12} className="text-text-tertiary flex-shrink-0" />
                      <span className="font-mono truncate flex-1 min-w-0">
                        {f.slice(0, f.length - base.length)}
                        <span className="text-text-primary font-medium">
                          {highlight(base, trimmedQuery, ignoreCase).map((seg, j) =>
                            seg.hit
                              ? <mark key={j} className="bg-status-added/30 text-text-primary rounded-sm px-0.5">{seg.seg}</mark>
                              : <span key={j}>{seg.seg}</span>
                          )}
                        </span>
                      </span>
                      <button
                        className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                        title={t('pages.openInChanges')}
                        onClick={(e) => { e.stopPropagation(); openFileInChanges(f); }}
                      >
                        <FolderOpen size={11} />
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                        title={t('pages.openInDiff', { defaultValue: 'Open in Diff tool' })}
                        onClick={(e) => { e.stopPropagation(); openFileInDiff(f); }}
                      >
                        <FileText size={11} />
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                        title={t('pages.openInBlame', { defaultValue: 'Open in Blame tool' })}
                        onClick={(e) => { e.stopPropagation(); openInBlame(f); }}
                      >
                        <GitBranch size={11} />
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                        title={t('pages.fileHistory')}
                        onClick={(e) => { e.stopPropagation(); openFileHistory(f); }}
                      >
                        <History size={11} />
                      </button>
                    </div>
                  );
                })}
              </section>
            )}

            {/* ─── Content (git grep) ─── */}
            {(mode === 'all' || mode === 'content') && contentGroups.length > 0 && (
              <section>
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center gap-2 sticky top-0 z-10">
                  <Search size={11} />
                  {t('pages.invTabContent')}
                  <span className="text-2xs text-text-tertiary font-normal">({contentMatches.length} in {contentGroups.length} files)</span>
                  {contentLoading && <Loader size={11} className="spin ml-auto" />}
                </div>
                {contentGroups.map(([file, matches]) => (
                  <div key={file}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border-b border-border-subtle">
                      <FileText size={11} className="text-text-tertiary flex-shrink-0" />
                      <code className="font-mono text-xs text-text-primary truncate flex-1 min-w-0">{file}</code>
                      <span className="text-2xs text-text-tertiary flex-shrink-0">{matches.length}</span>
                      <button
                        className="opacity-0 hover:opacity-100 icon-btn !w-5 !h-5 flex-shrink-0"
                        title={t('pages.fileHistory')}
                        onClick={() => openFileHistory(file)}
                      >
                        <History size={11} />
                      </button>
                    </div>
                    {matches.map((m, i) => (
                      <div
                        key={`${m.file}:${m.line}:${i}`}
                        className="group flex items-start gap-2 pl-6 pr-3 py-1 border-b border-border-subtle hover:bg-bg-hover text-xs cursor-pointer"
                        title={t('pages.invMatchRowHint', { file: m.file, line: m.line })}
                        onClick={() => openFileInChanges(m.file)}
                      >
                        <button
                          className="opacity-0 group-hover:opacity-100 icon-btn !w-4 !h-4 flex-shrink-0 mt-0.5"
                          title={t('pages.copyRef')}
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(`${m.file}:${m.line}`);
                          }}
                        >
                          <Copy size={10} />
                        </button>
                        <code className="font-mono text-text-tertiary flex-shrink-0 w-10 text-right">{m.line}</code>
                        <pre className="font-mono whitespace-pre-wrap break-all text-text-primary flex-1 min-w-0">
                          {highlight(m.text, trimmedQuery, ignoreCase).map((seg, j) =>
                            seg.hit
                              ? <mark key={j} className="bg-status-added/30 text-text-primary rounded-sm px-0.5">{seg.seg}</mark>
                              : <span key={j}>{seg.seg}</span>
                          )}
                        </pre>
                      </div>
                    ))}
                  </div>
                ))}
              </section>
            )}

            {/* ─── Loading indicator at the bottom while results stream in ─── */}
            {anyLoading && hasQuery && (
              <div className="p-3 text-center text-text-tertiary text-xs flex items-center justify-center gap-2">
                <Loader size={12} className="spin" />
                {t('pages.searching', { defaultValue: 'Searching...' })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
