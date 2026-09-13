import { useState, useCallback, useEffect } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { FolderGit, FolderGitOpen, Plus, X, Check, Loader } from './icons';
import { useI18n } from '../lib/i18n';

/**
 * Global Drag-and-Drop Repository Handler
 * ========================================
 *
 * Intercepts file/folder drag-and-drop events on the entire window. When the
 * user drags one or more folders onto the PrismGit window:
 *
 *   1. Shows a full-screen overlay with a "Drop repositories to open" message
 *   2. On drop, checks each folder for a .git directory
 *   3. Adds all valid git repos to the known repositories list
 *   4. Opens the FIRST valid repo (if none is currently open)
 *   5. Shows a summary toast: "Added 3 repositories, skipped 1 (not a git repo)"
 *
 * Supports dragging multiple folders at once from the file manager.
 *
 * Electron provides dropped file paths via the HTML5 DragEvent API —
 * `e.dataTransfer.files` contains File objects with `.path` (Electron extension).
 */

interface DropResult {
  path: string;
  name: string;
  isRepo: boolean;
  opened: boolean;
}

export function DragDropHandler() {
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DropResult[] | null>(null);
  const openRepository = useRepositoryStore((s) => s.openRepository);
  const loadRepos = useRepositoryStore((s) => s.loadRepos);
  const toast = useToastActions();
  const { t } = useI18n();

  // A file drag lists the special 'Files' type. Some sources (synthetic events,
  // platform quirks) expose it lowercased — accept both.
  const isFileDrag = (e: DragEvent): boolean =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).some((t) => t.toLowerCase() === 'files');

  // Track drag enter/leave counter to handle nested drag events correctly.
  // The browser fires dragenter for each nested element, so we use a counter
  // to know when the drag truly enters/leaves the window.
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      // Only handle file drags (not text/HTML drags from within the app)
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragCounter((c) => c + 1);
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setDragCounter((c) => {
        const next = c - 1;
        if (next <= 0) {
          setIsDragging(false);
          return 0;
        }
        return next;
      });
    };

    const handleDragOver = (e: DragEvent) => {
      // Must call preventDefault on dragover to allow drop
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      setDragCounter(0);
      setIsDragging(false);
      setProcessing(true);
      setResults(null);

      // Collect all dropped file paths.
      // Electron exposes the real filesystem path via `file.path`.
      const files = Array.from(e.dataTransfer.files);
      const paths: string[] = [];
      for (const f of files) {
        // Electron's File object has a non-standard `.path` property
        const filePath = (f as File & { path?: string }).path;
        if (filePath) paths.push(filePath);
      }

      if (paths.length === 0) {
        setProcessing(false);
        return;
      }

      // Check each path: is it a git repo?
      const dropResults: DropResult[] = [];
      let firstValidRepo: string | null = null;
      const currentRepoPath = useRepositoryStore.getState().currentRepo?.path;

      for (const p of paths) {
        const name = p.split('/').pop() || p;
        try {
          const isRepo = await api.git.isRepo(p);
          if (isRepo) {
            // Add to known repos
            await api.settings.addRepo({ path: p, name });
            // Refresh stats in background
            api.settings.refreshRepoStats(p).then(() => {
              useRepositoryStore.getState().loadMetadata();
            }).catch(() => { /* ignore */ });
            dropResults.push({ path: p, name, isRepo: true, opened: false });
            // Remember the first valid repo to open if none is currently open
            if (!firstValidRepo && !currentRepoPath) {
              firstValidRepo = p;
            }
          } else {
            dropResults.push({ path: p, name, isRepo: false, opened: false });
          }
        } catch {
          dropResults.push({ path: p, name, isRepo: false, opened: false });
        }
      }

      // Refresh the known repos list
      await loadRepos();

      // Open the first valid repo if none is currently open
      if (firstValidRepo) {
        try {
          await openRepository(firstValidRepo);
          // Mark it as opened in the results
          const idx = dropResults.findIndex((r) => r.path === firstValidRepo);
          if (idx >= 0) dropResults[idx].opened = true;
        } catch {
          /* ignore — repo was added but couldn't be opened */
        }
      }

      setResults(dropResults);
      setProcessing(false);

      // Show summary toast
      const addedCount = dropResults.filter((r) => r.isRepo).length;
      const skippedCount = dropResults.filter((r) => !r.isRepo).length;
      if (addedCount > 0 && skippedCount > 0) {
        toast.success(
          addedCount === 1 ? t('shell.repoAdded') : t('shell.reposAdded', { count: addedCount }),
          skippedCount === 1 ? t('shell.folderSkipped', { count: skippedCount }) : t('shell.foldersSkipped', { count: skippedCount })
        );
      } else if (addedCount > 0) {
        toast.success(addedCount === 1 ? t('shell.repoAdded') : t('shell.reposAdded', { count: addedCount }));
      } else if (skippedCount > 0) {
        toast.warning(
          t('shell.noGitReposFound'),
          skippedCount === 1 ? t('shell.folderDroppedNoGit', { count: skippedCount }) : t('shell.foldersDroppedNoGit', { count: skippedCount })
        );
      }

      // Auto-dismiss results after 5 seconds
      setTimeout(() => setResults(null), 5000);
    };

    // Attach to window-level events to catch drops anywhere in the app
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [openRepository, loadRepos, toast, t]);

  // Don't render anything if not dragging and no results
  if (!isDragging && !processing && !results) return null;

  return (
    <>
      {/* Drag-over overlay */}
      {isDragging && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none"
          style={{
            backgroundColor: 'var(--accent-muted)',
            // No backdropFilter here: the app renders on CPU (hardware
            // acceleration disabled), and a per-frame full-screen CPU blur
            // makes drag-over feel laggy. The tinted overlay alone is enough.
            border: '3px dashed var(--accent)',
            borderRadius: '12px',
            margin: '8px',
          }}
        >
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <div
              className="w-24 h-24 rounded-2xl flex items-center justify-center shadow-lg"
              style={{
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-purple) 100%)',
              }}
            >
              <FolderGitOpen size={48} className="text-white" strokeWidth={2} />
            </div>
            <div className="text-xl font-bold text-text-primary">
              {t('shell.dropReposTitle')}
            </div>
            <div className="text-sm text-text-secondary">
              {t('shell.dropReposHint')}
            </div>
          </div>
        </div>
      )}

      {/* Processing overlay */}
      {processing && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: 'var(--overlay-bg)' }}
        >
          <div className="flex flex-col items-center gap-3 bg-bg-elevated rounded-xl p-8 shadow-lg border border-border-default">
            <Loader size={32} className="spin text-accent" />
            <div className="text-sm font-medium text-text-primary">
              {t('shell.checkingRepos')}
            </div>
            <div className="text-xs text-text-tertiary">
              {t('shell.verifyingGit')}
            </div>
          </div>
        </div>
      )}

      {/* Results panel */}
      {results && (
        <div className="fixed bottom-12 right-4 z-[200] w-96 bg-bg-elevated rounded-lg shadow-lg border border-border-default animate-slide-up overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default bg-bg-tertiary">
            <span className="text-sm font-semibold text-text-primary">
              {results.filter((r) => r.isRepo).length > 0 ? t('shell.reposAddedTitle') : t('shell.noReposFoundTitle')}
            </span>
            <button
              className="icon-btn !w-6 !h-6"
              onClick={() => setResults(null)}
              title={t('common.close')}
            >
              <X size={12} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1 scrollbar-thin">
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-4 py-1.5 text-xs"
              >
                {r.isRepo ? (
                  <Check size={12} className="text-status-added flex-shrink-0" />
                ) : (
                  <X size={12} className="text-text-tertiary flex-shrink-0" />
                )}
                {r.isRepo && r.opened ? (
                  <FolderGitOpen size={12} className="text-accent flex-shrink-0" />
                ) : r.isRepo ? (
                  <FolderGit size={12} className="text-text-tertiary flex-shrink-0" />
                ) : (
                  <FolderGit size={12} className="text-text-tertiary opacity-50 flex-shrink-0" />
                )}
                <span className={cn(
                  'truncate flex-1',
                  r.isRepo ? 'text-text-primary' : 'text-text-tertiary line-through'
                )} title={r.path}>
                  {r.name}
                </span>
                {r.opened && (
                  <span className="text-2xs text-accent font-medium flex-shrink-0">
                    {t('shell.statusOpened')}
                  </span>
                )}
                {r.isRepo && !r.opened && (
                  <span className="text-2xs text-text-tertiary flex-shrink-0">
                    {t('shell.statusAdded')}
                  </span>
                )}
                {!r.isRepo && (
                  <span className="text-2xs text-text-tertiary flex-shrink-0">
                    {t('shell.statusNotRepo')}
                  </span>
                )}
              </div>
            ))}
          </div>
          {results.some((r) => r.isRepo) && (
            <div className="px-4 py-2 border-t border-border-subtle text-2xs text-text-tertiary">
              {t('shell.addedSkippedSummary', { added: results.filter((r) => r.isRepo).length, skipped: results.filter((r) => !r.isRepo).length })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
