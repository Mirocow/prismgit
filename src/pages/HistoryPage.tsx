import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw, Copy, GitBranch, Search, GitPullRequest, Undo,
  Pencil, ExternalLink, FileText, ChevronDown, ChevronRight,
  Tag as TagIcon, CornerDownRight, RotateCcw,
} from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useGitStore } from '../stores/gitStore';
import { api, type LogEntry, type CommitFile } from '../lib/api';
import { cn, shortHash, copyToClipboard } from '../lib/utils';
import { getInitials, getAuthorColor, formatTime } from '../lib/authorBadges';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';

const BRANCH_COLORS = [
  '#399ee6', '#86b300', '#f07171', '#a37acc', '#4cbf99',
  '#f2ae49', '#55b4d4', '#e07b7b', '#7eb852', '#d4a05a',
];

const ROW_HEIGHT = 28;
const LANE_WIDTH = 20;
const GRAPH_PAD = 6;

interface CommitNode {
  entry: LogEntry;
  lane: number;
  parentLanes: number[];
  connections: { fromLane: number; toLane: number; color: string; isMerge: boolean }[];
  color: string;
}

function computeGraph(entries: LogEntry[]): { nodes: CommitNode[]; maxLane: number } {
  const lanes: (string | null)[] = [];
  const nodes: CommitNode[] = [];

  for (const entry of entries) {
    // Find existing lane for this commit
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === entry.hash) { lane = i; break; }
    }
    if (lane === -1) {
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === null) { lane = i; break; }
      }
      if (lane === -1) { lane = lanes.length; lanes.push(null); }
    }

    const color = BRANCH_COLORS[lane % BRANCH_COLORS.length];
    lanes[lane] = null; // Free this lane

    const parentLanes: number[] = [];
    const connections: { fromLane: number; toLane: number; color: string; isMerge: boolean }[] = [];

    for (let pi = 0; pi < entry.parents.length; pi++) {
      const parentHash = entry.parents[pi];
      let parentLane = -1;

      // Check if parent already has a lane
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === parentHash) { parentLane = i; break; }
      }

      if (parentLane === -1) {
        if (pi === 0) {
          // First parent: reuse current lane (straight line)
          parentLane = lane;
          lanes[lane] = parentHash;
        } else {
          // Other parents: find a free lane
          for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] === null) { parentLane = i; break; }
          }
          if (parentLane === -1) { parentLane = lanes.length; lanes.push(null); }
          lanes[parentLane] = parentHash;
        }
      }

      parentLanes.push(parentLane);
      connections.push({
        fromLane: lane,
        toLane: parentLane,
        color: pi === 0 ? color : BRANCH_COLORS[parentLane % BRANCH_COLORS.length],
        isMerge: pi > 0,
      });
    }

    nodes.push({ entry, lane, parentLanes, connections, color });
  }

  const maxLane = Math.max(0, ...nodes.map(n => n.lane), ...nodes.flatMap(n => n.parentLanes));
  return { nodes, maxLane };
}

export function HistoryPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const status = useGitStore((s) => s.status);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showGraph, setShowGraph] = useState(true);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [editingMessage, setEditingMessage] = useState(false);
  const [editMsgValue, setEditMsgValue] = useState('');
  const { width: detailWidth, handleResize: handleDetailResize } = useResizableWidth(320, 200, 600);
  const showContextMenu = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.log(repo.path, { maxCount: 500, all: true });
      setEntries(result);
      setSelectedIdx(0);
    } catch (e) { toast.error('Failed to load history', String(e)); }
    finally { setLoading(false); }
  }, [repo.path, toast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.author.name.toLowerCase().includes(q) ||
      e.hash.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const { nodes: graphNodes, maxLane } = useMemo(() => {
    if (!showGraph || filtered.length === 0) return { nodes: [], maxLane: 0 };
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
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder="Filter..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="text-xs w-32 px-2 py-0.5" />
          <button className={cn('icon-btn !w-5 !h-5', showGraph && 'active')}
            title="Toggle graph" onClick={() => setShowGraph(!showGraph)}>
            <GitBranch size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={loadHistory}>
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

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
              {/* Graph SVG */}
              {showGraph && graphNodes.length > 0 && (
                <svg
                  width={graphWidth}
                  height={graphNodes.length * ROW_HEIGHT + wtOffset}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}
                >
                  {/* Lines */}
                  {graphNodes.map((node, idx) => {
                    const y = idx * ROW_HEIGHT + ROW_HEIGHT / 2 + wtOffset;
                    return node.connections.map((conn, ci) => {
                      const nextNode = graphNodes[idx + 1];
                      if (!nextNode) return null;
                      const nextY = (idx + 1) * ROW_HEIGHT + ROW_HEIGHT / 2 + wtOffset;
                      const fromX = conn.fromLane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                      const toX = conn.toLane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                      if (conn.fromLane === conn.toLane) {
                        return <line key={`l-${idx}-${ci}`} x1={fromX} y1={y} x2={toX} y2={nextY}
                          stroke={conn.color} strokeWidth={1.5} opacity={0.6} />;
                      }
                      // Curve for merges
                      const midY = (y + nextY) / 2;
                      return <path key={`l-${idx}-${ci}`}
                        d={`M ${fromX} ${y} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${nextY}`}
                        stroke={conn.color} strokeWidth={1.5} fill="none" opacity={0.6} />;
                    });
                  })}
                  {/* Nodes */}
                  {graphNodes.map((node, idx) => {
                    const cx = node.lane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                    const cy = idx * ROW_HEIGHT + ROW_HEIGHT / 2 + wtOffset;
                    const isSelected = selectedIdx === idx;
                    const isMerge = node.entry.parents.length > 1;
                    const r = isMerge ? 5 : 4;
                    return (
                      <g key={`n-${idx}`}>
                        {isMerge && (
                          <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke={node.color} strokeWidth={1} opacity={0.4} />
                        )}
                        <circle cx={cx} cy={cy} r={r}
                          fill={isSelected ? node.color : 'var(--graph-node-fill)'}
                          stroke={node.color} strokeWidth={1.5} />
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
              {graphNodes.map((node, idx) => {
                const entry = node.entry;
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
