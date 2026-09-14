import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ArrowRight, ChevronDown, ChevronRight, History, RefreshCw } from '../components/icons';
import { CommitHashLink } from '../components/StatusBar';
import { api, type CommitFile, type ReflogEntry } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useDateFormatter } from '../lib/formatDate';
import { useContextMenu } from '../lib/useContextMenu';
import { cn, copyToClipboard, formatDate, shortHash } from '../lib/utils';
import { useGitStore } from '../stores/gitStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastActions } from '../stores/toastStore';

const REFS = ['HEAD', 'ORIG_HEAD', 'refs/heads', 'refs/remotes'];

/**
 * Reflog — master-detail redesign (user-requested based on screenshot).
 *
 * Left panel (~40% width): chronological list of reflog entries.
 * Each row: [checkbox] [hashAbbrev] [operation/message] [relative time].
 * Selected row has accent background.
 *
 * Right panel (~60% width): commit detail for the selected entry.
 *   - Title: operation type (e.g. "pull: Fast-forward")
 *   - Metadata: full SHA + ISO timestamp (monospace)
 *   - "Go to this point" button (primary CTA — runs `git reset --hard
 *     <hash>` after confirmation)
 *   - File changes section: list of files with +N/-M additions/deletions
 *
 * The checkbox column lets the user multi-select reflog entries for
 * bulk operations (cherry-pick multiple, diff range, etc.) — left for
 * follow-up.
 */
export function ReflogPage() {
  const { t } = useI18n();
  // 0.7 — honors settings.dateFormat (relative / absolute / both)
  const fmtDate = useDateFormatter();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const status = useGitStore((s) => s.status);
  const toast = useToastActions();
  const showContextMenu = useContextMenu();
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const refreshStatus = useRepositoryStore.getState().loadMetadata;

  const [entries, setEntries] = useState<ReflogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [ref, setRef] = useState('HEAD');
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.reflog(repo.path, ref, 500);
      setEntries(result);
      // Set initial selection WITHOUT depending on `selectedHash` — the
      // previous dependency on `selectedHash` recreated `load` whenever
      // the selection changed, which then re-ran this very effect,
      // causing the "вечный рефреш" loop. Read the current value from
      // a ref so this callback stays stable.
      if (result.length > 0 && !selectedHashRef.current) {
        selectedHashRef.current = result[0].hash;
        setSelectedHash(result[0].hash);
      }
    } catch (e) {
      toast.error(t('pages.reflogLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, ref]);

  // Mirror `selectedHash` into a ref so `load` can read its current value
  // without being recreated on every selection change (which would re-run
  // the load effect and cause infinite refresh).
  const selectedHashRef = useRef<string | null>(null);
  useEffect(() => { selectedHashRef.current = selectedHash; }, [selectedHash]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load commit files when the selected hash changes.
  useEffect(() => {
    if (!selectedHash) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, selectedHash)
      .then(files => { if (!cancelled) setCommitFiles(files); })
      .catch(() => { if (!cancelled) setCommitFiles([]); })
      .finally(() => { if (!cancelled) setLoadingFiles(false); });
    return () => { cancelled = true; };
  }, [selectedHash, repo.path]);

  const selectedEntry = entries.find(e => e.hash === selectedHash) ?? null;

  const handleGoToPoint = async () => {
    if (!selectedEntry) return;
    const ok = await confirmDialog({
      title: t('pages.reflogGoToPointTitle'),
      message: t('pages.reflogGoToPointMessage', { hash: shortHash(selectedEntry.hash) }),
      confirmLabel: t('pages.reflogGoToPoint'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.git.raw(repo.path, ['reset', '--hard', selectedEntry.hash]);
      toast.success(t('pages.reflogResetDone', { hash: shortHash(selectedEntry.hash) }));
      await refreshStatus();
      await load();
    } catch (e) {
      toast.error(t('pages.reflogResetFailed'), String(e));
    }
  };

  const handleDelete = async (entry: ReflogEntry) => {
    if (!(await confirmDialog({
      title: t('pages.reflogDeleteTitle'),
      message: t('pages.reflogDeleteMessage', { selector: entry.selector }),
      confirmLabel: t('common.delete'),
      danger: true,
    }))) return;
    try {
      await api.git.raw(repo.path, ['reflog', 'delete', entry.selector]);
      toast.success(t('pages.reflogDeleted'));
      await load();
    } catch (e) {
      toast.error(t('pages.deleteFailed'), String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('nav.reflog')}</span>
          <button
            className="text-xs px-2 py-0.5 bg-bg-tertiary rounded flex items-center gap-1 hover:bg-bg-hover"
            onClick={() => setShowRefPicker(!showRefPicker)}
          >
            <span className="font-mono text-accent">{ref}</span>
            {showRefPicker ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          <span className="text-2xs text-text-tertiary">{t('pages.entriesCount', { count: entries.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Ref picker (collapsible) */}
      {showRefPicker && (
        <div className="border-b border-border-default bg-bg-tertiary p-2">
          <input
            type="text"
            className="w-full text-sm font-mono"
            placeholder={t('pages.reflogRefPlaceholder')}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setShowRefPicker(false);
                void load();
              }
              if (e.key === 'Escape') setShowRefPicker(false);
            }}
            autoFocus
          />
          <div className="flex gap-1 mt-2 flex-wrap">
            {REFS.map((r) => (
              <button
                key={r}
                className="text-2xs px-2 py-0.5 bg-bg-secondary rounded hover:bg-bg-hover"
                onClick={() => { setRef(r); setShowRefPicker(false); }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Master-detail layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: reflog entries list (master) */}
        <div className="w-2/5 min-w-[280px] max-w-[480px] border-r border-border-default overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={History}
              title={t('pages.noReflogEntries')}
              description={t('pages.reflogEmptyFor', { ref })}
            />
          ) : (
            entries.map((entry) => {
              const isSelected = selectedHash === entry.hash;
              return (
                <div
                  key={entry.index}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle hover:bg-bg-hover cursor-pointer text-xs',
                    isSelected && 'bg-bg-selected',
                  )}
                  onClick={() => {
                    setSelectedHash(entry.hash);
                    selectCommit(entry.hash);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    showContextMenu([
                      { label: t('pages.menuViewCommitInHistory'), clickId: 'view-commit' },
                      { type: 'separator' },
                      { label: t('history.copyShortHash'), clickId: 'copy-short' },
                      { label: t('history.copyFullHash'), clickId: 'copy-full' },
                      { label: t('pages.menuCopyMessage'), clickId: 'copy-msg' },
                      { type: 'separator' },
                      { label: t('pages.reflogGoToPoint'), clickId: 'go-to-point' },
                      { type: 'separator' },
                      { label: t('pages.menuDeleteEntry'), clickId: 'delete' },
                    ], (action) => {
                      switch (action) {
                        case 'view-commit':
                          selectCommit(entry.hash);
                          window.location.hash = '#/history';
                          break;
                        case 'copy-short': copyToClipboard(shortHash(entry.hash)); toast.success(t('pages.copied')); break;
                        case 'copy-full': copyToClipboard(entry.hash); toast.success(t('pages.copied')); break;
                        case 'copy-msg': copyToClipboard(entry.message); toast.success(t('pages.copied')); break;
                        case 'go-to-point':
                          setSelectedHash(entry.hash);
                          void handleGoToPoint();
                          break;
                        case 'delete': handleDelete(entry); break;
                      }
                    });
                  }}
                >
                  {/* Checkbox (for future multi-select / batch operations) */}
                  <input
                    type="checkbox"
                    className="flex-shrink-0 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => { /* future: add to multi-set */ }}
                  />
                  {/* Hash */}
                  <code className="font-mono text-text-tertiary flex-shrink-0 w-16 text-xs">
                    {entry.hashAbbrev || shortHash(entry.hash)}
                  </code>
                  {/* Operation / message (truncated) */}
                  <span className="flex-1 min-w-0 truncate text-text-primary" title={entry.message}>
                    {entry.message}
                  </span>
                  {/* Relative time */}
                  <span className="text-text-tertiary text-2xs flex-shrink-0">
                    {fmtDate(entry.date)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Right: commit detail (detail) */}
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedEntry ? (
            <EmptyState
              icon={History}
              title={t('pages.reflogSelectEntry')}
              description={t('pages.reflogSelectEntryDesc')}
            />
          ) : (
            <div className="space-y-4">
              {/* Title + metadata */}
              <div>
                <h2 className="text-base font-semibold text-text-primary mb-1">
                  {selectedEntry.message}
                </h2>
                <div className="text-xs text-text-tertiary font-mono flex items-center gap-2">
                  <CommitHashLink hash={selectedEntry.hash} />
                  <span>·</span>
                  <span>{selectedEntry.author.name}</span>
                  <span>·</span>
                  <span>{new Date(selectedEntry.timestamp || selectedEntry.date).toISOString().replace('T', ' ').slice(0, 19)}</span>
                </div>
              </div>

              {/* Primary CTA — Go to this point */}
              <button
                className="btn btn-primary text-sm flex items-center gap-2"
                onClick={handleGoToPoint}
                title={t('pages.reflogGoToPointTooltip')}
              >
                <ArrowRight size={14} />
                {t('pages.reflogGoToPoint')}
              </button>

              {/* File changes */}
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-2">
                  {t('pages.reflogFileChanges', { count: commitFiles.length })}
                </h3>
                {loadingFiles ? (
                  <div className="text-xs text-text-tertiary">{t('common.loading')}</div>
                ) : commitFiles.length === 0 ? (
                  <div className="text-xs text-text-tertiary">{t('pages.reflogNoFileChanges')}</div>
                ) : (
                  <div className="border border-border-subtle rounded">
                    {commitFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-1 border-b border-border-subtle last:border-b-0 text-xs hover:bg-bg-hover"
                      >
                        <span
                          className="font-mono font-bold w-4 text-center flex-shrink-0"
                          style={{
                            color: f.status === 'A' ? 'var(--status-added)'
                              : f.status === 'D' ? 'var(--status-deleted)'
                              : f.status === 'R' ? 'var(--status-renamed)'
                              : 'var(--status-modified)',
                          }}
                        >
                          {f.status}
                        </span>
                        <span className="flex-1 min-w-0 truncate font-mono" title={f.path}>
                          {f.path}
                          {f.oldPath && <span className="text-text-tertiary"> ← {f.oldPath}</span>}
                        </span>
                        {!f.binary && (
                          <span className="flex items-center gap-2 flex-shrink-0 text-2xs">
                            <span className="text-status-added">+{f.additions}</span>
                            <span className="text-status-deleted">-{f.deletions}</span>
                          </span>
                        )}
                        {f.binary && (
                          <span className="text-text-tertiary text-2xs flex-shrink-0">binary</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
