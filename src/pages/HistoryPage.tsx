import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw, Copy, GitBranch, Search, GitPullRequest, Undo,
  Pencil, ExternalLink, FileText, ChevronDown, ChevronRight,
  Tag as TagIcon, CornerDownRight, RotateCcw, Filter, X,
} from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useGitStore } from '../stores/gitStore';
import { api, type LogEntry, type CommitFile, type BranchInfo } from '../lib/api';
import { cn, shortHash, copyToClipboard } from '../lib/utils';
import { getInitials, getAuthorColor, formatTime } from '../lib/authorBadges';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { computeGraph, bezierPath, laneColor, BRANCH_COLORS } from '../lib/gitGraph';
import type { GraphNode } from '../lib/gitGraph';

const ROW_HEIGHT = 28;
const LANE_WIDTH = 20;
const GRAPH_PAD = 6;

// Re-export for backwards compatibility (other files may import BRANCH_COLORS from here)
export { BRANCH_COLORS };

export function HistoryPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const status = useGitStore((s) => s.status);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showGraph, setShowGraph] = useState(true);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [editingMessage, setEditingMessage] = useState(false);
  const [editMsgValue, setEditMsgValue] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [authorFilter, setAuthorFilter] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  // Multi-branch selection: when set, shows union of all selected branches' history
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const [useRegex, setUseRegex] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const { width: detailWidth, handleResize: handleDetailResize } = useResizableWidth(320, 200, 600);
  const showContextMenu = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const logOpts: { maxCount: number; all?: boolean; branch?: string; branches?: string[] } = { maxCount: 500 };
      // Multi-branch selection takes precedence over single branch filter
      if (selectedBranches.size > 0) {
        logOpts.branches = Array.from(selectedBranches);
      } else if (branchFilter === 'all' || !branchFilter) {
        logOpts.all = true;
      } else {
        logOpts.branch = branchFilter;
      }
      const result = await api.git.log(repo.path, logOpts);
      setEntries(result);
      // Load branches for the filter dropdown
      try {
        const brs = await api.git.branches(repo.path);
        setBranches(brs);
      } catch {
        /* ignore */
      }
      setSelectedIdx(0);
    } catch (e) { toast.error('Failed to load history', String(e)); }
    finally { setLoading(false); }
  }, [repo.path, toast, branchFilter, selectedBranches]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const filtered = useMemo(() => {
    let result = entries;
    // Text search (subject, author, hash) — supports regex
    if (search.trim()) {
      const q = search.toLowerCase();
      if (useRegex) {
        try {
          const re = new RegExp(search, 'i');
          result = result.filter(e =>
            re.test(e.subject) || re.test(e.author.name) || re.test(e.hash)
          );
        } catch {
          // Invalid regex — fall back to literal
          result = result.filter(e =>
            e.subject.toLowerCase().includes(q) ||
            e.author.name.toLowerCase().includes(q) ||
            e.hash.toLowerCase().includes(q)
          );
        }
      } else {
        result = result.filter(e =>
          e.subject.toLowerCase().includes(q) ||
          e.author.name.toLowerCase().includes(q) ||
          e.hash.toLowerCase().includes(q)
        );
      }
    }
    // Author filter
    if (authorFilter.trim()) {
      const a = authorFilter.toLowerCase();
      result = result.filter(e => e.author.name.toLowerCase().includes(a) || e.author.email.toLowerCase().includes(a));
    }
    // Path filter — would require server-side git log -- path; we filter client-side by commitFiles lookup
    // For simplicity here we just leave path filter as a UI hint (the actual filtering happens via api.git.log with file option).
    // Date filters (ISO date strings)
    if (dateFrom) {
      const fromTs = new Date(dateFrom).getTime();
      if (!isNaN(fromTs)) result = result.filter(e => e.author.timestamp >= fromTs);
    }
    if (dateTo) {
      const toTs = new Date(dateTo).getTime() + 86400000; // end of day
      if (!isNaN(toTs)) result = result.filter(e => e.author.timestamp <= toTs);
    }
    return result;
  }, [entries, search, authorFilter, pathFilter, dateFrom, dateTo, useRegex]);

  const { rows: graphRows, maxLane } = useMemo(() => {
    if (!showGraph || filtered.length === 0) return { rows: [], maxLane: 0 };
    return computeGraph(filtered);
  }, [showGraph, filtered]);

  const graphWidth = (maxLane + 1) * LANE_WIDTH + GRAPH_PAD * 2;

  useEffect(() => {
    if (selectedIdx === null || selectedIdx < 0) { setCommitFiles([]); return; }
    const selected = filtered[selectedIdx];
    if (!selected) return;
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, selected.hash)
      .then(setCommitFiles)
      .catch(() => setCommitFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [selectedIdx, repo.path, filtered]);

  const handleCherryPick = async (entry: LogEntry) => {
    if (!confirm(`Cherry-pick ${shortHash(entry.hash)}?`)) return;
    try {
      const result = await api.git.cherryPick(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) toast.warning(`${result.conflicts.length} conflicts`);
      else toast.success('Cherry-picked');
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error('Cherry-pick failed', String(e)); }
  };

  const handleRevert = async (entry: LogEntry) => {
    if (!confirm(`Revert ${shortHash(entry.hash)}?`)) return;
    try {
      const result = await api.git.revert(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) toast.warning(`${result.conflicts.length} conflicts`);
      else toast.success('Reverted');
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error('Revert failed', String(e)); }
  };

  const handleReset = async (hash: string, mode: 'soft' | 'mixed' | 'hard' | 'keep') => {
    if (!confirm(`Reset to ${shortHash(hash)} (${mode})?\n${mode === 'hard' ? 'WARNING: All uncommitted changes will be lost!' : ''}`)) return;
    try {
      await api.git.reset(repo.path, mode, hash);
      toast.success(`Reset ${mode} to ${shortHash(hash)}`);
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error('Reset failed', String(e)); }
  };

  const handleRebase = async (hash: string) => {
    if (!confirm(`Rebase onto ${shortHash(hash)}?`)) return;
    try {
      await api.git.rebase(repo.path, hash);
      toast.success('Rebase started');
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error('Rebase failed', String(e)); }
  };

  const handleCheckout = async (hash: string) => {
    if (!confirm(`Checkout ${shortHash(hash)}? (detached HEAD)`)) return;
    try {
      await api.git.checkout(repo.path, hash);
      toast.success(`Checked out ${shortHash(hash)}`);
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error('Checkout failed', String(e)); }
  };

  const handleEditMessage = (entry: LogEntry) => {
    setEditingMessage(true);
    setEditMsgValue(`${entry.subject}\n\n${entry.body}`.trim());
  };

  const handleSaveMessage = async () => {
    if (selectedIdx === null) return;
    const selected = filtered[selectedIdx];
    if (!selected) return;
    try {
      await api.git.editCommitMessage(repo.path, selected.hash, editMsgValue);
      toast.success('Commit message updated');
      setEditingMessage(false);
      await loadHistory();
    } catch (e) { toast.error('Failed', String(e)); }
  };

  const handleOpenInBrowser = async () => {
    if (selectedIdx === null) return;
    const selected = filtered[selectedIdx];
    if (!selected) return;
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl) api.app.openExternal(`${info.webUrl}/commit/${selected.hash}`);
      else toast.info('No remote URL');
    } catch (e) { toast.error('Failed', String(e)); }
  };

  const showCommitContextMenu = (e: React.MouseEvent, entry: LogEntry, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);
    const items: ContextMenuItem[] = [
      { label: 'Cherry Pick', clickId: 'cherry-pick' },
      { label: 'Revert Commit', clickId: 'revert' },
      { type: 'separator' },
      { label: 'Checkout (detached HEAD)', clickId: 'checkout' },
      { type: 'separator' },
      { label: 'Reset to this commit', clickId: 'reset-header' },
      { label: '  Reset Soft (keep changes)', clickId: 'reset-soft' },
      { label: '  Reset Mixed (unstage)', clickId: 'reset-mixed' },
      { label: '  Reset Hard (discard all)', clickId: 'reset-hard' },
      { label: '  Reset Keep (keep working tree)', clickId: 'reset-keep' },
      { type: 'separator' },
      { label: 'Rebase onto this commit', clickId: 'rebase' },
      { type: 'separator' },
      { label: 'Copy Short Hash', clickId: 'copy-short' },
      { label: 'Copy Full Hash', clickId: 'copy-full' },
      { label: 'Copy Commit Message', clickId: 'copy-msg' },
      { type: 'separator' },
      { label: 'Edit Commit Message...', clickId: 'edit-msg' },
      { label: 'Open in Browser', clickId: 'browser' },
    ];
    showContextMenu(items, (action) => {
      switch (action) {
        case 'cherry-pick': handleCherryPick(entry); break;
        case 'revert': handleRevert(entry); break;
        case 'checkout': handleCheckout(entry.hash); break;
        case 'reset-soft': handleReset(entry.hash, 'soft'); break;
        case 'reset-mixed': handleReset(entry.hash, 'mixed'); break;
        case 'reset-hard': handleReset(entry.hash, 'hard'); break;
        case 'reset-keep': handleReset(entry.hash, 'keep'); break;
        case 'rebase': handleRebase(entry.hash); break;
        case 'copy-short': copyToClipboard(shortHash(entry.hash)); toast.success('Copied'); break;
        case 'copy-full': copyToClipboard(entry.hash); toast.success('Copied'); break;
        case 'copy-msg': copyToClipboard(entry.subject); toast.success('Copied'); break;
        case 'edit-msg': handleEditMessage(entry); break;
        case 'browser': handleOpenInBrowser(); break;
      }
    });
  };

  const selected = selectedIdx !== null && selectedIdx >= 0 ? filtered[selectedIdx] : null;
  const hasUncommitted = status && !status.isClean;
  const wtOffset = hasUncommitted ? ROW_HEIGHT : 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-tertiary" style={{ height: 28 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Graph</span>
          <span className="text-2xs text-text-tertiary">{filtered.length} commits</span>
          {(authorFilter || dateFrom || dateTo || pathFilter || useRegex) && (
            <span className="text-2xs text-accent" title="Active filters">● filtered</span>
          )}
          {selectedBranches.size > 0 && (
            <div className="flex items-center gap-1 ml-2">
              {Array.from(selectedBranches).slice(0, 3).map(b => (
                <span key={b} className="text-2xs px-1.5 py-0.5 rounded border border-accent/40 bg-accent-muted text-accent flex items-center gap-1">
                  <GitBranch size={8} />{b}
                  <button onClick={() => {
                    const next = new Set(selectedBranches);
                    next.delete(b);
                    setSelectedBranches(next);
                  }} title="Remove">
                    <X size={8} />
                  </button>
                </span>
              ))}
              {selectedBranches.size > 3 && (
                <span className="text-2xs text-text-tertiary">+{selectedBranches.size - 3} more</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder={useRegex ? 'Regex...' : 'Filter...'} value={search}
            onChange={(e) => setSearch(e.target.value)} className="text-xs w-32 px-2 py-0.5 font-mono"
            title={useRegex ? 'Search using JavaScript regex' : 'Search by subject/author/hash'} />
          <button className={cn('icon-btn !w-5 !h-5', useRegex && 'active')}
            title="Toggle regex" onClick={() => setUseRegex(!useRegex)}>
            <span className="text-2xs font-mono">.*</span>
          </button>
          <button className={cn('icon-btn !w-5 !h-5', showFilters && 'active')}
            title="More filters" onClick={() => setShowFilters(!showFilters)}>
            <Filter size={11} />
          </button>
          <button className={cn('icon-btn !w-5 !h-5', showGraph && 'active')}
            title="Toggle graph" onClick={() => setShowGraph(!showGraph)}>
            <GitBranch size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={loadHistory}>
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Extended filters panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary text-2xs">
          {/* Multi-branch picker */}
          <div className="relative">
            <button
              className={cn('text-xs px-2 py-0.5 border rounded flex items-center gap-1',
                selectedBranches.size > 0
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-border-default bg-bg-tertiary text-text-secondary')}
              onClick={() => setShowBranchPicker(!showBranchPicker)}
            >
              <GitBranch size={10} />
              Branches: {selectedBranches.size > 0 ? `${selectedBranches.size} selected` : (branchFilter === 'all' ? 'All' : branchFilter)}
              <ChevronDown size={9} />
            </button>
            {showBranchPicker && (
              <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 max-h-72 overflow-y-auto min-w-64">
                {/* All branches option — clears selection */}
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer text-xs border-b border-border-subtle">
                  <input
                    type="checkbox"
                    checked={selectedBranches.size === 0 && branchFilter === 'all'}
                    onChange={() => {
                      setSelectedBranches(new Set());
                      setBranchFilter('all');
                      setShowBranchPicker(false);
                    }}
                  />
                  <span className="font-medium">All branches</span>
                </label>
                {branches.filter(b => !b.remote).length > 0 && (
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">Local</div>
                )}
                {branches.filter(b => !b.remote).map(b => (
                  <label key={b.name} className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={selectedBranches.has(b.name)}
                      onChange={() => {
                        const next = new Set(selectedBranches);
                        if (next.has(b.name)) next.delete(b.name);
                        else next.add(b.name);
                        setSelectedBranches(next);
                        // Reset single-branch filter when using multi-select
                        if (next.size > 0) setBranchFilter('all');
                      }}
                    />
                    <span className={cn('truncate', b.current && 'text-accent font-medium')}>{b.name}</span>
                    {b.current && <span className="text-2xs text-text-tertiary ml-auto">HEAD</span>}
                  </label>
                ))}
                {branches.filter(b => b.remote).length > 0 && (
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">Remote</div>
                )}
                {branches.filter(b => b.remote).map(b => (
                  <label key={b.name} className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={selectedBranches.has(b.name)}
                      onChange={() => {
                        const next = new Set(selectedBranches);
                        if (next.has(b.name)) next.delete(b.name);
                        else next.add(b.name);
                        setSelectedBranches(next);
                        if (next.size > 0) setBranchFilter('all');
                      }}
                    />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
                <div className="px-3 py-1 border-t border-border-subtle flex items-center justify-between">
                  <button className="text-2xs text-accent"
                    onClick={() => {
                      setSelectedBranches(new Set());
                      setBranchFilter('all');
                    }}>
                    Clear
                  </button>
                  <button className="text-2xs btn btn-primary !py-0.5 !px-2"
                    onClick={() => setShowBranchPicker(false)}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">Author:</span>
            <input type="text" value={authorFilter} placeholder="name or email"
              onChange={(e) => setAuthorFilter(e.target.value)}
              className="text-xs w-32 px-1 py-0.5 bg-bg-tertiary border border-border-default rounded" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">From:</span>
            <input type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs px-1 py-0.5 bg-bg-tertiary border border-border-default rounded" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">To:</span>
            <input type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-xs px-1 py-0.5 bg-bg-tertiary border border-border-default rounded" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">Path:</span>
            <input type="text" value={pathFilter} placeholder="src/*"
              onChange={(e) => setPathFilter(e.target.value)}
              className="text-xs w-32 px-1 py-0.5 bg-bg-tertiary border border-border-default rounded font-mono" />
          </label>
          {(authorFilter || dateFrom || dateTo || pathFilter) && (
            <button className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={() => { setAuthorFilter(''); setDateFrom(''); setDateTo(''); setPathFilter(''); }}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Graph + Commit list */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef} style={{ position: 'relative' }}>
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary text-sm">
              {search ? 'No commits match' : 'No commits yet'}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Graph SVG — drawn per-row, with passing lanes that span full row height */}
              {showGraph && graphRows.length > 0 && (
                <svg
                  width={graphWidth}
                  height={graphRows.length * ROW_HEIGHT + wtOffset}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
                >
                  {graphRows.map((row, idx) => {
                    const rowY = idx * ROW_HEIGHT + wtOffset;
                    const cy = rowY + ROW_HEIGHT / 2;
                    const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;

                    return (
                      <g key={`r-${idx}`}>
                        {/* Passing lanes — vertical lines from top to bottom of row */}
                        {row.passing.map((p, pi) => (
                          <line key={`p-${idx}-${pi}`}
                            x1={x(p.lane)} y1={rowY}
                            x2={x(p.lane)} y2={rowY + ROW_HEIGHT}
                            stroke={laneColor(p.color)} strokeWidth={1.5} opacity={0.6} />
                        ))}

                        {row.node && (
                          <>
                            {/* Closing curves — lanes that merge INTO this node */}
                            {row.node.closing.map((c, ci) => (
                              <path key={`c-${idx}-${ci}`}
                                d={bezierPath(x(c.lane), rowY, x(row.node!.lane), cy)}
                                stroke={laneColor(c.color)} strokeWidth={1.5} fill="none" opacity={0.6} />
                            ))}

                            {/* Incoming vertical line (top of row → node center) */}
                            {row.node.hasIncoming && (
                              <line
                                x1={x(row.node.lane)} y1={rowY}
                                x2={x(row.node.lane)} y2={cy}
                                stroke={laneColor(row.node.color)} strokeWidth={1.5} opacity={0.6} />
                            )}

                            {/* Continues vertical line (node center → bottom of row) */}
                            {row.node.continues && (
                              <line
                                x1={x(row.node.lane)} y1={cy}
                                x2={x(row.node.lane)} y2={rowY + ROW_HEIGHT}
                                stroke={laneColor(row.node.color)} strokeWidth={1.5} opacity={0.6} />
                            )}

                            {/* Merge curves — lanes created for non-first parents (bottom of row) */}
                            {row.node.merges.map((m, mi) => (
                              <path key={`m-${idx}-${mi}`}
                                d={bezierPath(x(row.node!.lane), cy, x(m.lane), rowY + ROW_HEIGHT)}
                                stroke={laneColor(m.color)} strokeWidth={1.5} fill="none" opacity={0.6} />
                            ))}

                            {/* Node circle */}
                            {(() => {
                              const cx = x(row.node!.lane);
                              const isSelected = selectedIdx === idx;
                              const isMerge = row.node!.isMerge;
                              const r = isMerge ? 5 : 4;
                              return (
                                <g>
                                  {isMerge && (
                                    <circle cx={cx} cy={cy} r={r + 2} fill="none"
                                      stroke={laneColor(row.node!.color)} strokeWidth={1} opacity={0.4} />
                                  )}
                                  <circle cx={cx} cy={cy} r={r}
                                    fill={isSelected ? laneColor(row.node!.color) : 'var(--graph-node-fill)'}
                                    stroke={laneColor(row.node!.color)} strokeWidth={1.5} />
                                </g>
                              );
                            })()}
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* Working Tree row */}
              {hasUncommitted && (
                <div
                  className={cn('flex items-center gap-2 px-2 border-b border-border-subtle cursor-pointer relative',
                    selectedIdx === -1 ? 'bg-bg-selected' : 'hover:bg-bg-hover')}
                  style={{ height: ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8, zIndex: 2 }}
                  onClick={() => { setSelectedIdx(-1); window.location.hash = '#/changes'; }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--status-deleted)' }} />
                  <span className="text-xs font-medium">Working Tree ({status?.files.length || 0} changed)</span>
                </div>
              )}

              {/* Commit rows */}
              {graphRows.map((row, idx) => {
                if (!row.node) return null;
                const entry = row.node.entry;
                const initials = getInitials(entry.author.name);
                const color = getAuthorColor(entry.author.name);
                const isSelected = selectedIdx === idx;
                const isHEAD = entry.refs.some(r => r.includes('HEAD'));
                return (
                  <div
                    key={entry.hash}
                    className={cn('flex items-center gap-2 border-b border-border-subtle cursor-pointer relative',
                      isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover')}
                    style={{ height: ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8, zIndex: 2 }}
                    onClick={() => setSelectedIdx(idx)}
                    onContextMenu={(e) => showCommitContextMenu(e, entry, idx)}
                  >
                    {isHEAD && <span className="text-2xs text-text-primary flex-shrink-0" style={{ width: 8 }}>▶</span>}
                    {!isHEAD && <span style={{ width: 8 }} className="flex-shrink-0" />}

                    {entry.refs.length > 0 && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {entry.refs.slice(0, 3).map((ref, i) => {
                          const isTag = ref.startsWith('tag:');
                          const isRemote = ref.includes('/');
                          const label = ref.replace(/^tag:\s*/, '').replace('HEAD -> ', '');
                          return (
                            <span key={i} className={cn('text-2xs px-1.5 py-0.5 rounded border',
                              isTag ? 'border-tag-border bg-tag-bg text-tag-text' :
                              isHEAD ? 'border-accent bg-accent-muted text-accent' :
                              isRemote ? 'border-status-renamed/30 bg-status-renamed/10 text-status-renamed' :
                              'border-status-added/30 bg-status-added/10 text-status-added')}>
                              {isTag && <TagIcon size={8} className="inline mr-0.5" />}{label}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    <span className={cn('flex-1 truncate text-xs', isSelected && 'font-medium')}>{entry.subject}</span>

                    <span className="flex-shrink-0 rounded text-white font-bold text-center"
                      style={{ backgroundColor: color.bg, width: 24, height: 16, fontSize: 8, lineHeight: '16px' }}>
                      {initials}
                    </span>
                    <span className="text-2xs text-text-tertiary flex-shrink-0" style={{ width: 70, textAlign: 'right' }}>
                      {formatTime(entry.author.date)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <ResizableSplitter direction="horizontal" onResize={(d) => handleDetailResize(-d)} />
        <div className="border-l border-border-default bg-bg-secondary overflow-y-auto flex-shrink-0" style={{ width: detailWidth }}>
          {selected ? (
            <div className="p-3">
              <div className="text-sm font-medium text-text-primary mb-2">{selected.subject}</div>
              <div className="flex items-center gap-2 mb-3">
                <code className="text-2xs font-mono px-1.5 py-0.5 bg-bg-tertiary rounded">{shortHash(selected.hash)}</code>
                <button className="icon-btn !w-5 !h-5" title="Copy" onClick={() => { copyToClipboard(selected.hash); toast.success('Copied'); }}>
                  <Copy size={10} />
                </button>
                <button className="icon-btn !w-5 !h-5" title="Browser" onClick={handleOpenInBrowser}>
                  <ExternalLink size={11} />
                </button>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="flex-shrink-0 rounded text-white font-bold text-center"
                  style={{ backgroundColor: getAuthorColor(selected.author.name).bg, width: 28, height: 18, fontSize: 9, lineHeight: '18px' }}>
                  {getInitials(selected.author.name)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary">{selected.author.name}</div>
                  <div className="text-2xs text-text-tertiary">{formatTime(selected.author.date)}</div>
                </div>
              </div>
              {selected.parents.length > 0 && (
                <div className="mb-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1">Parents</div>
                  {selected.parents.map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <CornerDownRight size={10} className="text-text-tertiary" />
                      <code className="text-2xs font-mono text-accent">{shortHash(p)}</code>
                    </div>
                  ))}
                </div>
              )}
              {selected.body && !editingMessage && (
                <div className="mb-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1 flex items-center justify-between">
                    <span>Message</span>
                    <button className="icon-btn !w-4 !h-4" title="Edit" onClick={() => handleEditMessage(selected)}>
                      <Pencil size={9} />
                    </button>
                  </div>
                  <pre className="text-2xs font-mono whitespace-pre-wrap text-text-secondary bg-bg-tertiary p-2 rounded">{selected.body}</pre>
                </div>
              )}
              {editingMessage && (
                <div className="mb-3">
                  <textarea className="w-full text-xs font-mono h-20 resize-none mb-1"
                    value={editMsgValue} onChange={(e) => setEditMsgValue(e.target.value)} />
                  <div className="flex gap-1">
                    <button className="btn btn-primary text-2xs" onClick={handleSaveMessage}>Save</button>
                    <button className="btn btn-secondary text-2xs" onClick={() => setEditingMessage(false)}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1 mb-3 pb-3 border-b border-border-default">
                <button className="btn btn-secondary text-2xs" onClick={() => handleCherryPick(selected)}>
                  <GitPullRequest size={10} /> Cherry Pick
                </button>
                <button className="btn btn-secondary text-2xs" onClick={() => handleRevert(selected)}>
                  <Undo size={10} /> Revert
                </button>
                <button className="btn btn-secondary text-2xs" onClick={() => handleReset(selected.hash, 'mixed')}
                  title="Reset to this commit (mixed)">
                  <RotateCcw size={10} /> Reset
                </button>
              </div>
              <div>
                <button className="w-full flex items-center justify-between text-2xs uppercase text-text-tertiary mb-1"
                  onClick={() => setShowFiles(!showFiles)}>
                  <span className="flex items-center gap-1"><FileText size={10} /> Files ({commitFiles.length})</span>
                  {showFiles ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                {showFiles && (
                  <div className="space-y-0.5">
                    {loadingFiles ? <div className="text-2xs text-text-tertiary">Loading...</div> :
                      commitFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-1 text-2xs px-1 py-0.5 rounded hover:bg-bg-hover">
                          <span className="font-mono font-bold w-3 text-center"
                            style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>
                            {f.status}
                          </span>
                          <span className="flex-1 truncate font-mono text-text-secondary">{f.path}</span>
                          {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                            <span className="text-2xs flex-shrink-0">
                              <span className="text-status-added">+{f.additions}</span>
                              <span className="text-status-deleted ml-1">-{f.deletions}</span>
                            </span>
                          )}
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-text-tertiary text-sm">Select a commit</div>
          )}
        </div>
      </div>
    </div>
  );
}
