import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitBranch, RefreshCw, GitCommit, CornerDownRight,
  ChevronDown, ChevronRight, Tag as TagIcon, Search,
} from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type LogEntry, type CommitFile } from '../lib/api';
import { cn, shortHash, formatDate, copyToClipboard } from '../lib/utils';
import { getInitials, getAuthorColor, formatTime } from '../lib/authorBadges';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { computeGraph, bezierPath, laneColor } from '../lib/gitGraph';
import { useLazyList } from '../lib/useLazyList';
import { useI18n } from '../lib/i18n';

const ROW_HEIGHT = 28;
const LANE_WIDTH = 20;
const GRAPH_PAD = 6;

export function AnnotatePage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastActions();
  const showContextMenu = useContextMenu();
  // Global selection — sync with History and other tools
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const globalPathFilter = useSelectionStore((s) => s.pathFilter);

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(0);
  const [search, setSearch] = useState('');
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const [showFiles, setShowFiles] = useState(true);
  const { width: detailWidth, handleResize: handleDetailResize } = useResizableWidth(320, 200, 600);

  const loadHistory = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const logOpts: { maxCount: number; all?: boolean; file?: string; follow?: boolean } = { maxCount: 200, all: true };
      if (globalPathFilter) {
        logOpts.file = globalPathFilter;
        logOpts.follow = true;
      }
      const result = await api.git.log(repo.path, logOpts);
      setEntries(result);
      setSelectedIdx(0);
      if (result.length > 0) selectCommit(result[0].hash);
      setFileCounts({});
    } catch (e) { toast.error(t('pages.annotateLoadFailed'), String(e)); }
    finally { setLoading(false); }
  }, [repo, toast, globalPathFilter, selectCommit]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Auto-expand Files when file filter is active
  useEffect(() => {
    if (globalPathFilter) setShowFiles(true);
  }, [globalPathFilter]);

  // Lazy-load file count for the selected commit only
  useEffect(() => {
    if (!repo || selectedIdx === null || selectedIdx < 0) return;
    const entry = entries[selectedIdx];
    if (!entry) return;
    if (fileCounts[entry.hash] !== undefined) return;
    api.git.commitFiles(repo.path, entry.hash)
      .then(files => setFileCounts(prev => ({ ...prev, [entry.hash]: files.length })))
      .catch(() => setFileCounts(prev => ({ ...prev, [entry.hash]: 0 })));
  }, [repo, selectedIdx, entries, fileCounts]);

  // Load commit files when selection changes — uses filteredRef to avoid hoisting issues
  const filteredRef = useRef<LogEntry[]>([]);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.author.name.toLowerCase().includes(q) ||
      e.hash.toLowerCase().includes(q)
    );
  }, [entries, search]);
  filteredRef.current = filtered;

  // Load commit files when selection changes
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

  const { rows: graphRows, maxLane } = useMemo(() => {
    if (filtered.length === 0) return { rows: [], maxLane: 0 };
    return computeGraph(filtered);
  }, [filtered]);

  const graphWidth = (maxLane + 1) * LANE_WIDTH + GRAPH_PAD * 2;

  // Virtualize the commit list
  const lazyList = useLazyList({
    itemCount: graphRows.length,
    estimateRowHeight: ROW_HEIGHT,
    overscan: 12,
  });
  const scrollToIndexRef = useRef<((idx: number) => void) | null>(null);
  scrollToIndexRef.current = lazyList.scrollToIndex;

  // Auto-scroll to selected commit when global selection changes from another tool
  useEffect(() => {
    if (!selectedCommitHash || entries.length === 0) return;
    const idx = entries.findIndex(e => e.hash === selectedCommitHash);
    if (idx >= 0 && idx !== selectedIdx) {
      setSelectedIdx(idx);
      requestAnimationFrame(() => scrollToIndexRef.current?.(idx));
    }
  }, [selectedCommitHash, entries, selectedIdx]);

  const selected = selectedIdx !== null && selectedIdx >= 0 ? filtered[selectedIdx] : null;

  if (!repo) {
    return <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">{t('pages.noRepository')}</div>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border-default bg-bg-tertiary" style={{ height: 28 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{t('pages.annotateTitle')}</span>
          <span className="text-2xs text-text-tertiary">{t('pages.commitsCount', { count: filtered.length })}</span>
          {globalPathFilter && (
            <span className="text-2xs px-1.5 py-0.5 rounded border border-status-modified/40 bg-status-modified/10 text-status-modified flex items-center gap-1 ml-2">
              <Search size={9} />{globalPathFilter}
              <button onClick={() => useSelectionStore.getState().setPathFilter(null)} title={t('pages.clearFileFilter')}>✕</button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <input type="text" placeholder={t('pages.filterPlaceholder')} value={search}
            onChange={(e) => setSearch(e.target.value)} className="text-xs w-32 px-2 py-0.5" />
          <button className="icon-btn !w-5 !h-5" title={t('common.refresh')} onClick={loadHistory}>
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Commit list — virtualized */}
        <div className="flex-1 overflow-y-auto" ref={lazyList.scrollRef} style={{ position: 'relative' }}>
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary text-sm">{t('pages.noCommits')}</div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Graph SVG — full size, pointer-events: none, zIndex 5 (above row backgrounds) */}
              {graphRows.length > 0 && (
                <svg width={graphWidth} height={graphRows.length * ROW_HEIGHT}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }}>
                  {graphRows.map((row, idx) => {
                    if (!row.node) return null;
                    const rowY = idx * ROW_HEIGHT;
                    const cy = rowY + ROW_HEIGHT / 2;
                    const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                    return (
                      <g key={`r-${idx}`}>
                        {row.passing.map((p, pi) => (
                          <line key={`p-${idx}-${pi}`} x1={x(p.lane)} y1={rowY} x2={x(p.lane)} y2={rowY + ROW_HEIGHT}
                            stroke={laneColor(p.color)} strokeWidth={1.5} opacity={0.6} />
                        ))}
                        {row.node && (
                          <>
                            {row.node.closing.map((c, ci) => (
                              <path key={`c-${idx}-${ci}`} d={bezierPath(x(c.lane), rowY, x(row.node!.lane), cy)}
                                stroke={laneColor(c.color)} strokeWidth={1.5} fill="none" opacity={0.6} />
                            ))}
                            {row.node.hasIncoming && (
                              <line x1={x(row.node.lane)} y1={rowY} x2={x(row.node.lane)} y2={cy}
                                stroke={laneColor(row.node.color)} strokeWidth={1.5} opacity={0.6} />
                            )}
                            {row.node.continues && (
                              <line x1={x(row.node.lane)} y1={cy} x2={x(row.node.lane)} y2={rowY + ROW_HEIGHT}
                                stroke={laneColor(row.node.color)} strokeWidth={1.5} opacity={0.6} />
                            )}
                            {row.node.merges.map((m, mi) => (
                              <path key={`m-${idx}-${mi}`} d={bezierPath(x(row.node!.lane), cy, x(m.lane), rowY + ROW_HEIGHT)}
                                stroke={laneColor(m.color)} strokeWidth={1.5} fill="none" opacity={0.6} />
                            ))}
                            {(() => {
                              const cx = x(row.node!.lane);
                              const isSelected = selectedIdx === idx;
                              const isMerge = row.node!.isMerge;
                              const r = isMerge ? 5 : 4;
                              return (
                                <g>
                                  {isMerge && <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke={laneColor(row.node!.color)} strokeWidth={1} opacity={0.4} />}
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

              {/* Commit rows — virtualized */}
              <div style={{ height: lazyList.totalHeight, position: 'relative' }}>
                <div style={{ position: 'absolute', top: lazyList.offsetY, left: 0, right: 0 }}>
                  {graphRows.slice(lazyList.visibleRange.start, lazyList.visibleRange.end).map((row, idx) => {
                    const realIdx = lazyList.visibleRange.start + idx;
                    if (!row.node) return null;
                    const entry = row.node.entry;
                    const initials = getInitials(entry.author.name);
                    const color = getAuthorColor(entry.author.name);
                    const isSelected = selectedIdx === realIdx;
                    const fileCount = fileCounts[entry.hash];
                    const isHEAD = entry.refs.some(r => r.includes('HEAD'));
                    return (
                      <div key={entry.hash}
                        className={cn('flex items-center gap-2 border-b border-border-subtle cursor-pointer relative',
                          isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover')}
                        style={{ height: ROW_HEIGHT, paddingLeft: graphWidth + 8, zIndex: 4 }}
                        onClick={() => { setSelectedIdx(realIdx); selectCommit(entry.hash); }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedIdx(realIdx);
                          selectCommit(entry.hash);
                          const items: ContextMenuItem[] = [
                            { label: t('pages.menuViewInHistory'), clickId: 'view-history' },
                            { label: t('history.createTag'), clickId: 'create-tag' },
                            { type: 'separator' },
                            { label: t('history.copyShortHash'), clickId: 'copy-short' },
                            { label: t('history.copyFullHash'), clickId: 'copy-full' },
                            { label: t('history.copyMessage'), clickId: 'copy-msg' },
                          ];
                          showContextMenu(items, (action) => {
                            if (action === 'view-history') {
                              selectCommit(entry.hash);
                              window.location.hash = '#/history';
                            } else if (action === 'create-tag') {
                              selectCommit(entry.hash);
                              window.location.hash = '#/history';
                              // History will handle the tag creation via its context menu
                            } else if (action === 'copy-short') {
                              copyToClipboard(shortHash(entry.hash));
                              toast.success(t('pages.copied'));
                            } else if (action === 'copy-full') {
                              copyToClipboard(entry.hash);
                              toast.success(t('pages.copied'));
                            } else if (action === 'copy-msg') {
                              copyToClipboard(entry.subject);
                              toast.success(t('pages.copied'));
                            }
                          });
                        }}
                        title={t('pages.clickSelectHint')}
                      >
                        {isHEAD && <span className="text-2xs text-accent font-bold flex-shrink-0" style={{ width: 8 }} title="Current branch (HEAD)">{'>'}</span>}
                        {!isHEAD && <span style={{ width: 8 }} className="flex-shrink-0" />}
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
                                {isTag && <TagIcon size={8} className="inline mr-0.5" />}{label}
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
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <ResizableSplitter direction="horizontal" onResize={(d) => handleDetailResize(-d)} />
        <div className="bg-bg-secondary overflow-y-auto flex-shrink-0" style={{ width: detailWidth }}>
          {selected ? (
            <div className="p-3">
              <div className="text-sm font-medium mb-2">{selected.subject}</div>
              <div className="flex items-center gap-2 mb-3">
                <CommitHashLink hash={selected.hash} />
                <button className="icon-btn !w-5 !h-5" title={t('common.copy')} onClick={() => { copyToClipboard(selected.hash); toast.success(t('pages.copied')); }}>
                  <GitCommit size={10} />
                </button>
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
                  <div className="text-2xs uppercase text-text-tertiary mb-1">{t('pages.parents')}</div>
                  {selected.parents.map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <CornerDownRight size={10} className="text-text-tertiary" />
                      <CommitHashLink hash={p} />
                    </div>
                  ))}
                </div>
              )}
              {/* Files with status annotations + context menu */}
              <div className="mt-3 pt-3 border-t border-border-default">
                <button className="w-full flex items-center justify-between text-2xs uppercase text-text-tertiary mb-2"
                  onClick={() => setShowFiles(!showFiles)}>
                  <span>{t('pages.filesCount', { count: commitFiles.length })}</span>
                  {showFiles ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                {showFiles && (
                  loadingFiles ? <div className="text-2xs text-text-tertiary">{t('common.loading')}</div> :
                  commitFiles.length === 0 ? <div className="text-2xs text-text-tertiary">{t('pages.noFiles')}</div> :
                  commitFiles.map((f, i) => {
                    const isHighlighted = globalPathFilter === f.path || globalPathFilter === f.oldPath;
                    return (
                      <div key={i} className={cn(
                        'flex items-center gap-2 text-2xs py-0.5 px-1 rounded hover:bg-bg-hover cursor-pointer group',
                        isHighlighted && 'bg-accent-muted border-l-2 border-accent'
                      )}
                        onClick={() => {
                          useSelectionStore.getState().selectFile(f.path);
                          useSelectionStore.getState().setPathFilter(f.path);
                          window.location.hash = '#/history';
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const items: ContextMenuItem[] = [
                            { label: t('pages.menuViewFileHistory'), clickId: 'file-history' },
                            { label: t('pages.menuBlameThisFile'), clickId: 'blame' },
                            { type: 'separator' },
                            { label: t('pages.menuCopyPath'), clickId: 'copy-path' },
                            { label: t('pages.menuCopyFullPath'), clickId: 'copy-full-path' },
                          ];
                          showContextMenu(items, (action) => {
                            if (action === 'file-history') {
                              useSelectionStore.getState().selectFile(f.path);
                              useSelectionStore.getState().setPathFilter(f.path);
                              window.location.hash = '#/history';
                            } else if (action === 'blame') {
                              useSelectionStore.getState().selectFile(f.path);
                              window.location.hash = '#/blame';
                            } else if (action === 'copy-path') {
                              copyToClipboard(f.path);
                              toast.success(t('pages.pathCopied'));
                            } else if (action === 'copy-full-path') {
                              copyToClipboard(`${repo.path}/${f.path}`.replace(/\/+/g, '/'));
                              toast.success(t('pages.fullPathCopied'));
                            }
                          });
                        }}
                        title={isHighlighted ? t('pages.fileMatchesFilterHint', { path: f.path }) : t('pages.fileRowHint')}
                      >
                        <span className="font-mono font-bold w-4 text-center"
                          style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>
                          {f.status}
                        </span>
                        <span className={cn('flex-1 truncate font-mono text-text-secondary group-hover:text-text-primary',
                          isHighlighted && 'text-accent font-medium')}>{f.path}</span>
                        {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                          <span className="flex-shrink-0">
                            <span className="text-status-added">+{f.additions}</span>
                            <span className="text-status-deleted ml-1">-{f.deletions}</span>
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : <div className="p-4 text-center text-text-tertiary text-sm">{t('pages.selectCommit')}</div>}
        </div>
      </div>
    </div>
  );
}
