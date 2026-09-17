/**
 * FileHistoryViewer — shows the history of a specific file with:
 *   1. List of commits that changed the file (git log --follow -- <path>)
 *   2. File snapshot at selected commit (git show <hash>:<path>)
 *   3. Diff between two commits (base...compare)
 *   4. Actions: cherry-pick, create branch from commit, restore file
 *
 * Opened from HistoryPage → right-click a file → "View file history"
 * or from the toolbar when a file is selected.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitCommit, X, Loader, FileText, GitBranch, ArrowRight, ArrowDown,
  Plus, Minus, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Sparkles,
} from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastActions } from '../stores/toastStore';
import { api, type LogEntry, type DiffResult, type BlameResult } from '../lib/api';
import { Avatar } from './Avatar';
import MarkdownRenderer from './MarkdownRenderer';
import { cn, formatDate, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from './ConfirmDialog';

interface FileHistoryViewerProps {
  filePath: string;
  onClose: () => void;
}

interface CommitEntry extends LogEntry {
  /** Pre-fetched file diff for this commit (base = parent, head = commit). */
  fileDiff?: DiffResult;
  loadingDiff?: boolean;
}

export function FileHistoryViewer({ filePath, onClose }: FileHistoryViewerProps) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [compareIdx, setCompareIdx] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'snapshot' | 'diff'>('snapshot');
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());
  // Blame data for snapshot mode — shows age of each line.
  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [blameLoading, setBlameLoading] = useState(false);
  const [showBlame, setShowBlame] = useState(true);
  // Blame noise filter — when ON, commits that are pure formatting/linting
  // (black/prettier/eslint/ruff/isort, "format", "lint", "whitespace")
  // are hidden from the blame gutter. The gutter shows the REAL author
  // who wrote the logic, not the person who ran a formatter.
  const [filterNoise, setFilterNoise] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEscapeKey(true, onClose);

  // Load commits that changed this file (git log --follow -- <path>)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.log(repo.path, {
        maxCount: 200,
        follow: true,
        file: filePath,
      });
      setCommits(result);
      if (result.length > 0) setSelectedIdx(0);
    } catch (e) {
      toast.error('Failed to load file history', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, filePath, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load file snapshot at selected commit
  const loadSnapshot = useCallback(async (hash: string) => {
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

  // Load diff between two commits for this file
  const loadDiff = useCallback(async (baseHash: string, compareHash: string) => {
    setDiffLoading(true);
    setDiffResult(null);
    try {
      // Use diffBranches for the file-level diff, then post-process to
      // extract only hunks for this file. Or use raw git diff command
      // which is simpler for a single file.
      const diffOutput = await api.git.raw(repo.path, [
        'diff', baseHash, compareHash, '--', filePath,
      ]);
      // Parse the raw diff into DiffResult-like hunks
      const hunks = parseDiffOutput(diffOutput);
      setDiffResult({ hunks, files: [{ path: filePath, status: 'modified', additions: 0, deletions: 0 }] } as any);
    } catch {
      setDiffResult(null);
    } finally {
      setDiffLoading(false);
    }
  }, [repo.path, filePath]);

  // When selection changes, load snapshot or diff
  useEffect(() => {
    if (commits.length === 0 || selectedIdx >= commits.length) return;
    const commit = commits[selectedIdx];
    if (viewMode === 'snapshot') {
      void loadSnapshot(commit.hash);
    } else if (viewMode === 'diff' && compareIdx !== null && compareIdx < commits.length) {
      const base = commits[compareIdx];
      void loadDiff(base.hash, commit.hash);
    }
  }, [selectedIdx, compareIdx, viewMode, commits, loadSnapshot, loadDiff]);

  const selectedCommit = commits[selectedIdx];

  // Actions
  const handleCherryPick = async () => {
    if (!selectedCommit) return;
    if (!(await confirmDialog({
      title: t('history.cherryPickTitle', { hash: shortHash(selectedCommit.hash) }),
      message: t('history.cherryPickMessage', { subject: selectedCommit.subject }),
      confirmLabel: t('history.cherryPickAction'),
    }))) return;
    try {
      const result = await api.git.cherryPick(repo.path, [selectedCommit.hash]);
      if (result.conflicts.length > 0) {
        toast.warning(t('history.nConflicts', { count: result.conflicts.length }), t('history.cherryPickConflictsDetail'));
      } else if (result.empty) {
        toast.info(t('history.cherryPickEmpty'), t('history.cherryPickEmptyDetail'));
      } else {
        toast.success(t('toast.cherryPick.cherryPicked'));
      }
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('toast.cherryPick.failed'), String(e));
    }
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
    } catch (e) {
      toast.error(t('branches.failed'), String(e));
    }
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
    } catch (e) {
      toast.error(t('toast.git.checkoutFailed'), String(e));
    }
  };

  const handleCopyContent = () => {
    if (snapshot) {
      navigator.clipboard.writeText(snapshot);
      toast.success('File content copied to clipboard');
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(commits.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(0, i - 1));
      } else if (e.key === 's') {
        setViewMode('snapshot');
      } else if (e.key === 'd') {
        setViewMode('diff');
      }
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

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-bg-elevated border border-border-default rounded-lg shadow-2xl flex flex-col w-[95vw] h-[90vh] max-w-[1600px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-default bg-bg-secondary">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} className="text-accent flex-shrink-0" />
            <span className="text-sm font-medium truncate">{filePath}</span>
            <span className="text-2xs text-text-tertiary flex-shrink-0">
              {commits.length} commits · {t('pages.fileHistory', { defaultValue: 'File History' })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* View mode toggle */}
            <div className="flex bg-bg-tertiary rounded mr-2">
              <button
                className={cn('px-2 py-0.5 text-2xs rounded-l', viewMode === 'snapshot' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
                onClick={() => setViewMode('snapshot')}
                title={t('pages.fileSnapshot', { defaultValue: 'Show file at this commit' }) + ' (S)'}
              >
                {t('pages.snapshot', { defaultValue: 'Snapshot' })}
              </button>
              <button
                className={cn('px-2 py-0.5 text-2xs rounded-r', viewMode === 'diff' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
                onClick={() => setViewMode('diff')}
                title={t('pages.fileDiff', { defaultValue: 'Show diff between commits' }) + ' (D)'}
              >
                {t('pages.diff', { defaultValue: 'Diff' })}
              </button>
            </div>
            <button className="icon-btn" onClick={onClose} title={t('common.close')}>
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: commits list */}
          <div className="w-72 border-r border-border-default overflow-y-auto flex-shrink-0">
            <div className="px-3 py-1.5 text-2xs font-bold uppercase tracking-wider text-text-tertiary bg-bg-tertiary border-b border-border-subtle sticky top-0 z-10">
              {commits.length} {t('pages.commits', { defaultValue: 'commits' })}
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-text-tertiary">
                <Loader size={16} className="animate-spin mr-2" />
                {t('common.loading')}
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
                    if (e.shiftKey && viewMode === 'diff') {
                      setCompareIdx(idx);
                    } else {
                      setSelectedIdx(idx);
                    }
                  }}
                  title={e_shiftTitle()}
                >
                  <Avatar name={c.author.name} email={c.author.email} size={16} className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary truncate">{c.subject}</div>
                    <div className="flex items-center gap-1.5 text-2xs text-text-tertiary mt-0.5">
                      <span className="text-text-secondary">{c.author.name}</span>
                      <span>·</span>
                      <span>{formatDate(c.author.date)}</span>
                      <span>·</span>
                      <code className="mono">{shortHash(c.hash)}</code>
                      {idx === compareIdx && <span className="text-status-modified font-bold ml-1">[base]</span>}
                      {idx === selectedIdx && viewMode === 'diff' && compareIdx !== null && (
                        <span className="text-accent font-bold ml-1">[head]</span>
                      )}
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
              <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border-subtle bg-bg-tertiary">
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <code className="mono text-text-secondary">{shortHash(selectedCommit.hash)}</code>
                  <span>·</span>
                  <span>{selectedCommit.author.name}</span>
                  <span>·</span>
                  <span>{formatDate(selectedCommit.author.date)}</span>
                </div>
                <div className="flex-1" />
                {viewMode === 'diff' && compareIdx !== null && (
                  <div className="flex items-center gap-1 text-2xs text-text-tertiary">
                    <code className="mono">{shortHash(commits[compareIdx].hash)}</code>
                    <ArrowRight size={10} />
                    <code className="mono">{shortHash(selectedCommit.hash)}</code>
                    {stats && (
                      <span className="ml-2">
                        <span className="text-status-added">+{stats.additions}</span>
                        <span className="text-status-deleted">-{stats.deletions}</span>
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button className="btn btn-secondary text-xs flex items-center gap-1" onClick={handleCherryPick} title="Cherry-pick this commit">
                    <GitCommit size={11} /> Cherry-pick
                  </button>
                  <button className="btn btn-secondary text-xs flex items-center gap-1" onClick={handleCreateBranch} title="Create branch from this commit">
                    <GitBranch size={11} /> Branch
                  </button>
                  <button className="btn btn-secondary text-xs flex items-center gap-1" onClick={handleCheckoutDetached} title="Checkout (detached HEAD)">
                    <ArrowDown size={11} /> Checkout
                  </button>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-bg-secondary" ref={containerRef}>
              {viewMode === 'snapshot' ? (
                /* Snapshot view — file content at selected commit */
                <div className="h-full">
                  {snapshotLoading ? (
                    <div className="flex items-center justify-center h-full text-text-tertiary">
                      <Loader size={16} className="animate-spin mr-2" />
                      {t('common.loading')}
                    </div>
                  ) : snapshot === null ? (
                    <div className="p-8 text-center text-text-tertiary text-sm">
                      {t('pages.fileNotFound', { defaultValue: 'File not found at this commit (may have been deleted or not yet created).' })}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle sticky top-0 bg-bg-secondary z-10">
                        <span className="text-2xs text-text-tertiary font-mono">
                          {snapshot.split('\n').length} lines · {snapshot.length.toLocaleString()} bytes
                          {blame && <span className="ml-2">· blame loaded</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          {/* Blame toggle */}
                          {blame && (
                            <button
                              className={cn('icon-btn !w-5 !h-5', showBlame && '!text-accent')}
                              onClick={() => setShowBlame(!showBlame)}
                              title={showBlame ? 'Hide blame gutter' : 'Show blame gutter (line age + author)'}
                            >
                              <FileText size={11} />
                            </button>
                          )}
                          {/* Noise filter toggle — hide formatting/lint commits */}
                          {blame && showBlame && (
                            <button
                              className={cn('text-2xs px-1.5 py-0.5 rounded border transition-colors', filterNoise ? 'bg-accent-muted text-accent border-accent/30' : 'text-text-tertiary border-border-subtle hover:text-text-primary')}
                              onClick={() => setFilterNoise(!filterNoise)}
                              title={filterNoise ? 'Noise filter ON — hiding format/lint commits from blame' : 'Noise filter OFF — showing all commits'}
                            >
                              ⚙ Filter
                            </button>
                          )}
                          {/* AI Explain button */}
                          <button
                            className="btn btn-secondary text-2xs flex items-center gap-1"
                            onClick={() => {
                              const commit = selectedCommit;
                              if (!commit) return;
                              const parentHash = commit.parents?.[0] || `${commit.hash}^`;
                              const prompt = `Explain commit ${shortHash(commit.hash)}:

Subject: ${commit.subject}
Author: ${commit.author.name}
Date: ${commit.author.date}
File: ${filePath}

Please explain in plain language:
1. What was the purpose of this change to ${filePath}?
2. What problem did it solve?
3. Are there any risks or side effects in this file?`;
                              window.dispatchEvent(new CustomEvent('smartgit:ai-prompt', { detail: { prompt } }));
                            }}
                            title="Ask AI to explain this commit"
                          >
                            <Sparkles size={10} /> AI
                          </button>
                          <button className="icon-btn !w-5 !h-5" onClick={handleCopyContent} title="Copy file content">
                            <Copy size={11} />
                          </button>
                        </div>
                      </div>
                      <pre className="text-xs font-mono overflow-x-auto leading-relaxed">
                        {snapshot.split('\n').map((line, i) => {
                          const blameLine = blame?.lines[i];
                          const isNoise = blameLine ? (filterNoise && isNoiseCommit(blameLine.summary)) : false;
                          const ageColor = blameLine ? getAgeColor(blameLine.authorTime, selectedCommit?.author.date) : '';
                          const isBlameCommit = blameLine && commits.some(c => c.hash.startsWith(blameLine.hash));
                          return (
                            <div
                              key={i}
                              className={cn('flex hover:bg-bg-hover group', showBlame && blameLine && 'border-l-2', isNoise && 'opacity-50')}
                              style={showBlame && blameLine ? { borderColor: ageColor } : undefined}
                            >
                              {/* Blame gutter — age color bar + author */}
                              {showBlame && blameLine && (
                                <span
                                  className={cn('text-2xs select-none flex-shrink-0 flex items-center gap-1 px-1 cursor-pointer hover:bg-bg-hover', isNoise && 'italic')}
                                  style={{ width: 90 }}
                                  title={isNoise
                                    ? `⚠ Noise: ${blameLine.summary}\n${blameLine.author} · ${formatDate(blameLine.authorTime)}\nThis looks like a formatting/linting commit — toggle Filter off to see raw blame.`
                                    : `${blameLine.author} · ${formatDate(blameLine.authorTime)}\n${blameLine.summary}`
                                  }
                                  onClick={() => {
                                    if (!isBlameCommit) return;
                                    const idx = commits.findIndex(c => c.hash.startsWith(blameLine.hash));
                                    if (idx !== -1) setSelectedIdx(idx);
                                  }}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: isNoise ? '#9ca3af' : ageColor }} />
                                  <span className={cn('truncate', isNoise ? 'text-text-tertiary' : 'text-text-secondary')}>
                                    {isNoise ? '⚙ ' + blameLine.author.split(' ')[0] : blameLine.author.split(' ')[0]}
                                  </span>
                                </span>
                              )}
                              {/* Line number */}
                              <span className="text-text-tertiary text-2xs select-none w-10 text-right pr-2 flex-shrink-0">{i + 1}</span>
                              {/* Code */}
                              <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                            </div>
                          );
                        })}
                      </pre>
                    </>
                  )}
                </div>
              ) : (
                /* Diff view — between compare commit and selected commit */
                <div className="h-full">
                  {compareIdx === null ? (
                    <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-3">
                      <GitCommit size={32} className="opacity-40" />
                      <div className="text-sm">{t('pages.selectCompareCommit', { defaultValue: 'Shift+click a commit to set as base for comparison' })}</div>
                      <div className="text-2xs text-text-tertiary">
                        {t('pages.selectCompareHint', { defaultValue: 'Base commit (left) → Selected commit (right) = what changed between them' })}
                      </div>
                    </div>
                  ) : diffLoading ? (
                    <div className="flex items-center justify-center h-full text-text-tertiary">
                      <Loader size={16} className="animate-spin mr-2" />
                      {t('common.loading')}
                    </div>
                  ) : diffResult === null ? (
                    <div className="p-8 text-center text-text-tertiary text-sm">
                      {t('pages.noDiff', { defaultValue: 'No differences found between these commits.' })}
                    </div>
                  ) : (
                    <div>
                      {diffResult.hunks.map((hunk, hIdx) => {
                        const expanded = expandedHunks.has(hIdx);
                        return (
                          <div key={hIdx}>
                            <button
                              className="w-full text-left bg-bg-tertiary text-text-tertiary px-3 py-1 text-2xs font-mono sticky top-0 cursor-pointer hover:bg-bg-hover border-b border-border-subtle flex items-center gap-1"
                              onClick={() => {
                                const next = new Set(expandedHunks);
                                if (next.has(hIdx)) next.delete(hIdx);
                                else next.add(hIdx);
                                setExpandedHunks(next);
                              }}
                            >
                              {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                              <span className="truncate">{hunk.header}</span>
                              <span className="ml-auto flex items-center gap-1">
                                <span className="text-status-added">+{hunk.lines.filter(l => l.type === 'add').length}</span>
                                <span className="text-status-deleted">-{hunk.lines.filter(l => l.type === 'del').length}</span>
                              </span>
                            </button>
                            {expanded && (
                              <pre className="text-xs font-mono px-3 py-1 overflow-x-auto leading-tight">
                                {hunk.lines.map((line, lIdx) => (
                                  <div
                                    key={lIdx}
                                    className={cn(
                                      'px-1 flex',
                                      line.type === 'add' && 'bg-status-added/10 text-status-added',
                                      line.type === 'del' && 'bg-status-deleted/10 text-status-deleted',
                                      line.type === 'context' && 'text-text-secondary',
                                    )}
                                  >
                                    <span className="text-text-tertiary text-2xs select-none w-8 text-right pr-2 flex-shrink-0">
                                      {line.oldLineNumber != null && line.oldLineNumber > 0 ? line.oldLineNumber : ''}
                                    </span>
                                    <span className="text-text-tertiary text-2xs select-none w-8 text-right pr-2 flex-shrink-0">
                                      {line.newLineNumber != null && line.newLineNumber > 0 ? line.newLineNumber : ''}
                                    </span>
                                    <span className="w-4 flex-shrink-0">
                                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                                    </span>
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

        {/* Footer hint */}
        <div className="px-4 py-1.5 border-t border-border-default bg-bg-secondary text-2xs text-text-tertiary flex items-center gap-3">
          <span><kbd className="border border-border-subtle rounded px-1">J</kbd>/<kbd className="border border-border-subtle rounded px-1">K</kbd> navigate</span>
          <span><kbd className="border border-border-subtle rounded px-1">S</kbd> snapshot</span>
          <span><kbd className="border border-border-subtle rounded px-1">D</kbd> diff</span>
          <span><kbd className="border border-border-subtle rounded px-1">Shift+click</kbd> set compare base</span>
          <span className="ml-auto">{viewMode === 'diff' && compareIdx === null && 'Select a base commit (Shift+click) to compare'}</span>
        </div>
      </div>
    </div>
  );
}

function e_shiftTitle(): string {
  return 'Click to select · Shift+click to set as compare base';
}

/**
 * Compute a color for a blame line based on its age relative to the
 * selected commit. Fresh lines (changed in the selected commit or
 * shortly before) glow bright; old lines fade to gray.
 *
 * Color scale:
 *   Same commit     → #4ade80 (bright green — "this is the change")
 *   < 1 day before  → #84cc16 (lime)
 *   < 7 days before → #eab308 (yellow)
 *   < 30 days       → #f97316 (orange — getting stale)
 *   > 30 days       → #6b7280 (gray — old, stable code)
 */

/**
 * Detect if a commit is a "noise" commit — pure formatting/linting
 * with no business logic change.
 */
function isNoiseCommit(summary: string): boolean {
  const s = summary.toLowerCase().trim();
  if (/^(format|black|prettier|lint|ruff|isort|autopep8|stylefix)$/.test(s)) return true;
  if (/\b(format|formatting|black|prettier|eslint|ruff|isort|autopep8|auto-format|whitespace|trailing|indent|style)\b/i.test(s)) return true;
  if (/\b(run|apply|fix)\s+(formatter?|lint|prettier|black|ruff)\b/i.test(s)) return true;
  if (/\b(organize|sort)\s+imports?\b/i.test(s)) return true;
  return false;
}

/**
 * Compute a color for a blame line based on its age relative to the
 * selected commit. Fresh lines glow bright; old lines fade to gray.
 */
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

/** Parse raw git diff output into DiffResult-like hunks. */
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
      if (line.startsWith('+')) {
        newLineNum++;
        currentHunk.lines.push({ type: 'add', content: line.substring(1), oldLineNumber: null, newLineNumber: newLineNum });
      } else if (line.startsWith('-')) {
        oldLineNum++;
        currentHunk.lines.push({ type: 'del', content: line.substring(1), oldLineNumber: oldLineNum, newLineNumber: null });
      } else if (line.startsWith(' ')) {
        oldLineNum++; newLineNum++;
        currentHunk.lines.push({ type: 'context', content: line.substring(1), oldLineNumber: oldLineNum, newLineNumber: newLineNum });
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return hunks;
}
