import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader, GitCommit, CornerDownRight, ChevronDown, ChevronRight } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type LogEntry, type CommitFile } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';
import { computeOverlap, getOverlapScore, getOverlapColor, type OverlapInfo } from '../lib/overlap';
import { SMART_VIEWS, type SmartView } from '../lib/smartViews';

interface AnnotatePageProps {
  commitHash?: string;
}

export function AnnotatePage({ commitHash: initialHash }: AnnotatePageProps = {}) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [commits, setCommits] = useState<LogEntry[]>([]);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [overlapMap, setOverlapMap] = useState<Map<string, OverlapInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [activeSmartView, setActiveSmartView] = useState<SmartView>(SMART_VIEWS[0]);
  const [showSmartViews, setShowSmartViews] = useState(false);
  const [expandedOverlap, setExpandedOverlap] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.log(repo.path, {
        maxCount: activeSmartView.filter.limit || 100,
        all: activeSmartView.filter.showAll,
      });
      setCommits(result);

      // Load files for each commit (limited to first 50 for performance)
      const filesMap = new Map<string, CommitFile[]>();
      const overlapInput: LogEntry[] = [];
      for (const commit of result.slice(0, 50)) {
        try {
          const files = await api.git.commitFiles(repo.path, commit.hash);
          filesMap.set(commit.hash, files);
          overlapInput.push(commit);
        } catch {
          /* ignore */
        }
      }
      setOverlapMap(computeOverlap(overlapInput, filesMap));

      if (initialHash) {
        const found = result.find(c => c.hash.startsWith(initialHash));
        if (found) setSelected(found);
      } else if (result.length > 0 && !selected) {
        setSelected(result[0]);
      }
    } catch (e) {
      toast.error('Failed to load history', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, activeSmartView, toast, initialHash, selected]);

  useEffect(() => {
    load();
  }, [load]);

  // Load files when selected changes
  useEffect(() => {
    if (!selected) {
      setCommitFiles([]);
      return;
    }
    api.git.commitFiles(repo.path, selected.hash)
      .then(setCommitFiles)
      .catch(() => setCommitFiles([]));
  }, [selected, repo.path]);

  const overlapInfo = selected ? overlapMap.get(selected.hash) : undefined;
  const overlapScore = getOverlapScore(overlapInfo);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <FileText size={14} />
          <span className="text-sm font-medium">Annotate</span>
          <span className="text-2xs text-text-tertiary">
            Inline commit annotations with overlap analysis
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Smart Views dropdown */}
          <div className="relative">
            <button
              className="btn btn-secondary text-xs"
              onClick={() => setShowSmartViews(!showSmartViews)}
            >
              {showSmartViews ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {activeSmartView.label}
            </button>
            {showSmartViews && (
              <div className="absolute right-0 top-full mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-20 min-w-64">
                {SMART_VIEWS.map(view => (
                  <button
                    key={view.id}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs hover:bg-bg-hover',
                      activeSmartView.id === view.id && 'bg-bg-selected'
                    )}
                    onClick={() => {
                      setActiveSmartView(view);
                      setShowSmartViews(false);
                    }}
                  >
                    <div className="font-medium text-text-primary">{view.label}</div>
                    <div className="text-2xs text-text-tertiary">{view.description}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Commit list with Overlap column */}
        <div className="w-96 border-r border-border-default overflow-y-auto flex-shrink-0">
          {loading ? (
            <div className="p-4 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
              <Loader size={14} className="spin" />
              Loading...
            </div>
          ) : (
            commits.slice(0, 50).map((commit, idx) => {
              const info = overlapMap.get(commit.hash);
              const score = getOverlapScore(info);
              const color = getOverlapColor(score);
              const isExpanded = expandedOverlap === commit.hash;
              return (
                <div key={commit.hash}>
                  <div
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 cursor-pointer border-b border-border-subtle hover:bg-bg-hover',
                      selected?.hash === commit.hash && 'bg-bg-selected'
                    )}
                    onClick={() => setSelected(commit)}
                  >
                    <code className="text-2xs mono text-text-tertiary w-16 flex-shrink-0">
                      {shortHash(commit.hash)}
                    </code>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-primary truncate">{commit.subject}</div>
                      <div className="text-2xs text-text-tertiary">{commit.author.name}</div>
                    </div>
                    {/* Overlap indicator */}
                    {info && info.overlapCount > 0 && (
                      <button
                        className="flex items-center gap-1 text-2xs flex-shrink-0"
                        style={{ color }}
                        title={`${info.overlapCount} related commits`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedOverlap(isExpanded ? null : commit.hash);
                        }}
                      >
                        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        <span className="font-bold">{info.overlapCount}</span>
                      </button>
                    )}
                  </div>
                  {/* Expanded overlap details */}
                  {isExpanded && info && (
                    <div className="bg-bg-tertiary px-3 py-2 border-b border-border-subtle">
                      <div className="text-2xs text-text-tertiary mb-1">Related commits (shared files):</div>
                      {info.relatedCommits.slice(0, 5).map(rel => (
                        <div key={rel.hash} className="flex items-center gap-2 text-2xs py-0.5">
                          <CornerDownRight size={9} className="text-text-tertiary" />
                          <code className="mono text-accent">{shortHash(rel.hash)}</code>
                          <span className="text-text-secondary truncate flex-1">{rel.subject}</span>
                          <span className="text-text-tertiary">{rel.sharedFiles.length} files</span>
                        </div>
                      ))}
                      {info.relatedCommits.length > 5 && (
                        <div className="text-2xs text-text-tertiary mt-1">
                          +{info.relatedCommits.length - 5} more...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Detail panel with annotations */}
        <div className="flex-1 overflow-y-auto bg-bg-secondary">
          {selected ? (
            <div className="p-4">
              {/* Commit info */}
              <div className="mb-4">
                <div className="text-base font-medium text-text-primary mb-2">{selected.subject}</div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs mono px-2 py-1 bg-bg-tertiary rounded">
                    {selected.hash}
                  </code>
                </div>
                <div className="text-xs text-text-tertiary">
                  {selected.author.name} · {formatDate(selected.author.date)}
                </div>
              </div>

              {/* Overlap annotation */}
              {overlapInfo && overlapInfo.overlapCount > 0 && (
                <div className="mb-4 p-3 rounded border" style={{
                  borderColor: getOverlapColor(overlapScore),
                  backgroundColor: 'var(--bg-tertiary)',
                }}>
                  <div className="text-xs font-medium mb-2 flex items-center gap-2">
                    <GitCommit size={12} style={{ color: getOverlapColor(overlapScore) }} />
                    Overlap: {overlapInfo.overlapCount} related commits touching {overlapInfo.overlapFiles.length} files
                  </div>
                  <div className="text-2xs text-text-tertiary mb-2">
                    This commit shares files with the following commits:
                  </div>
                  <div className="space-y-1">
                    {overlapInfo.relatedCommits.slice(0, 5).map(rel => (
                      <div key={rel.hash} className="flex items-center gap-2 text-2xs">
                        <code className="mono text-accent">{shortHash(rel.hash)}</code>
                        <span className="text-text-secondary truncate flex-1">{rel.subject}</span>
                        <span className="text-text-tertiary">{rel.sharedFiles.length} shared</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files in this commit */}
              <div className="mb-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                  Files ({commitFiles.length})
                </div>
                <div className="space-y-1">
                  {commitFiles.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs px-2 py-1 rounded hover:bg-bg-hover"
                    >
                      <span
                        className="font-mono font-bold w-4 text-center"
                        style={{
                          color: file.status === 'A' ? 'var(--status-added)' :
                                 file.status === 'D' ? 'var(--status-deleted)' :
                                 file.status === 'R' ? 'var(--status-renamed)' :
                                 'var(--status-modified)'
                        }}
                      >
                        {file.status}
                      </span>
                      <code className="mono text-text-secondary flex-1 truncate">{file.path}</code>
                      {!file.binary && (file.additions > 0 || file.deletions > 0) && (
                        <span className="text-2xs">
                          <span className="text-status-added">+{file.additions}</span>
                          <span className="text-status-deleted ml-1">-{file.deletions}</span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Commit message body */}
              {selected.body && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
                    Message
                  </div>
                  <pre className="text-xs mono whitespace-pre-wrap text-text-secondary bg-bg-tertiary p-3 rounded">
                    {selected.body}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
              <FileText size={32} className="mb-2 opacity-50" />
              <div className="text-sm">Select a commit to view annotations</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
