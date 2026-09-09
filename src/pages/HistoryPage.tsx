import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitCommit,
  RefreshCw,
  Copy,
  GitBranch,
  Search,
  GitPullRequestArrow,
  Undo2,
  Pencil,
  ExternalLink,
  FileText,
  ChevronDown,
  ChevronRight,
  Tag as TagIcon,
  CornerDownRight,
} from 'lucide-react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useGitStore } from '../stores/gitStore';
import { api, type LogEntry, type CommitFile } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard, getStatusColor } from '../lib/utils';

const BRANCH_COLORS = [
  '#0e639c', // blue
  '#73c991', // green
  '#e2c08d', // yellow
  '#c74e39', // red
  '#69a4ff', // light blue
  '#aa66cc', // purple
  '#ff7a45', // orange
  '#00bcd4', // cyan
  '#e91e63', // pink
  '#9c27b0', // magenta
];

interface CommitNode {
  entry: LogEntry;
  lane: number;
  parentLanes: number[];
  // For each parent: which lanes it goes to
  connections: { fromLane: number; toLane: number; color: string }[];
  color: string;
}

function computeGraphLanes(entries: LogEntry[]): CommitNode[] {
  // Simple graph layout: assign each commit to a lane
  // Lane is freed when no children reference it
  const lanes: (string | null)[] = []; // lane -> hash occupying it (or null if free)
  const hashToLane = new Map<string, number>();
  const hashToChildren = new Map<string, string[]>();

  // Build child map
  for (const e of entries) {
    for (const p of e.parents) {
      const arr = hashToChildren.get(p) || [];
      arr.push(e.hash);
      hashToChildren.set(p, arr);
    }
  }

  const nodes: CommitNode[] = [];

  for (const entry of entries) {
    // Try to find an existing lane where this commit's hash is already placed
    // (means a child referenced this commit as parent)
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === entry.hash) {
        lane = i;
        break;
      }
    }

    if (lane === -1) {
      // Find a free lane
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === null) {
          lane = i;
          break;
        }
      }
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    // Determine the color: use the refs to pick a color, else from lane
    let color = BRANCH_COLORS[lane % BRANCH_COLORS.length];
    const refInfo = entry.refs.find((r) => r.includes('HEAD') || r.includes('origin/') || !r.startsWith('tag:'));
    if (refInfo && refInfo.includes('origin/')) {
      // Remote branches get a distinct color (orange-ish)
      color = '#ff7a45';
    } else if (entry.refs.some((r) => r.includes('HEAD ->'))) {
      color = '#69a4ff';
    }

    // Reserve lanes for parents
    const parentLanes: number[] = [];
    const connections: { fromLane: number; toLane: number; color: string }[] = [];

    // Mark current lane as free (we'll reassign to first parent)
    lanes[lane] = null;

    for (let pi = 0; pi < entry.parents.length; pi++) {
      const parentHash = entry.parents[pi];
      let parentLane: number;

      // Check if parent is already in a lane (multi-merge scenario)
      parentLane = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === parentHash) {
          parentLane = i;
          break;
        }
      }

      if (parentLane === -1) {
        // First parent goes into current lane (straight line)
        if (pi === 0) {
          parentLane = lane;
          lanes[lane] = parentHash;
        } else {
          // Find a free lane for other parents
          for (let i = 0; i < lanes.length; i++) {
            if (lanes[i] === null) {
              parentLane = i;
              break;
            }
          }
          if (parentLane === -1) {
            parentLane = lanes.length;
            lanes.push(null);
          }
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

    hashToLane.set(entry.hash, lane);
    nodes.push({
      entry,
      lane,
      parentLanes,
      connections,
      color,
    });
  }

  return nodes;
}

function GraphColumn({ nodes }: { nodes: CommitNode[] }) {
  const maxLane = Math.max(0, ...nodes.map((n) => n.lane), ...nodes.flatMap((n) => n.parentLanes));
  const laneWidth = 16;
  const rowHeight = 36;
  const width = (maxLane + 1) * laneWidth + 8;

  return (
    <div className="relative flex-shrink-0" style={{ width, minHeight: nodes.length * rowHeight }}>
      <svg
        width={width}
        height={nodes.length * rowHeight}
        className="block"
      >
        {/* Draw connection lines */}
        {nodes.map((node, idx) => {
          const nextIdx = idx + 1;
          const fromY = idx * rowHeight + rowHeight / 2;
          return node.connections.map((conn, ci) => {
            const targetNode = nodes[nextIdx];
            if (!targetNode) return null;
            const toY = nextIdx * rowHeight + rowHeight / 2;
            const fromX = conn.fromLane * laneWidth + laneWidth / 2 + 4;
            const toX = conn.toLane * laneWidth + laneWidth / 2 + 4;
            const isDirect = conn.fromLane === conn.toLane;
            return (
              <path
                key={`${idx}-${ci}`}
                d={isDirect ? `M ${fromX} ${fromY} L ${toX} ${toY}` : `M ${fromX} ${fromY} C ${fromX} ${(fromY + toY) / 2}, ${toX} ${(fromY + toY) / 2}, ${toX} ${toY}`}
                stroke={conn.color}
                strokeWidth={1.5}
                fill="none"
                opacity={0.7}
              />
            );
          });
        })}
        {/* Draw commit dots */}
        {nodes.map((node, idx) => {
          const cx = node.lane * laneWidth + laneWidth / 2 + 4;
          const cy = idx * rowHeight + rowHeight / 2;
          const isMerge = node.entry.parents.length > 1;
          return (
            <g key={idx}>
              <circle
                cx={cx}
                cy={cy}
                r={isMerge ? 6 : 4}
                fill={node.color}
                stroke="var(--bg-primary)"
                strokeWidth={1.5}
              />
              {isMerge && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={2}
                  fill="var(--bg-primary)"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function HistoryPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [search, setSearch] = useState('');
  const [showGraph, setShowGraph] = useState(true);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [editingMessage, setEditingMessage] = useState(false);
  const [editMsgValue, setEditMsgValue] = useState('');

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.log(repo.path, { maxCount: 500, all: true });
      setEntries(result);
    } catch (e) {
      toast.error('Failed to load history', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Load commit files when selecting
  useEffect(() => {
    if (!selected) {
      setCommitFiles([]);
      return;
    }
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, selected.hash)
      .then(setCommitFiles)
      .catch((e) => toast.error('Failed to load commit files', String(e)))
      .finally(() => setLoadingFiles(false));
  }, [selected, repo.path, toast]);

  const graphNodes = useMemo(() => {
    if (!showGraph) return [];
    return computeGraphLanes(filtered);
  }, [showGraph, entries, search]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        e.subject.toLowerCase().includes(q) ||
        e.author.name.toLowerCase().includes(q) ||
        e.hash.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const handleCherryPick = async (entry: LogEntry) => {
    if (!confirm(`Cherry-pick commit ${shortHash(entry.hash)} onto current branch?`)) return;
    try {
      const result = await api.git.cherryPick(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) {
        toast.warning(`Conflicts in ${result.conflicts.length} files`, result.conflicts.join('\n'));
      } else {
        toast.success('Cherry-picked successfully');
      }
      await refreshStatus(repo.path);
      await loadHistory();
    } catch (e) {
      toast.error('Cherry-pick failed', String(e));
    }
  };

  const handleRevert = async (entry: LogEntry) => {
    if (!confirm(`Revert commit ${shortHash(entry.hash)}? This creates a new commit that undoes the changes.`)) return;
    try {
      const result = await api.git.revert(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) {
        toast.warning(`Conflicts in ${result.conflicts.length} files`, result.conflicts.join('\n'));
      } else {
        toast.success('Reverted successfully');
      }
      await refreshStatus(repo.path);
      await loadHistory();
    } catch (e) {
      toast.error('Revert failed', String(e));
    }
  };

  const handleEditMessage = (entry: LogEntry) => {
    setEditingMessage(true);
    setEditMsgValue(`${entry.subject}\n\n${entry.body}`.trim());
  };

  const handleSaveMessage = async () => {
    if (!selected) return;
    try {
      await api.git.editCommitMessage(repo.path, selected.hash, editMsgValue);
      toast.success('Commit message updated');
      setEditingMessage(false);
      await loadHistory();
    } catch (e) {
      toast.error('Failed to edit message', String(e));
    }
  };

  const handleOpenInBrowser = async () => {
    if (!selected) return;
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        const commitUrl = `${info.webUrl}/commit/${selected.hash}`;
        api.app.openExternal(commitUrl);
      } else {
        toast.info('Repository has no remote URL');
      }
    } catch (e) {
      toast.error('Failed to open in browser', String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">History</span>
          <span className="text-2xs text-text-tertiary">{entries.length} commits</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search commits..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs w-56"
          />
          <button
            className={cn('icon-btn', showGraph && 'active')}
            title="Toggle graph"
            onClick={() => setShowGraph(!showGraph)}
          >
            <GitBranch size={13} />
          </button>
          <button className="icon-btn" title="Refresh" onClick={loadHistory}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="p-8 text-center text-text-tertiary text-sm">
              {search ? 'No commits match the search' : 'No commits yet'}
            </div>
          )}
          <div className="flex">
            {showGraph && !loading && filtered.length > 0 && (
              <div className="border-r border-border-subtle bg-bg-secondary">
                <GraphColumn nodes={graphNodes} />
              </div>
            )}
            <div className="flex-1">
              {filtered.map((entry, idx) => (
                <div
                  key={entry.hash}
                  className="group flex items-start gap-2 px-3 cursor-pointer border-b border-border-subtle hover:bg-bg-hover"
                  style={{ height: 36 }}
                  onClick={() => setSelected(entry)}
                >
                  <div className="flex-1 min-w-0 py-1">
                    <div className="text-sm text-text-primary truncate">
                      {entry.subject}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-text-tertiary">
                      <span className="font-medium text-text-secondary">
                        {entry.author.name}
                      </span>
                      <span>·</span>
                      <span>{formatDate(entry.author.date)}</span>
                      {entry.refs.length > 0 && (
                        <>
                          <span>·</span>
                          <div className="flex items-center gap-1 flex-wrap">
                            {entry.refs.map((ref, i) => (
                              <span
                                key={i}
                                className={cn(
                                  'badge',
                                  ref.startsWith('tag:')
                                    ? 'badge-modified'
                                    : ref.includes('HEAD')
                                    ? 'badge-renamed'
                                    : ref.includes('/')
                                    ? 'badge-renamed'
                                    : 'badge-added'
                                )}
                              >
                                {ref.includes('HEAD') && <GitBranch size={9} className="mr-0.5" />}
                                {ref.startsWith('tag:') && <TagIcon size={9} className="mr-0.5" />}
                                {ref.replace(/^tag:\s*/, '').replace('HEAD -> ', '')}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 py-1">
                    <code className="text-xs font-mono text-text-tertiary">
                      {shortHash(entry.hash)}
                    </code>
                    <button
                      className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5"
                      title="Copy hash"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(entry.hash);
                        toast.success('Hash copied');
                      }}
                    >
                      <Copy size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div className="w-96 border-l border-border-default bg-bg-secondary overflow-y-auto flex flex-col">
          {selected ? (
            <div className="p-4 flex-1 overflow-y-auto">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-base font-medium text-text-primary flex-1">
                  {selected.subject}
                </div>
                <button
                  className="icon-btn"
                  title="Open in browser"
                  onClick={handleOpenInBrowser}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <code className="text-xs font-mono px-2 py-1 bg-bg-tertiary rounded">
                  {selected.hash}
                </code>
                <button
                  className="icon-btn"
                  title="Copy"
                  onClick={() => {
                    copyToClipboard(selected.hash);
                    toast.success('Hash copied');
                  }}
                >
                  <Copy size={12} />
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
                {selected.body && !editingMessage && (
                  <div>
                    <div className="text-xs uppercase text-text-tertiary mb-1 flex items-center justify-between">
                      <span>Message</span>
                      <button
                        className="icon-btn !w-5 !h-5"
                        title="Edit commit message"
                        onClick={() => handleEditMessage(selected)}
                      >
                        <Pencil size={10} />
                      </button>
                    </div>
                    <pre className="text-xs font-mono whitespace-pre-wrap text-text-secondary bg-bg-tertiary p-2 rounded">
                      {selected.body}
                    </pre>
                  </div>
                )}
                {editingMessage && (
                  <div>
                    <div className="text-xs uppercase text-text-tertiary mb-1">Edit Message</div>
                    <textarea
                      className="w-full text-xs font-mono h-32 resize-none"
                      value={editMsgValue}
                      onChange={(e) => setEditMsgValue(e.target.value)}
                    />
                    <div className="flex gap-2 mt-1">
                      <button
                        className="btn btn-primary text-xs"
                        onClick={handleSaveMessage}
                      >
                        Save
                      </button>
                      <button
                        className="btn btn-secondary text-xs"
                        onClick={() => setEditingMessage(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 pt-4 border-t border-border-default">
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => handleCherryPick(selected)}
                    title="Cherry-pick onto current branch"
                  >
                    <GitPullRequestArrow size={11} />
                    Cherry Pick
                  </button>
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={() => handleRevert(selected)}
                    title="Create a revert commit"
                  >
                    <Undo2 size={11} />
                    Revert
                  </button>
                </div>
              </div>

              {/* Files */}
              <div className="mt-4 pt-4 border-t border-border-default">
                <button
                  className="w-full flex items-center justify-between text-xs uppercase text-text-tertiary mb-2"
                  onClick={() => setShowFiles(!showFiles)}
                >
                  <span className="flex items-center gap-1">
                    <FileText size={11} />
                    Files ({commitFiles.length})
                  </span>
                  {showFiles ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>
                {showFiles && (
                  <div className="space-y-1">
                    {loadingFiles ? (
                      <div className="text-xs text-text-tertiary">Loading files...</div>
                    ) : (
                      commitFiles.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-bg-hover"
                        >
                          <span
                            className="font-mono font-bold w-4 text-center"
                            style={{ color: getStatusColor(
                              f.status === 'A' ? 'added' :
                              f.status === 'D' ? 'deleted' :
                              f.status === 'R' ? 'renamed' :
                              f.status === 'C' ? 'copied' : 'modified'
                            ) }}
                          >
                            {f.status}
                          </span>
                          <span className="flex-1 truncate font-mono text-text-secondary">
                            {f.path}
                            {f.oldPath && (
                              <span className="text-text-tertiary"> ← {f.oldPath}</span>
                            )}
                          </span>
                          {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                            <span className="text-2xs flex-shrink-0">
                              <span className="text-status-added">+{f.additions}</span>
                              <span className="text-status-deleted ml-1">-{f.deletions}</span>
                            </span>
                          )}
                          {f.binary && <span className="text-2xs text-text-tertiary">binary</span>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-text-tertiary text-sm">
              Select a commit to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
