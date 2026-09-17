import { useState, useCallback, useEffect, useRef } from 'react';
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
 * Accepts OS file/folder drag-and-drop ONLY when the drop target is the
 * repository list section of the Sidebar (`[data-testid="repo-tree"]`).
 * Drops anywhere else in the app are ignored — this avoids the
 * accidental "drop on the editor / commit message" case and the
 * full-window blue dimming that previously covered the whole app.
 *
 * When the user drags one or more folders onto the Sidebar's repo list:
 *
 *   1. A subtle drop-zone highlight is rendered INSIDE the repo list
 *      (a dashed border + drop hint) — no full-window overlay.
 *   2. On drop, checks each folder for a .git directory
 *   3. Adds all valid git repos to the known repositories list
 *   4. Opens the FIRST valid repo (if none is currently open)
 *   5. Shows a summary toast: "Added 3 repositories, skipped 1 (not a git repo)"
 *
 * Internal app drags (repo row → group, branch → branch for merge,
 * file → file for stage) are NOT affected — those have their own
 * React-level handlers on their host elements.
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

// Selector for the repository list drop zone. The Sidebar renders the
// repo tree with `data-testid="repo-tree"`.
const REPO_LIST_SELECTOR = '[data-testid="repo-tree"]';

export function DragDropHandler() {
  // `dragOverZone` is true when the OS file drag is hovering over the
  // repo list. We only render the drop-zone highlight then.
  const [dragOverZone, setDragOverZone] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DropResult[] | null>(null);
  const openRepository = useRepositoryStore((s) => s.openRepository);
  const loadRepos = useRepositoryStore((s) => s.loadRepos);
  const toast = useToastActions();
  const { t } = useI18n();

  // Track drag enter/leave counter to handle nested drag events correctly
  // within the repo list. The browser fires dragenter for each nested
  // element, so we use a counter to know when the drag truly enters/leaves
  // the drop zone.
  const dragCounterRef = useRef(0);

  // A file drag lists the special 'Files' type. Some sources (synthetic events,
  // platform quirks) expose it lowercased — accept both.
  const isFileDrag = (e: DragEvent): boolean =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).some((t) => t.toLowerCase() === 'files');

  // Resolve the drop-zone element (the Sidebar's repo list).
  const getZone = (e: DragEvent): HTMLElement | null => {
    const target = e.target as Node | null;
    if (!target || !(target instanceof Element)) return null;
    return target.closest<HTMLElement>(REPO_LIST_SELECTOR);
  };

  // Process dropped paths: add valid repos, optionally open the first one.
  const processDroppedPaths = useCallback(async (paths: string[]) => {
    if (paths.length === 0) {
      setProcessing(false);
      return;
    }

    const dropResults: DropResult[] = [];
    let firstValidRepo: string | null = null;
    const currentRepoPath = useRepositoryStore.getState().currentRepo?.path;

    for (const p of paths) {
      const name = p.split('/').pop() || p;
      try {
        const isRepo = await api.git.isRepo(p);
        if (isRepo) {
          await api.settings.addRepo({ path: p, name });
          api.settings.refreshRepoStats(p).then(() => {
            useRepositoryStore.getState().loadMetadata();
          }).catch(() => { /* ignore */ });
          dropResults.push({ path: p, name, isRepo: true, opened: false });
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

    await loadRepos();

    if (firstValidRepo) {
      try {
        await openRepository(firstValidRepo);
        const idx = dropResults.findIndex((r) => r.path === firstValidRepo);
        if (idx >= 0) dropResults[idx].opened = true;
      } catch { /* ignore — repo was added but couldn't be opened */ }
    }

    setResults(dropResults);

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

    setTimeout(() => setResults(null), 5000);
  }, [loadRepos, openRepository, toast, t]);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      // Only handle file drags from the OS (not text/HTML drags from within the app)
      if (!isFileDrag(e)) return;
      const zone = getZone(e);
      if (!zone) return; // drag entered somewhere outside the repo list — ignore
      e.preventDefault();
      dragCounterRef.current += 1;
      setDragOverZone(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      const zone = getZone(e);
      if (!zone) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        setDragOverZone(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      // Must call preventDefault on dragover to allow drop — but ONLY when
      // the cursor is over the repo list. Outside the repo list, we don't
      // preventDefault, so the browser keeps the "no-drop" cursor and a
      // drop event won't fire there.
      if (!isFileDrag(e)) return;
      const zone = getZone(e);
      if (!zone) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return;
      // Only process drops that land on the repo list zone.
      const zone = getZone(e);
      if (!zone) return; // drop outside the repo list — ignore
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragOverZone(false);
      setProcessing(true);
      setResults(null);

      // Collect all dropped file paths.
      // Electron exposes the real filesystem path via `file.path`.
      const files = Array.from(e.dataTransfer.files);
      const paths: string[] = [];
      for (const f of files) {
        const filePath = (f as File & { path?: string }).path;
        if (filePath) paths.push(filePath);
      }

      if (paths.length === 0) {
        setProcessing(false);
        return;
      }

      await processDroppedPaths(paths);
      setProcessing(false);
    };

    // Attach to window-level events so we can intercept drops anywhere in
    // the app, but only act when the drop target is the repo list zone.
    // The previous implementation attached to window AND rendered a
    // full-screen blue overlay — this made drag-and-drop feel "grabby"
    // (the overlay covered the editor / commit message / diff). Now
    // we only highlight the repo list section.
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
  }, [processDroppedPaths]);

  // Don't render anything if not dragging-over-zone and no results/processing.
  if (!dragOverZone && !processing && !results) return null;

  return (
    <>
      {/* Drop-zone highlight — rendered as a portal-style overlay INSIDE
          the repo list. We use a fixed-position pointer-events:none layer
          that anchors itself to the repo list's bounding rect so it
          visually highlights ONLY that area, not the whole window.
          No blue/dim tint — just a dashed accent border + drop hint. */}
      {dragOverZone && <RepoListDropHighlight />}

      {/* Processing overlay — kept the same small centered modal. */}
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

/**
 * Drop-zone highlight — overlays the Sidebar's repo list with a dashed
 * accent border + drop hint when an OS file drag is hovering over it.
 * Uses a fixed-position pointer-events:none layer sized to match the
 * repo list's bounding rect, so the highlight is contained to that
 * area only (no full-window tint).
 */
function RepoListDropHighlight() {
  const { t } = useI18n();
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const update = () => {
      const zone = document.querySelector<HTMLElement>('[data-testid="repo-tree"]');
      if (zone) setRect(zone.getBoundingClientRect());
    };
    update();
    // Update on resize / scroll / sidebar drag — the repo list can resize
    // while the user is dragging (sidebar splitter, window resize).
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const interval = window.setInterval(update, 200); // cheap polling for sidebar resize
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.clearInterval(interval);
    };
  }, []);

  if (!rect) return null;

  return (
    <div
      className="fixed z-[150] pointer-events-none flex items-center justify-center"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        border: '2px dashed var(--accent)',
        borderRadius: '8px',
        margin: 0,
        backgroundColor: 'var(--accent-muted)',
      }}
    >
      <div className="flex flex-col items-center gap-2 text-accent">
        <FolderGitOpen size={28} strokeWidth={2} />
        <div className="text-sm font-semibold">
          {t('shell.dropReposTitle')}
        </div>
        <div className="text-2xs text-text-secondary">
          {t('shell.dropReposHint')}
        </div>
      </div>
    </div>
  );
}
