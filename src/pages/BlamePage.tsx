import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, FileText, Loader, RefreshCw, GitCommit, History, ChevronDown, ChevronUp, RotateCcw } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type BlameResult, type BlameLine } from '../lib/api';
import { shortHash, cn, copyToClipboard } from '../lib/utils';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { filterTrackedFiles } from '../lib/searchUtils';
import { useI18n } from '../lib/i18n';
import { useDateFormatter } from '../lib/formatDate';

/**
 * Blame tool — Task 29 redesign («совершенно непонятный и неудобный»).
 *
 * What made the old page incomprehensible:
 *   1. You had to TYPE the exact repository-relative path by hand — no
 *      file picker, no autocomplete, no way to discover files.
 *   2. Every line repeated the same hash+author pair, with no date and no
 *      commit subject — the information that actually explains a line.
 *   3. `whitespace-pre-wrap break-all` wrapped long lines mid-token into
 *      a staircase — not a code view.
 *
 * The redesign:
 *   - Fuzzy file picker over `git ls-files` (same matcher as the Search
 *     tool) — type a few letters, click the match, blame runs at once.
 *     Full manual paths still work (Enter).
 *   - GitHub-style GROUPED gutter: a block of consecutive lines from one
 *     commit shows author + relative date + short hash + subject once, on
 *     the first line of the block; continuation lines leave the gutter
 *     empty so the eye follows blocks, not repetitions.
 *   - Proper code view: nowrap + horizontal scroll.
 *   - "Blame before this commit" (hash^) navigation — walk back through
 *     the history of a hot spot without leaving the tool, with a
 *     one-click "back to HEAD" chip.
 */

/** Consecutive lines sharing one commit hash → one blame block. */
interface BlameGroup {
  startIdx: number;
  endIdx: number;
  hash: string;
  author: string;
  summary: string;
  /** epoch seconds (from --line-porcelain author-time) */
  time: number;
}

function buildGroups(lines: BlameLine[]): BlameGroup[] {
  const groups: BlameGroup[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const last = groups[groups.length - 1];
    if (last && last.hash === l.hash) {
      last.endIdx = i;
    } else {
      groups.push({
        startIdx: i,
        endIdx: i,
        hash: l.hash,
        author: l.author || '',
        summary: l.summary || '',
        time: Number(l.authorTime) || 0,
      });
    }
  }
  return groups;
}

export function BlamePage() {
  const { t } = useI18n();
  const fmtDate = useDateFormatter();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const showContextMenu = useContextMenu();
  const [filePath, setFilePath] = useState('');
  const globalBranch = useSelectionStore((s) => s.selectedBranch);
  const globalTag = useSelectionStore((s) => s.selectedTag);
  const [ref, setRef] = useState(globalTag ?? globalBranch ?? 'HEAD');

  useEffect(() => {
    const newRef = globalTag ?? globalBranch ?? 'HEAD';
    setRef(newRef);
  }, [globalTag, globalBranch]);

  const [blame, setBlame] = useState<BlameResult | null>(null);
  const [loading, setLoading] = useState(false);
  const globalFilePath = useSelectionStore((s) => s.selectedFilePath);

  // ── File picker state (Task 29) ────────────────────────────────────────
  const [trackedFiles, setTrackedFiles] = useState<string[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEscapeKey(pickerOpen, () => setPickerOpen(false));
  const pickerRef = useRef<HTMLDivElement>(null);

  // Load the tracked-file list once per repo (null → not loaded yet).
  useEffect(() => {
    let cancelled = false;
    setTrackedFiles(null);
    setFilesLoading(true);
    api.git.trackedFiles(repo.path)
      .then((files) => { if (!cancelled) setTrackedFiles(files); })
      .catch(() => { if (!cancelled) setTrackedFiles([]); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [repo.path]);

  // Close the picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const pickerMatches = useMemo(() => {
    if (!trackedFiles) return [];
    if (!filePath.trim()) return trackedFiles.slice(0, 100);
    return filterTrackedFiles(trackedFiles, filePath, 100);
  }, [trackedFiles, filePath]);

  const handleBlameRef = useRef<((path?: string, refOverride?: string) => void) | null>(null);
  handleBlameRef.current = (overridePath?: string, refOverride?: string) => {
    const path = overridePath || filePath;
    const effectiveRef = refOverride || ref;
    if (!path.trim()) {
      toast.warning(t('pages.filePathRequired'));
      return;
    }
    setLoading(true);
    api.git.blame(repo.path, path, effectiveRef || undefined)
      .then((result) => {
        setBlame(result);
        if (path.trim()) useSelectionStore.getState().selectFile(path.trim());
        // One-shot focus line (Search → Blame «открыть строку с находкой»):
        // scroll the row into view and flash-highlight it once rendering
        // settles, then consume the request so manual re-blames don't re-jump.
        const focusLine = useSelectionStore.getState().blameFocusLine;
        if (focusLine != null) {
          useSelectionStore.getState().setBlameFocusLine(null);
          setTimeout(() => {
            const row = document.querySelector(`[data-blame-line="${focusLine}"]`);
            if (row) {
              row.scrollIntoView({ block: 'center', behavior: 'smooth' });
              row.classList.add('blame-focus-flash');
              setTimeout(() => row.classList.remove('blame-focus-flash'), 2400);
            }
          }, 60);
        }
      })
      .catch((e) => { toast.error(t('pages.blameFailed'), String(e)); setBlame(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (globalFilePath) {
      setFilePath(globalFilePath);
      setPickerOpen(false);
      const timer = setTimeout(() => {
        handleBlameRef.current?.(globalFilePath);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [globalFilePath]);

  const handleBlame = useCallback(() => {
    setPickerOpen(false);
    handleBlameRef.current?.();
  }, []);

  /** Pick a file from the dropdown: set path, close picker, blame at once. */
  const handlePickFile = useCallback((path: string) => {
    setFilePath(path);
    setPickerOpen(false);
    handleBlameRef.current?.(path);
  }, []);

  // Click a commit hash → navigate to History with that commit + file filter
  const handleCommitClick = useCallback((hash: string) => {
    useSelectionStore.getState().selectCommit(hash);
    if (filePath.trim()) {
      useSelectionStore.getState().setPathFilter(filePath.trim());
    }
    window.location.hash = '#/history';
  }, [filePath]);

  // VS Code: open this file AT this line (uses the line param of vscode.open)
  const openInVsCodeAtLine = useCallback(async (line: number) => {
    if (!filePath.trim()) return;
    try {
      const res = await api.vscode.open(repo.path, { file: filePath.trim(), line });
      if (res.ok) toast.success(t('vscode.opened'));
      else toast.error(t('vscode.openFailed'));
    } catch (e) {
      toast.error(t('vscode.openFailed'), String(e));
    }
  }, [repo, filePath, toast, t]);

  /**
   * "Blame before this commit" — blame the file at hash^ so the user can
   * see who wrote the line BEFORE the currently blamed change touched it
   * (the standard GitHub/VS Code blame drill-down).
   */
  const handleBlameBefore = useCallback((hash: string) => {
    const prevRef = `${shortHash(hash)}^`;
    setRef(prevRef);
    handleBlameRef.current?.(filePath, prevRef);
  }, [filePath]);

  const showLineContextMenu = useCallback((e: React.MouseEvent, line: BlameLine) => {
    e.preventDefault();
    e.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: t('vscode.openAtLine', { line: line.finalLineNumber }), clickId: 'open-vscode-line' },
      { label: t('pages.blameViewCommitShort'), clickId: 'view-commit' },
      { label: t('pages.blameBlameBefore'), clickId: 'blame-before' },
      { type: 'separator' },
      { label: t('ctx.group.copy'), submenu: [
        { label: t('history.copyShortHash'), clickId: 'copy-short' },
        { label: t('history.copyFullHash'), clickId: 'copy-full' },
        { label: t('history.copyCommitMessage'), clickId: 'copy-summary' },
      ] },
    ];
    showContextMenu(items, (action) => {
      if (action === 'open-vscode-line') void openInVsCodeAtLine(line.finalLineNumber);
      else if (action === 'view-commit') handleCommitClick(line.hash);
      else if (action === 'blame-before') handleBlameBefore(line.hash);
      else if (action === 'copy-short') { void copyToClipboard(shortHash(line.hash)); toast.success(t('common.copied')); }
      else if (action === 'copy-full') { void copyToClipboard(line.hash); toast.success(t('common.copied')); }
      else if (action === 'copy-summary') { void copyToClipboard(line.summary || ''); toast.success(t('common.copied')); }
    });
  }, [showContextMenu, openInVsCodeAtLine, handleCommitClick, handleBlameBefore, t, toast]);

  const colorMap = useMemo(() => {
    if (!blame) return new Map<string, string>();
    const uniqueHashes = Array.from(new Set(blame.lines.map((l) => l.hash)));
    const colors = [
      'rgba(14, 99, 156, 0.15)', 'rgba(115, 201, 145, 0.15)',
      'rgba(226, 192, 141, 0.15)', 'rgba(199, 78, 57, 0.15)',
      'rgba(105, 164, 255, 0.15)', 'rgba(170, 102, 200, 0.15)',
      'rgba(255, 167, 38, 0.15)', 'rgba(0, 188, 212, 0.15)',
    ];
    const map = new Map<string, string>();
    uniqueHashes.forEach((h, i) => { map.set(h, colors[i % colors.length]); });
    return map;
  }, [blame]);

  const groups = useMemo(() => (blame ? buildGroups(blame.lines) : []), [blame]);
  const groupByStart = useMemo(() => {
    const m = new Map<number, BlameGroup>();
    groups.forEach((g) => m.set(g.startIdx, g));
    return m;
  }, [groups]);

  // Non-default blame ref → show the "back to HEAD" chip.
  const blamedAtOverride = ref && ref !== 'HEAD' && blame ? ref : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary">
        <FileText size={14} />
        <span className="text-sm font-medium">{t('nav.blame')}</span>
        {filePath && (
          <span className="text-2xs text-text-tertiary ml-2 truncate">
            {filePath} @ {ref || 'HEAD'}
          </span>
        )}
      </div>

      {/* File picker + ref + Blame button */}
      <div className="flex items-center gap-2 p-3 border-b border-border-default bg-bg-tertiary relative" ref={pickerRef}>
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            className="w-full text-sm font-mono"
            placeholder={t('pages.blameFilePlaceholder')}
            value={filePath}
            onChange={(e) => { setFilePath(e.target.value); setPickerOpen(true); }}
            onFocus={() => setPickerOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleBlame();
              if (e.key === 'Escape') setPickerOpen(false);
            }}
            role="combobox"
            aria-expanded={pickerOpen}
            aria-label={t('pages.blameFilePlaceholder')}
          />
          {pickerOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 z-40 max-h-64 overflow-y-auto panel !p-0 shadow-lg">
              {filesLoading ? (
                <div className="px-3 py-2 text-xs text-text-tertiary">{t('pages.blameFilesLoading')}</div>
              ) : pickerMatches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-tertiary">{t('pages.blameNoFilesMatch')}</div>
              ) : pickerMatches.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-bg-hover border-b border-border-subtle last:border-b-0 truncate"
                  title={p}
                  onClick={() => handlePickFile(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="text"
          className="w-36 text-sm font-mono"
          placeholder="HEAD"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleBlame()}
          aria-label={t('pages.blameRefLabel')}
        />
        <button
          className="btn btn-primary text-xs"
          onClick={handleBlame}
          disabled={loading || !filePath.trim()}
        >
          {loading ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
          {t('nav.blame')}
        </button>
      </div>

      {/* Non-HEAD blame banner — "you are looking at an older version" */}
      {blamedAtOverride && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-accent/40 bg-accent-muted/30 text-xs">
          <GitCommit size={12} className="text-accent shrink-0" />
          <span className="text-text-secondary">
            {t('pages.blameAtRef', { ref: blamedAtOverride.replace(/\^$/, '^ (before)') })}
          </span>
          <button
            className="ml-auto btn btn-secondary text-2xs !py-0.5 !px-2"
            title={t('pages.blameBackToHead')}
            onClick={() => { setRef('HEAD'); handleBlameRef.current?.(filePath, 'HEAD'); }}
          >
            <RotateCcw size={10} />
            {t('pages.blameBackToHead')}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto bg-bg-primary">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
            <Loader size={14} className="animate-spin" />
            {t('pages.blameLoading')}
          </div>
        ) : !blame ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <FileText size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.blameEmpty')}</div>
            <div className="text-xs mt-1">
              {t('pages.blameEmptyHint')}
            </div>
            <div className="text-xs mt-1 text-text-tertiary">
              {t('pages.blameEmptyHint2')}
            </div>
          </div>
        ) : (
          <div className="font-mono text-xs min-w-max">
            {blame.lines.map((line, idx) => {
              const group = groupByStart.get(idx);
              const groupStart = group ?? undefined;
              return (
                <div
                  key={idx}
                  data-blame-line={line.finalLineNumber}
                  className="flex items-start hover:bg-bg-hover border-b border-border-subtle group"
                  style={{ backgroundColor: colorMap.get(line.hash) || 'transparent' }}
                  onContextMenu={(e) => showLineContextMenu(e, line)}
                >
                  {/* Gutter — full block info only on the FIRST line of the
                      group; continuation lines keep the gutter empty so the
                      eye follows blocks instead of repeated hash+author. */}
                  <div
                    className="w-64 shrink-0 px-2 py-1 border-r border-border-subtle text-text-secondary"
                    title={groupStart ? `${groupStart.author} · ${groupStart.summary}` : undefined}
                  >
                    {groupStart && (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1">
                          <button
                            className="text-accent hover:underline cursor-pointer font-mono"
                            title={t('pages.blameViewCommitHint', { hash: shortHash(line.hash), file: filePath })}
                            onClick={() => handleCommitClick(line.hash)}
                          >
                            {shortHash(line.hash)}
                          </button>
                          <span className="text-2xs text-text-tertiary">
                            {fmtDate(new Date(groupStart.time * 1000).toISOString())}
                          </span>
                        </div>
                        <div className="text-2xs truncate text-text-secondary">
                          {groupStart.author || t('pages.authorUnknown')}
                        </div>
                        <div className="text-2xs truncate text-text-tertiary" title={groupStart.summary}>
                          {groupStart.summary}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Line number */}
                  <div className="w-12 shrink-0 px-2 py-1 text-right text-text-tertiary border-r border-border-subtle select-none">
                    {line.finalLineNumber}
                  </div>
                  {/* Content — nowrap, horizontal scroll on the container:
                      a code view, not a wrapped paragraph. */}
                  <pre
                    className="flex-1 px-2 py-1 whitespace-pre text-text-primary"
                    style={{ fontFamily: 'inherit' }}
                  >
                    {line.content || ' '}
                  </pre>
                  {/* Hover actions: open in VS Code · view in History */}
                  <button
                    className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 shrink-0 m-1 transition-opacity"
                    title={t('vscode.openAtLine', { line: line.finalLineNumber })}
                    onClick={() => openInVsCodeAtLine(line.finalLineNumber)}
                  >
                    <FileText size={10} />
                  </button>
                  <button
                    className="opacity-0 group-hover:opacity-100 icon-btn !w-5 !h-5 shrink-0 m-1 transition-opacity"
                    title={t('pages.blameViewCommitShort')}
                    onClick={() => handleCommitClick(line.hash)}
                  >
                    <History size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {blame && blame.lines.length > 0 && (
        <div className="border-t border-border-default bg-bg-secondary p-2 text-xs text-text-tertiary flex items-center gap-2">
          <span data-testid="blame-stats">
            {blame.lines.length} {t('pages.blameLines')} · {new Set(blame.lines.map((l) => l.hash)).size} {t('pages.blameUniqueCommits')}
          </span>
          {filePath && <span className="ml-2 truncate">· {t('pages.blameFileLabel')} <code className="mono">{filePath}</code></span>}
          <span className="ml-auto flex items-center gap-1">
            <ChevronUp size={10} className="text-text-tertiary/50" />
            <ChevronDown size={10} className="text-text-tertiary/50" />
            <span className="text-2xs text-text-tertiary/70">{t('pages.blameGroupHint')}</span>
          </span>
        </div>
      )}
    </div>
  );
}
