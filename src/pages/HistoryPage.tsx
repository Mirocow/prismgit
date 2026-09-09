import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitCommit,
  RefreshCw,
  Copy,
  GitBranch,
  Search,
  GitPullRequest,
  Undo,
  Pencil,
  ExternalLink,
  FileText,
  ChevronDown,
  ChevronRight,
  Tag as TagIcon,
  CornerDownRight,
} from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useGitStore } from '../stores/gitStore';
import { api, type LogEntry, type CommitFile } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { getInitials, getAuthorColor, formatTime } from '../lib/authorBadges';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { useWindowStyleStore } from '../components/WindowStyleSwitcher';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';

const BRANCH_COLORS = [
  '#5B9BD5', // Steel Blue
  '#C65911', // Brown/Orange
  '#548235', // Olive Green
  '#7030A0', // Purple
  '#BF9000', // Dark Yellow
  '#2E75B6', // Medium Blue
  '#C00000', // Dark Red
  '#385723', // Dark Green
  '#4472C4', // Blue
  '#E97132', // Orange
];

// MUST match the rowHeight used in GraphColumn and commit list rows
const ROW_HEIGHT = 28;
const GRAPH_LANE_WIDTH = 22;
const GRAPH_PADDING = 8;

interface CommitNode {
  entry: LogEntry;
  lane: number;
  parentLanes: number[];
  connections: { fromLane: number; toLane: number; color: string }[];
  color: string;
}

function computeGraphLanes(entries: LogEntry[]): CommitNode[] {
  const lanes: (string | null)[] = [];
  const hashToChildren = new Map<string, string[]>();

  for (const e of entries) {
    for (const p of e.parents) {
      const arr = hashToChildren.get(p) || [];
      arr.push(e.hash);
      hashToChildren.set(p, arr);
    }
  }

  const nodes: CommitNode[] = [];

  for (const entry of entries) {
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

    let color = BRANCH_COLORS[lane % BRANCH_COLORS.length];
    if (entry.refs.some((r) => r.includes('HEAD'))) color = '#2b2b2b';

    const parentLanes: number[] = [];
    const connections: { fromLane: number; toLane: number; color: string }[] = [];
    lanes[lane] = null;

    for (let pi = 0; pi < entry.parents.length; pi++) {
      const parentHash = entry.parents[pi];
      let parentLane = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === parentHash) { parentLane = i; break; }
      }
      if (parentLane === -1) {
        if (pi === 0) { parentLane = lane; lanes[lane] = parentHash; }
        else {
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
      });
    }
    nodes.push({ entry, lane, parentLanes, connections, color });
  }
  return nodes;
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
  const windowStyle = useWindowStyleStore((s) => s.style);
  const setWindowStyle = useWindowStyleStore((s) => s.setStyle);
  const showContextMenu = useContextMenu();

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.log(repo.path, { maxCount: 500, all: true });
      setEntries(result);
      setSelectedIdx(0);
    } catch (e) {
      toast.error('Failed to load history', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (selectedIdx === null) { setCommitFiles([]); return; }
    const selected = filtered[selectedIdx];
    if (!selected) return;
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, selected.hash)
      .then(setCommitFiles)
      .catch(() => setCommitFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [selectedIdx, repo.path, toast]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.author.name.toLowerCase().includes(q) ||
      e.hash.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const graphNodes = useMemo(() => {
    if (!showGraph) return [];
    return computeGraphLanes(filtered);
  }, [showGraph, filtered]);

  const maxLane = useMemo(() => {
    if (graphNodes.length === 0) return 0;
    return Math.max(0, ...graphNodes.map(n => n.lane), ...graphNodes.flatMap(n => n.parentLanes));
  }, [graphNodes]);

  const graphWidth = (maxLane + 1) * GRAPH_LANE_WIDTH + GRAPH_PADDING * 2;

  const handleCherryPick = async (entry: LogEntry) => {
    if (!confirm(`Cherry-pick ${shortHash(entry.hash)}?`)) return;
    try {
      const result = await api.git.cherryPick(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) toast.warning(`${result.conflicts.length} conflicts`, result.conflicts.join('\n'));
      else toast.success('Cherry-picked');
      await refreshStatus(repo.path);
      await loadHistory();
    } catch (e) { toast.error('Cherry-pick failed', String(e)); }
  };

  const handleRevert = async (entry: LogEntry) => {
    if (!confirm(`Revert ${shortHash(entry.hash)}?`)) return;
    try {
      const result = await api.git.revert(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) toast.warning(`${result.conflicts.length} conflicts`, result.conflicts.join('\n'));
      else toast.success('Reverted');
      await refreshStatus(repo.path);
      await loadHistory();
    } catch (e) { toast.error('Revert failed', String(e)); }
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

  const handleEditMessage = (entry: LogEntry) => {
    setEditingMessage(true);
    setEditMsgValue(`${entry.subject}\n\n${entry.body}`.trim());
  };

  const selected = selectedIdx !== null ? filtered[selectedIdx] : null;
  const hasUncommittedChanges = status && !status.isClean;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header with graph count + filter + window style switcher */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-tertiary" style={{ height: 28 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Graph</span>
          <span className="text-2xs text-text-tertiary">{filtered.length} commits</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs w-32 px-2 py-0.5"
          />
          <button
            className={cn('icon-btn !w-5 !h-5', showGraph && 'active')}
            title="Toggle graph"
            onClick={() => setShowGraph(!showGraph)}
          >
            <GitBranch size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={loadHistory}>
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Graph + Commit list — SINGLE scrollable container, rows aligned */}
        <div className="flex-1 overflow-y-auto" style={{ position: 'relative' }}>
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary text-sm">
              {search ? 'No commits match' : 'No commits yet'}
            </div>
          ) : (
            <>
              {/* Working Tree row */}
              {hasUncommittedChanges && (
                <div
                  className={cn(
                    'flex items-center gap-2 px-2 border-b border-border-subtle cursor-pointer',
                    selectedIdx === -1 ? 'bg-bg-selected' : 'hover:bg-bg-hover'
                  )}
                  style={{ height: ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8 }}
                  onClick={() => { setSelectedIdx(-1); window.location.hash = '#/changes'; }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--status-deleted)' }} />
                  <span className="text-xs font-medium text-text-primary">
                    Working Tree ({status?.files.length || 0} changed)
                  </span>
                </div>
              )}

              {/* Graph SVG overlay — absolutely positioned, aligned with rows */}
              {showGraph && graphNodes.length > 0 && (
                <svg
                  width={graphWidth}
                  height={graphNodes.length * ROW_HEIGHT}
                  style={{
                    position: 'absolute',
                    top: hasUncommittedChanges ? ROW_HEIGHT : 0,
                    left: 0,
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                >
                  {/* Connection lines */}
                  {graphNodes.map((node, idx) => {
                    const nextIdx = idx + 1;
                    const fromY = idx * ROW_HEIGHT + ROW_HEIGHT / 2;
                    return node.connections.map((conn, ci) => {
                      const targetNode = graphNodes[nextIdx];
                      if (!targetNode) return null;
                      const toY = nextIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const fromX = conn.fromLane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2 + GRAPH_PADDING;
                      const toX = conn.toLane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2 + GRAPH_PADDING;
                      const isDirect = conn.fromLane === conn.toLane;
                      return (
                        <path
                          key={`${idx}-${ci}`}
                          d={isDirect
                            ? `M ${fromX} ${fromY} L ${toX} ${toY}`
                            : `M ${fromX} ${fromY} C ${fromX} ${(fromY + toY) / 2}, ${toX} ${(fromY + toY) / 2}, ${toX} ${toY}`}
                          stroke={conn.color}
                          strokeWidth={1.5}
                          fill="none"
                          opacity={0.7}
                        />
                      );
                    });
                  })}
                  {/* Commit nodes */}
                  {graphNodes.map((node, idx) => {
                    const cx = node.lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2 + GRAPH_PADDING;
                    const cy = idx * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const isSelected = selectedIdx === idx;
                    const isMerge = node.entry.parents.length > 1;
                    return (
                      <g key={idx}>
                        {isMerge ? (
                          <>
                            <circle cx={cx} cy={cy} r={5} fill={node.color} stroke="var(--graph-node-border)" strokeWidth={1.5} />
                            <circle cx={cx} cy={cy} r={2} fill="var(--graph-node-fill)" />
                          </>
                        ) : isSelected ? (
                          <circle cx={cx} cy={cy} r={4.5} fill="var(--graph-node-selected)" stroke="var(--graph-node-border)" strokeWidth={1} />
                        ) : (
                          <circle cx={cx} cy={cy} r={4} fill="var(--graph-node-fill)" stroke={node.color} strokeWidth={1.5} />
                        )}
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* Commit rows — each row same height as graph nodes */}
              {graphNodes.map((node, idx) => {
                const entry = node.entry;
                const initials = getInitials(entry.author.name);
                const color = getAuthorColor(entry.author.name);
                const isSelected = selectedIdx === idx;
                const isHEAD = entry.refs.some(r => r.includes('HEAD'));
                return (
                  <div
                    key={entry.hash}
                    className={cn(
                      'flex items-center gap-2 border-b border-border-subtle cursor-pointer relative',
                      isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover'
                    )}
                    style={{ height: ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8, zIndex: 2 }}
                    onClick={() => setSelectedIdx(idx)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedIdx(idx);
                      const items: ContextMenuItem[] = [
                        { label: 'Cherry Pick', clickId: 'cherry-pick' },
                        { label: 'Revert', clickId: 'revert' },
                        { type: 'separator' },
                        { label: 'Copy Hash', clickId: 'copy-hash' },
                        { label: 'Copy Full Hash', clickId: 'copy-full-hash' },
                        { type: 'separator' },
                        { label: 'Edit Commit Message...', clickId: 'edit-message' },
                        { label: 'Open in Browser', clickId: 'open-browser' },
                      ];
                      showContextMenu(items, (action) => {
                        if (action === 'cherry-pick') handleCherryPick(entry);
                        else if (action === 'revert') handleRevert(entry);
                        else if (action === 'copy-hash') { copyToClipboard(shortHash(entry.hash)); toast.success('Hash copied'); }
                        else if (action === 'copy-full-hash') { copyToClipboard(entry.hash); toast.success('Full hash copied'); }
                        else if (action === 'edit-message') handleEditMessage(entry);
                        else if (action === 'open-browser') handleOpenInBrowser();
                      });
                    }}
                  >
                    {/* HEAD indicator */}
                    {isHEAD ? (
                      <span className="text-2xs text-text-primary flex-shrink-0" style={{ width: 8 }}>▶</span>
                    ) : (
                      <span style={{ width: 8 }} className="flex-shrink-0" />
                    )}

                    {/* Branch labels / tags */}
                    {entry.refs.length > 0 && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {entry.refs.slice(0, 3).map((ref, i) => {
                          const isTag = ref.startsWith('tag:');
                          const isHEAD = ref.includes('HEAD');
                          const isRemote = ref.includes('/');
                          const label = ref.replace(/^tag:\s*/, '').replace('HEAD -> ', '');
                          return (
                            <span
                              key={i}
                              className={cn(
                                'text-2xs px-1.5 py-0.5 rounded border',
                                isTag ? 'border-tag-border bg-tag-bg text-tag-text' :
                                isHEAD ? 'border-accent bg-accent-muted text-accent' :
                                isRemote ? 'border-status-renamed/30 bg-status-renamed/10 text-status-renamed' :
                                'border-status-added/30 bg-status-added/10 text-status-added'
                              )}
                            >
                              {isTag && <TagIcon size={8} className="inline mr-0.5" />}
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Message */}
                    <span className={cn('flex-1 truncate text-xs', isSelected && 'font-medium')}>
                      {entry.subject}
                    </span>

                    {/* Author badge */}
                    <span
                      className="flex-shrink-0 rounded text-white font-bold text-center"
                      style={{
                        backgroundColor: color.bg,
                        width: 24, height: 16,
                        fontSize: 8, lineHeight: '16px',
                      }}
                    >
                      {initials}
                    </span>

                    {/* Date */}
                    <span className="text-2xs text-text-tertiary flex-shrink-0" style={{ width: 70, textAlign: 'right' }}>
                      {formatTime(entry.author.date)}
                    </span>
                  </div>
                );
              })}
            </>
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
                <button className="icon-btn !w-5 !h-5" title="Copy hash" onClick={() => { copyToClipboard(selected.hash); toast.success('Copied'); }}>
                  <Copy size={10} />
                </button>
                <button className="icon-btn !w-5 !h-5" title="Open in browser" onClick={handleOpenInBrowser}>
                  <ExternalLink size={11} />
                </button>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="flex-shrink-0 rounded text-white font-bold text-center" style={{ backgroundColor: getAuthorColor(selected.author.name).bg, width: 28, height: 18, fontSize: 9, lineHeight: '18px' }}>
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
              {selected.body && (
                <div className="mb-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1">Message</div>
                  <pre className="text-2xs font-mono whitespace-pre-wrap text-text-secondary bg-bg-tertiary p-2 rounded">{selected.body}</pre>
                </div>
              )}
              <div className="flex flex-wrap gap-1 mb-3 pb-3 border-b border-border-default">
                <button className="btn btn-secondary text-2xs" onClick={() => handleCherryPick(selected)} title="Cherry-pick">
                  <GitPullRequest size={10} /> Cherry Pick
                </button>
                <button className="btn btn-secondary text-2xs" onClick={() => handleRevert(selected)} title="Revert">
                  <Undo size={10} /> Revert
                </button>
              </div>
              <div>
                <button className="w-full flex items-center justify-between text-2xs uppercase text-text-tertiary mb-1" onClick={() => setShowFiles(!showFiles)}>
                  <span className="flex items-center gap-1"><FileText size={10} /> Files ({commitFiles.length})</span>
                  {showFiles ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                {showFiles && (
                  <div className="space-y-0.5">
                    {loadingFiles ? (
                      <div className="text-2xs text-text-tertiary">Loading...</div>
                    ) : (
                      commitFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-1 text-2xs px-1 py-0.5 rounded hover:bg-bg-hover">
                          <span className="font-mono font-bold w-3 text-center" style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>{f.status}</span>
                          <span className="flex-1 truncate font-mono text-text-secondary">{f.path}</span>
                          {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                            <span className="text-2xs flex-shrink-0">
                              <span className="text-status-added">+{f.additions}</span>
                              <span className="text-status-deleted ml-1">-{f.deletions}</span>
                            </span>
                          )}
                        </div>
                      ))
                    )}
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
