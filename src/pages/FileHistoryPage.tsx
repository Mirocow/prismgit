/**
 * FileHistoryPage — standalone page for analyzing a file's history.
 *
 * URL: /file-history?file=<path>&commit=<hash>&base=<hash>&compare=<hash>
 *
 * Integrates with other tools:
 *   - History page → click file → navigate here with ?file=...&commit=...
 *   - Blame page → click → navigate here with ?file=...
 *   - Diff page → click file → navigate here with ?file=...&base=...&compare=...
 *   - Bisect → when found, navigate here with ?file=...&commit=...
 *
 * Layout:
 *   ┌──────────┬──────────────────────────────────────┐
 *   │ Commits  │  Snapshot / Diff view               │
 *   │ list     │  with blame gutter, AI explain,      │
 *   │ (left)   │  noise filter, cherry-pick/branch   │
 *   └──────────┴──────────────────────────────────────┘
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  GitCommit, Loader, FileText, GitBranch, ArrowRight, ArrowDown,
  Plus, Minus, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Sparkles,
  Search,
} from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastActions } from '../stores/toastStore';
import { api, type LogEntry, type DiffResult, type BlameResult } from '../lib/api';
import { Avatar } from '../components/Avatar';
import { cn, formatDate, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';

interface CommitEntry extends LogEntry {}

export function FileHistoryPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();

  // Read URL params — file path is required, commit/base/compare optional
  const filePath = searchParams.get('file') || '';
  const initialCommit = searchParams.get('commit') || '';
  const initialBase = searchParams.get('base') || '';
  const initialCompare = searchParams.get('compare') || '';

  // File picker state — when no file is selected via URL, let the user pick
  const [fileInput, setFileInput] = useState(filePath);

  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [compareIdx, setCompareIdx] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'snapshot' | 'diff'>(initialBase ? 'diff' : 'snapshot');
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [showBlame, setShowBlame] = useState(true);
  const [filterNoise, setFilterNoise] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load commits for this file
  const load = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    try {
      const result = await api.git.log(repo.path, {
        maxCount: 200, follow: true, file: path,
      });
      setCommits(result);
      // If initial commit is specified, select it
      if (initialCommit) {
        const idx = result.findIndex(c => c.hash.startsWith(initialCommit) || c.hash === initialCommit);
        if (idx !== -1) setSelectedIdx(idx);
        else setSelectedIdx(0);
      } else {
        setSelectedIdx(0);
      }
      // If base+compare specified, set up diff mode
      if (initialBase && initialCompare) {
        const baseIdx = result.findIndex(c => c.hash.startsWith(initialBase));
        if (baseIdx !== -1) setCompareIdx(baseIdx);
        const compIdx = result.findIndex(c => c.hash.startsWith(initialCompare));
        if (compIdx !== -1) setSelectedIdx(compIdx);
        setViewMode('diff');
      }
    } catch (e) {
      toast.error('Failed to load file history', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast, initialCommit, initialBase, initialCompare]);

  useEffect(() => {
    if (filePath) {
      void load(filePath);
    } else {
      // Navigated to /file-history without ?file= — clear stale state so
      // the snapshot/blame useEffect doesn't fire loadSnapshot() with the
      // previous file's commits but an empty filePath (which would crash
      // git blame with "fatal: no such path  in <hash>").
      setCommits([]);
      setSnapshot(null);
      setBlame(null);
      setDiffResult(null);
      setSelectedIdx(0);
      setCompareIdx(null);
    }
  }, [filePath, load]);

  const handleSelectFile = () => {
    if (fileInput.trim()) {
      setSearchParams({ file: fileInput.trim() });
      void load(fileInput.trim());
    }
  };

  const loadSnapshot = useCallback(async (hash: string) => {
    // Guard against the race where filePath becomes empty between the
    // commits being populated and this callback firing — without this,
    // `git blame <hash> -- ''` fails with "no such path  in <hash>".
    if (!filePath) {
      setSnapshot(null);
      setBlame(null);
      return;
    }
    setSnapshotLoading(true);
    setSnapshot(null);
    setBlame(null);
    try {
      const [content, blameResult] = await Promise.all([
        api.git.showFile(repo.path, hash, filePath),
        api.git.blame(repo.path, filePath, hash).catch(() => null),
      ]);
      setSnapshot(content);
      setBlame(blameResult);
    } catch {
      setSnapshot(null);
      setBlame(null);
    } finally {
      setSnapshotLoading(false);
    }
  }, [repo.path, filePath]);

  const loadDiff = useCallback(async (baseHash: string, compareHash: string) => {
    setDiffLoading(true);
    setDiffResult(null);
    try {
      const diffOutput = await api.git.raw(repo.path, ['diff', baseHash, compareHash, '--', filePath]);
      const hunks = parseDiffOutput(diffOutput);
      setDiffResult({ hunks, files: [{ path: filePath, status: 'modified', additions: 0, deletions: 0 }] } as any);
    } catch {
      setDiffResult(null);
    } finally {
      setDiffLoading(false);
    }
  }, [repo.path, filePath]);

  useEffect(() => {
    // Bail out early if there's no filePath — loadSnapshot/loadDiff would
    // call git with an empty file path and crash with "no such path".
    if (!filePath || commits.length === 0 || selectedIdx >= commits.length) return;
    const commit = commits[selectedIdx];
    if (viewMode === 'snapshot') {
      void loadSnapshot(commit.hash);
    } else if (viewMode === 'diff' && compareIdx !== null && compareIdx < commits.length) {
      const base = commits[compareIdx];
      void loadDiff(base.hash, commit.hash);
    }
  }, [filePath, selectedIdx, compareIdx, viewMode, commits, loadSnapshot, loadDiff]);

  const selectedCommit = commits[selectedIdx];

  const handleCherryPick = async () => {
    if (!selectedCommit) return;
    if (!(await confirmDialog({
      title: t('history.cherryPickTitle', { hash: shortHash(selectedCommit.hash) }),
      message: t('history.cherryPickMessage', { subject: selectedCommit.subject }),
      confirmLabel: t('history.cherryPickAction'),
    }))) return;
    try {
      const result = await api.git.cherryPick(repo.path, [selectedCommit.hash]);
      if (result.conflicts.length > 0) toast.warning(t('history.nConflicts', { count: result.conflicts.length }), t('history.cherryPickConflictsDetail'));
      else if (result.empty) toast.info(t('history.cherryPickEmpty'), t('history.cherryPickEmptyDetail'));
      else toast.success(t('toast.cherryPick.cherryPicked'));
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('toast.cherryPick.failed'), String(e)); }
  };

  const handleCreateBranch = async () => {
    if (!selectedCommit) return;
    const name = await promptDialog({
      title: t('history.createBranchTitle', { hash: shortHash(selectedCommit.hash) }),
      message: t('history.createBranchMessage'),
      input: { placeholder: 'feature/my-branch' },
      confirmLabel: t('history.createBranchAction'),
    });
    if (!name?.trim()) return;
    try {
      await api.git.createBranch(repo.path, name.trim(), selectedCommit.hash);
      toast.success(t('branches.created', { name: name.trim() }));
    } catch (e) { toast.error(t('branches.failed'), String(e)); }
  };

  const handleCheckoutDetached = async () => {
    if (!selectedCommit) return;
    if (!(await confirmDialog({
      title: t('history.checkoutTitle', { hash: shortHash(selectedCommit.hash) }),
      message: t('history.checkoutMessage'),
      confirmLabel: t('history.checkoutAction'),
    }))) return;
    try {
      await api.git.checkout(repo.path, selectedCommit.hash);
      toast.success(t('toast.git.checkoutSuccess', { ref: shortHash(selectedCommit.hash) }));
      await refreshStatus(repo.path);
    } catch (e) { toast.error(t('toast.git.checkoutFailed'), String(e)); }
  };

  const handleCopyContent = () => {
    if (snapshot) { navigator.clipboard.writeText(snapshot); toast.success('File content copied to clipboard'); }
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(commits.length - 1, i + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 's') setViewMode('snapshot');
      else if (e.key === 'd') setViewMode('diff');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commits.length]);

  const stats = useMemo(() => {
    if (!diffResult) return null;
    let additions = 0, deletions = 0;
    for (const hunk of diffResult.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') additions++;
        else if (line.type === 'del') deletions++;
      }
    }
    return { additions, deletions };
  }, [diffResult]);

  // No file selected — show file picker
  if (!filePath) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
          <FileText size={14} />
          <span className="text-sm font-medium">{t('pages.fileHistory', { defaultValue: 'File History' })}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-4 p-4">
          <FileText size={32} className="opacity-50" />
          <div className="text-sm">{t('pages.selectFileForHistory', { defaultValue: 'Enter a file path to view its history' })}</div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="text-sm font-mono w-80 px-2 py-1 bg-bg-tertiary border border-border-default rounded"
              placeholder="src/file.ts"
              value={fileInput}
              onChange={(e) => setFileInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSelectFile(); }}
            />
            <button className="btn btn-primary text-xs" onClick={handleSelectFile}>
              {t('common.ok', { defaultValue: 'OK' })}
            </button>
          </div>
          <div className="text-2xs text-text-tertiary">
            {t('pages.fileHistoryHint', { defaultValue: 'Tip: Right-click a file in History → "View file history..." to open this page automatically.' })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-accent flex-shrink-0" />
          <span className="text-sm font-medium truncate">{filePath}</span>
          <span className="text-2xs text-text-tertiary flex-shrink-0">
            {commits.length} commits
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* File path input — quick switch */}
          <input
            type="text"
            className="text-2xs font-mono w-40 px-1.5 py-0.5 bg-bg-tertiary border border-border-default rounded"
            placeholder="src/file.ts"
            value={fileInput}
            onChange={(e) => setFileInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSelectFile(); }}
          />
          {/* View mode toggle */}
          <div className="flex bg-bg-tertiary rounded">
            <button className={cn('px-2 py-0.5 text-2xs rounded-l', viewMode === 'snapshot' ? 'bg-accent text-text-inverse' : 'text-text-secondary')} onClick={() => setViewMode('snapshot')} title="Snapshot (S)">Snapshot</button>
            <button className={cn('px-2 py-0.5 text-2xs rounded-r', viewMode === 'diff' ? 'bg-accent text-text-inverse' : 'text-text-secondary')} onClick={() => setViewMode('diff')} title="Diff (D)">Diff</button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: commits list */}
        <div className="w-72 border-r border-border-default overflow-y-auto flex-shrink-0">
          <div className="px-3 py-1.5 text-2xs font-bold uppercase tracking-wider text-text-tertiary bg-bg-tertiary border-b border-border-subtle sticky top-0 z-10">
            {commits.length} commits
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-text-tertiary">
              <Loader size={16} className="animate-spin mr-2" />{t('common.loading')}
            </div>
          ) : commits.length === 0 ? (
            <div className="p-6 text-center text-text-tertiary text-xs">
              {t('pages.noFileHistory', { defaultValue: 'No commits found for this file.' })}
            </div>
          ) : (
            commits.map((c, idx) => (
              <div
                key={c.hash}
                className={cn(
                  'px-3 py-2 border-b border-border-subtle cursor-pointer flex items-start gap-2 transition-colors',
                  idx === selectedIdx ? 'bg-accent-muted border-l-2 border-l-accent' : 'hover:bg-bg-hover border-l-2 border-l-transparent',
                  idx === compareIdx && 'bg-status-modified/10 border-l-2 border-l-status-modified'
                )}
                onClick={(e) => {
                  if (e.shiftKey && viewMode === 'diff') setCompareIdx(idx);
                  else setSelectedIdx(idx);
                }}
                title="Click to select · Shift+click to set as compare base"
              >
                <Avatar name={c.author.name} email={c.author.email} size={16} className="mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary truncate">{c.subject}</div>
                  <div className="flex items-center gap-1.5 text-2xs text-text-tertiary mt-0.5">
                    <span className="text-text-secondary">{c.author.name}</span>
                    <span>·</span><span>{formatDate(c.author.date)}</span>
                    <span>·</span><code className="mono">{shortHash(c.hash)}</code>
                    {idx === compareIdx && <span className="text-status-modified font-bold ml-1">[base]</span>}
                    {idx === selectedIdx && viewMode === 'diff' && compareIdx !== null && <span className="text-accent font-bold ml-1">[head]</span>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right: content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Action bar */}
          {selectedCommit && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle bg-bg-tertiary">
              <code className="mono text-text-secondary text-xs">{shortHash(selectedCommit.hash)}</code>
              <span className="text-2xs text-text-tertiary">·</span>
              <span className="text-2xs text-text-tertiary">{selectedCommit.author.name}</span>
              <span className="text-2xs text-text-tertiary">·</span>
              <span className="text-2xs text-text-tertiary">{formatDate(selectedCommit.author.date)}</span>
              <div className="flex-1" />
              {viewMode === 'diff' && compareIdx !== null && (
                <div className="flex items-center gap-1 text-2xs text-text-tertiary">
                  <code className="mono">{shortHash(commits[compareIdx].hash)}</code>
                  <ArrowRight size={10} />
                  <code className="mono">{shortHash(selectedCommit.hash)}</code>
                  {stats && (<span className="ml-2"><span className="text-status-added">+{stats.additions}</span> <span className="text-status-deleted">-{stats.deletions}</span></span>)}
                </div>
              )}
              <button className="btn btn-secondary text-xs flex items-center gap-1" onClick={handleCherryPick} title="Cherry-pick"><GitCommit size={11} />Cherry-pick</button>
              <button className="btn btn-secondary text-xs flex items-center gap-1" onClick={handleCreateBranch} title="Create branch"><GitBranch size={11} />Branch</button>
              <button className="btn btn-secondary text-xs flex items-center gap-1" onClick={handleCheckoutDetached} title="Checkout (detached HEAD)"><ArrowDown size={11} />Checkout</button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto bg-bg-secondary" ref={containerRef}>
            {viewMode === 'snapshot' ? (
              <div className="h-full">
                {snapshotLoading ? (
                  <div className="flex items-center justify-center h-full text-text-tertiary"><Loader size={16} className="animate-spin mr-2" />{t('common.loading')}</div>
                ) : snapshot === null ? (
                  <div className="p-8 text-center text-text-tertiary text-sm">{t('pages.fileNotFound', { defaultValue: 'File not found at this commit.' })}</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle sticky top-0 bg-bg-secondary z-10">
                      <span className="text-2xs text-text-tertiary font-mono">{snapshot.split('\n').length} lines · {snapshot.length.toLocaleString()} bytes{blame && <span className="ml-2">· blame loaded</span>}</span>
                      <div className="flex items-center gap-2">
                        {blame && <button className={cn('icon-btn !w-5 !h-5', showBlame && '!text-accent')} onClick={() => setShowBlame(!showBlame)} title="Toggle blame gutter"><FileText size={11} /></button>}
                        {blame && showBlame && <button className={cn('text-2xs px-1.5 py-0.5 rounded border transition-colors', filterNoise ? 'bg-accent-muted text-accent border-accent/30' : 'text-text-tertiary border-border-subtle')} onClick={() => setFilterNoise(!filterNoise)} title="Toggle noise filter">⚙ Filter</button>}
                        <button className="btn btn-secondary text-2xs flex items-center gap-1" onClick={() => {
                          if (!selectedCommit) return;
                          const prompt = `Explain commit ${shortHash(selectedCommit.hash)}:\n\nSubject: ${selectedCommit.subject}\nAuthor: ${selectedCommit.author.name}\nDate: ${selectedCommit.author.date}\nFile: ${filePath}\n\nPlease explain in plain language:\n1. What was the purpose of this change to ${filePath}?\n2. What problem did it solve?\n3. Are there any risks or side effects in this file?`;
                          window.dispatchEvent(new CustomEvent('smartgit:ai-prompt', { detail: { prompt } }));
                        }} title="Ask AI to explain"><Sparkles size={10} /> AI</button>
                        <button className="icon-btn !w-5 !h-5" onClick={handleCopyContent} title="Copy"><Copy size={11} /></button>
                      </div>
                    </div>
                    <pre className="text-xs font-mono overflow-x-auto leading-relaxed">
                      {snapshot.split('\n').map((line, i) => {
                        const blameLine = blame?.lines[i];
                        const isNoise = blameLine ? (filterNoise && isNoiseCommit(blameLine.summary)) : false;
                        const ageColor = blameLine ? getAgeColor(blameLine.authorTime, selectedCommit?.author.date) : '';
                        return (
                          <div key={i} className={cn('flex hover:bg-bg-hover group', showBlame && blameLine && 'border-l-2', isNoise && 'opacity-50')} style={showBlame && blameLine ? { borderColor: ageColor } : undefined}>
                            {showBlame && blameLine && (
                              <span className={cn('text-2xs select-none flex-shrink-0 flex items-center gap-1 px-1 cursor-pointer hover:bg-bg-hover', isNoise && 'italic')} style={{ width: 90 }}
                                title={isNoise ? `⚠ Noise: ${blameLine.summary}\n${blameLine.author} · ${formatDate(blameLine.authorTime)}\nToggle Filter off to see raw blame.` : `${blameLine.author} · ${formatDate(blameLine.authorTime)}\n${blameLine.summary}`}
                                onClick={() => { const idx = commits.findIndex(c => c.hash.startsWith(blameLine.hash)); if (idx !== -1) setSelectedIdx(idx); }}>
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: isNoise ? '#9ca3af' : ageColor }} />
                                <span className={cn('truncate', isNoise ? 'text-text-tertiary' : 'text-text-secondary')}>{isNoise ? '⚙ ' : ''}{blameLine.author.split(' ')[0]}</span>
                              </span>
                            )}
                            <span className="text-text-tertiary text-2xs select-none w-10 text-right pr-2 flex-shrink-0">{i + 1}</span>
                            <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                          </div>
                        );
                      })}
                    </pre>
                  </>
                )}
              </div>
            ) : (
              <div className="h-full">
                {compareIdx === null ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-3">
                    <GitCommit size={32} className="opacity-40" />
                    <div className="text-sm">Shift+click a commit to set as base for comparison</div>
                    <div className="text-2xs text-text-tertiary">Base commit (left) → Selected commit (right) = what changed between them</div>
                  </div>
                ) : diffLoading ? (
                  <div className="flex items-center justify-center h-full text-text-tertiary"><Loader size={16} className="animate-spin mr-2" />{t('common.loading')}</div>
                ) : diffResult === null ? (
                  <div className="p-8 text-center text-text-tertiary text-sm">No differences found.</div>
                ) : (
                  <div>
                    {diffResult.hunks.map((hunk, hIdx) => {
                      const expanded = expandedHunks.has(hIdx);
                      return (
                        <div key={hIdx}>
                          <button className="w-full text-left bg-bg-tertiary text-text-tertiary px-3 py-1 text-2xs font-mono sticky top-0 cursor-pointer hover:bg-bg-hover border-b border-border-subtle flex items-center gap-1"
                            onClick={() => { const next = new Set(expandedHunks); if (next.has(hIdx)) next.delete(hIdx); else next.add(hIdx); setExpandedHunks(next); }}>
                            {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                            <span className="truncate">{hunk.header}</span>
                            <span className="ml-auto flex items-center gap-1"><span className="text-status-added">+{hunk.lines.filter(l => l.type === 'add').length}</span><span className="text-status-deleted">-{hunk.lines.filter(l => l.type === 'del').length}</span></span>
                          </button>
                          {expanded && (
                            <pre className="text-xs font-mono px-3 py-1 overflow-x-auto leading-tight">
                              {hunk.lines.map((line, lIdx) => (
                                <div key={lIdx} className={cn('px-1 flex', line.type === 'add' && 'bg-status-added/10 text-status-added', line.type === 'del' && 'bg-status-deleted/10 text-status-deleted', line.type === 'context' && 'text-text-secondary')}>
                                  <span className="text-text-tertiary text-2xs select-none w-8 text-right pr-2 flex-shrink-0">{line.oldLineNumber != null && line.oldLineNumber > 0 ? line.oldLineNumber : ''}</span>
                                  <span className="text-text-tertiary text-2xs select-none w-8 text-right pr-2 flex-shrink-0">{line.newLineNumber != null && line.newLineNumber > 0 ? line.newLineNumber : ''}</span>
                                  <span className="w-4 flex-shrink-0">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
                                  <span className="whitespace-pre-wrap break-all">{line.content || ' '}</span>
                                </div>
                              ))}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-1 border-t border-border-default bg-bg-secondary text-2xs text-text-tertiary flex items-center gap-3">
        <span><kbd className="border border-border-subtle rounded px-1">J</kbd>/<kbd className="border border-border-subtle rounded px-1">K</kbd> navigate</span>
        <span><kbd className="border border-border-subtle rounded px-1">S</kbd> snapshot</span>
        <span><kbd className="border border-border-subtle rounded px-1">D</kbd> diff</span>
        <span><kbd className="border border-border-subtle rounded px-1">Shift+click</kbd> compare base</span>
      </div>
    </div>
  );
}

// ─── Helper functions ──────────────────────────────────────────────────

function isNoiseCommit(summary: string): boolean {
  const s = summary.toLowerCase().trim();
  if (/^(format|black|prettier|lint|ruff|isort|autopep8|stylefix)$/.test(s)) return true;
  if (/\b(format|formatting|black|prettier|eslint|ruff|isort|autopep8|auto-format|whitespace|trailing|indent|style)\b/i.test(s)) return true;
  if (/\b(run|apply|fix)\s+(formatter?|lint|prettier|black|ruff)\b/i.test(s)) return true;
  if (/\b(organize|sort)\s+imports?\b/i.test(s)) return true;
  return false;
}

function getAgeColor(authorTime: string, selectedDate?: string): string {
  const lineTs = new Date(authorTime).getTime();
  if (isNaN(lineTs)) return '#6b7280';
  const refTs = selectedDate ? new Date(selectedDate).getTime() : Date.now();
  if (isNaN(refTs)) return '#6b7280';
  const diffMs = refTs - lineTs;
  const dayMs = 86400000;
  if (diffMs < 0) return '#6b7280';
  if (diffMs < dayMs) return '#4ade80';
  if (diffMs < 7 * dayMs) return '#84cc16';
  if (diffMs < 30 * dayMs) return '#eab308';
  if (diffMs < 90 * dayMs) return '#f97316';
  return '#6b7280';
}

function parseDiffOutput(raw: string): any[] {
  const hunks: any[] = [];
  let currentHunk: any = null;
  let oldLineNum = 0, newLineNum = 0;
  let oldStart = 0, newStart = 0, oldLines = 0, newLines = 0;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      oldStart = match ? parseInt(match[1], 10) : 0;
      oldLines = match && match[2] ? parseInt(match[2], 10) : 0;
      newStart = match && match[3] ? parseInt(match[3], 10) : 0;
      newLines = match && match[4] ? parseInt(match[4], 10) : 0;
      oldLineNum = oldStart - 1;
      newLineNum = newStart - 1;
      currentHunk = { header: line, oldStart, oldLines, newStart, newLines, lines: [] };
    } else if (currentHunk) {
      if (line.startsWith('+')) { newLineNum++; currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLineNumber: null, newLineNumber: newLineNum }); }
      else if (line.startsWith('-')) { oldLineNum++; currentHunk.lines.push({ type: 'del', content: line.substring(1), oldLineNumber: oldLineNum, newLineNumber: null }); }
      else if (line.startsWith(' ')) { oldLineNum++; newLineNum++; currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNumber: oldLineNum, newLineNumber: newLineNum }); }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}
