import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitBranch, RefreshCw, GitCommit, CornerDownRight,
  ChevronDown, ChevronRight, Tag as TagIcon, Search,
} from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type LogEntry, type CommitFile } from '../lib/api';
import { cn, shortHash, formatDate } from '../lib/utils';
import { getInitials, getAuthorColor, formatTime } from '../lib/authorBadges';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';

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
  connections: { fromLane: number; toLane: number; color: string }[];
  color: string;
}

function computeGraph(entries: LogEntry[]): { nodes: CommitNode[]; maxLane: number } {
  const lanes: (string | null)[] = [];
  const nodes: CommitNode[] = [];
  for (const entry of entries) {
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) { if (lanes[i] === entry.hash) { lane = i; break; } }
    if (lane === -1) {
      for (let i = 0; i < lanes.length; i++) { if (lanes[i] === null) { lane = i; break; } }
      if (lane === -1) { lane = lanes.length; lanes.push(null); }
    }
    const color = BRANCH_COLORS[lane % BRANCH_COLORS.length];
    lanes[lane] = null;
    const connections: { fromLane: number; toLane: number; color: string }[] = [];
    for (let pi = 0; pi < entry.parents.length; pi++) {
      const parentHash = entry.parents[pi];
      let parentLane = -1;
      for (let i = 0; i < lanes.length; i++) { if (lanes[i] === parentHash) { parentLane = i; break; } }
      if (parentLane === -1) {
        if (pi === 0) { parentLane = lane; lanes[lane] = parentHash; }
        else {
          for (let i = 0; i < lanes.length; i++) { if (lanes[i] === null) { parentLane = i; break; } }
          if (parentLane === -1) { parentLane = lanes.length; lanes.push(null); }
          lanes[parentLane] = parentHash;
        }
      }
      connections.push({ fromLane: lane, toLane: parentLane, color: pi === 0 ? color : BRANCH_COLORS[parentLane % BRANCH_COLORS.length] });
    }
    nodes.push({ entry, lane, connections, color });
  }
  const maxLane = Math.max(0, ...nodes.map(n => n.lane), ...nodes.flatMap(n => n.connections.map(c => c.toLane)));
  return { nodes, maxLane };
}

export function AnnotatePage() {
  const repo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastStore();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const { width: detailWidth, handleResize: handleDetailResize } = useResizableWidth(320, 200, 600);

  const loadHistory = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      // Use a smaller maxCount for annotate (it's a per-file annotation tool, not full history)
      const result = await api.git.log(repo.path, { maxCount: 100, all: true });
      setEntries(result);
      setSelectedIdx(0);
      // Do NOT fetch file counts for every commit — that caused N parallel IPC calls
      // and was the main reason Annotate felt slow. Instead, we'll fetch file count
      // only when a commit is selected (lazy load).
      setFileCounts({});
    } catch (e) { toast.error('Failed to load history', String(e)); }
    finally { setLoading(false); }
  }, [repo, toast]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Lazy-load file count for the selected commit only
  useEffect(() => {
    if (!repo || selectedIdx === null || selectedIdx < 0) return;
    const entry = entries[selectedIdx];
    if (!entry) return;
    if (fileCounts[entry.hash] !== undefined) return; // already loaded
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, entry.hash)
      .then(files => setFileCounts(prev => ({ ...prev, [entry.hash]: files.length })))
      .catch(() => setFileCounts(prev => ({ ...prev, [entry.hash]: 0 })))
      .finally(() => setLoadingFiles(false));
  }, [repo, selectedIdx, entries, fileCounts]);

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
    if (filtered.length === 0) return { nodes: [], maxLane: 0 };
    return computeGraph(filtered);
  }, [filtered]);

  const graphWidth = (maxLane + 1) * LANE_WIDTH + GRAPH_PAD * 2;

  useEffect(() => {
    if (!repo || selectedIdx === null || selectedIdx < 0) { setCommitFiles([]); return; }
    const selected = filtered[selectedIdx];
    if (!selected) return;
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, selected.hash)
      .then(setCommitFiles)
      .catch(() => setCommitFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [selectedIdx, repo, filtered]);

  const selected = selectedIdx !== null && selectedIdx >= 0 ? filtered[selectedIdx] : null;

  if (!repo) {
    return <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">No repository open</div>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-tertiary" style={{ height: 28 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Annotate</span>
          <span className="text-2xs text-text-tertiary">{filtered.length} commits · file counts loaded for first 30</span>
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder="Filter..." value={search}
            onChange={(e) => setSearch(e.target.value)} className="text-xs w-32 px-2 py-0.5" />
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={loadHistory}>
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Commit list with file count annotations */}
        <div className="flex-1 overflow-y-auto" style={{ position: 'relative' }}>
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary text-sm">No commits</div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Graph SVG */}
              {graphNodes.length > 0 && (
                <svg width={graphWidth} height={graphNodes.length * ROW_HEIGHT}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}>
                  {graphNodes.map((node, idx) => {
                    const y = idx * ROW_HEIGHT + ROW_HEIGHT / 2;
                    return node.connections.map((conn, ci) => {
                      const nextNode = graphNodes[idx + 1];
                      if (!nextNode) return null;
                      const nextY = (idx + 1) * ROW_HEIGHT + ROW_HEIGHT / 2;
                      const fromX = conn.fromLane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                      const toX = conn.toLane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                      if (conn.fromLane === conn.toLane)
                        return <line key={`l-${idx}-${ci}`} x1={fromX} y1={y} x2={toX} y2={nextY} stroke={conn.color} strokeWidth={1.5} opacity={0.6} />;
                      const midY = (y + nextY) / 2;
                      return <path key={`l-${idx}-${ci}`} d={`M ${fromX} ${y} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${nextY}`} stroke={conn.color} strokeWidth={1.5} fill="none" opacity={0.6} />;
                    });
                  })}
                  {graphNodes.map((node, idx) => {
                    const cx = node.lane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                    const cy = idx * ROW_HEIGHT + ROW_HEIGHT / 2;
                    const isSelected = selectedIdx === idx;
                    const isMerge = node.entry.parents.length > 1;
                    return <g key={`n-${idx}`}>
                      {isMerge && <circle cx={cx} cy={cy} r={7} fill="none" stroke={node.color} strokeWidth={1} opacity={0.4} />}
                      <circle cx={cx} cy={cy} r={isMerge ? 5 : 4}
                        fill={isSelected ? node.color : 'var(--graph-node-fill)'} stroke={node.color} strokeWidth={1.5} />
                    </g>;
                  })}
                </svg>
              )}

              {/* Commit rows with file count annotation */}
              {graphNodes.map((node, idx) => {
                const entry = node.entry;
                const initials = getInitials(entry.author.name);
                const color = getAuthorColor(entry.author.name);
                const isSelected = selectedIdx === idx;
                const fileCount = fileCounts[entry.hash];
                const isHEAD = entry.refs.some(r => r.includes('HEAD'));
                return (
                  <div key={entry.hash}
                    className={cn('flex items-center gap-2 border-b border-border-subtle cursor-pointer relative',
                      isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover')}
                    style={{ height: ROW_HEIGHT, paddingLeft: graphWidth + 8, zIndex: 2 }}
                    onClick={() => setSelectedIdx(idx)}>
                    {isHEAD && <span className="text-2xs text-text-primary flex-shrink-0" style={{ width: 8 }}>▶</span>}
                    {!isHEAD && <span style={{ width: 8 }} className="flex-shrink-0" />}
                    {/* File count annotation badge */}
                    {fileCount !== undefined && fileCount > 0 && (
                      <span className="text-2xs px-1 py-0 rounded bg-accent-muted text-accent flex-shrink-0" style={{ minWidth: 20, textAlign: 'center' }}>
                        {fileCount}
                      </span>
                    )}
                    {entry.refs.length > 0 && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {entry.refs.slice(0, 2).map((ref, i) => {
                          const isTag = ref.startsWith('tag:');
                          const label = ref.replace(/^tag:\s*/, '').replace('HEAD -> ', '');
                          return <span key={i} className={cn('text-2xs px-1 py-0.5 rounded border',
                            isTag ? 'border-tag-border bg-tag-bg text-tag-text' : 'border-accent bg-accent-muted text-accent')}>
                            {label}
                          </span>;
                        })}
                      </div>
                    )}
                    <span className={cn('flex-1 truncate text-xs', isSelected && 'font-medium')}>{entry.subject}</span>
                    <span className="flex-shrink-0 rounded author-badge text-center"
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
              <div className="text-sm font-medium mb-2">{selected.subject}</div>
              <div className="flex items-center gap-2 mb-3">
                <code className="text-2xs font-mono px-1.5 py-0.5 bg-bg-tertiary rounded">{shortHash(selected.hash)}</code>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="flex-shrink-0 rounded author-badge text-center"
                  style={{ backgroundColor: getAuthorColor(selected.author.name).bg, width: 28, height: 18, fontSize: 9, lineHeight: '18px' }}>
                  {getInitials(selected.author.name)}
                </span>
                <div>
                  <div className="text-xs">{selected.author.name}</div>
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
              {/* Files with status annotations */}
              <div className="mt-3 pt-3 border-t border-border-default">
                <div className="text-2xs uppercase text-text-tertiary mb-2">
                  Files ({commitFiles.length})
                </div>
                {loadingFiles ? <div className="text-2xs text-text-tertiary">Loading...</div> :
                  commitFiles.length === 0 ? <div className="text-2xs text-text-tertiary">No files</div> :
                  commitFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-2xs py-0.5">
                      <span className="font-mono font-bold w-4 text-center"
                        style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>
                        {f.status}
                      </span>
                      <span className="flex-1 truncate font-mono text-text-secondary">{f.path}</span>
                      {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                        <span className="flex-shrink-0">
                          <span className="text-status-added">+{f.additions}</span>
                          <span className="text-status-deleted ml-1">-{f.deletions}</span>
                        </span>
                      )}
                    </div>
                  ))
                }
              </div>
            </div>
          ) : <div className="p-4 text-center text-text-tertiary text-sm">Select a commit</div>}
        </div>
      </div>
    </div>
  );
}
