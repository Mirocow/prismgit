/**
 * ConflictMergeView — 3-way merge view for resolving Git conflicts.
 *
 * Layout (Meld / SmartGit style):
 *   ┌──────────────┬─────────────────┬──────────────┐
 *   │  Ours (HEAD) │  Working Tree   │  Theirs      │
 *   │  (read-only) │  (editable)     │  (read-only)  │
 *   └──────────────┴─────────────────┴──────────────┘
 *
 * The middle pane is a live editable text area where the user can:
 *   - Edit conflict markers directly (just like editing the file)
 *   - Or click one of the toolbar buttons to resolve the current hunk:
 *        Take Left  → use ours
 *        Take Right → use theirs
 *        Take Both  → ours + theirs (left first)
 *        Take Both (reversed) → theirs + ours
 *   - Click "Save & Stage" to write the merged content + `git add` the file
 *
 * SmartGit integration:
 *   - Called from DiffPage when a conflicted file is selected during
 *     merge/rebase/cherry-pick/revert (via "Resolve conflict..." menu)
 *   - Repo-state actions (Continue/Abort/etc.) are surfaced via the
 *     RepoStateBanner shown ABOVE this view by DiffPage
 *
 * Performance notes:
 *   - Pane content is stored as plain string[] — no React reconciliation per
 *     keystroke. The middle pane is an uncontrolled <textarea>-like editor
 *     using a contentEditable div to preserve scroll position + selection.
 *   - Conflict hunks are re-parsed from the middle pane on demand (only
 *     when computing the "X of Y conflicts" counter), not on every render.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Check, AlertCircle, Loader, ChevronUp, ChevronDown,
  ExternalLink, GitMerge, RotateCcw, Plus,
  ArrowLeft, ArrowRight,
} from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

type ConflictResolution = 'ours' | 'theirs' | 'base' | 'both-ours-first' | 'both-theirs-first' | 'manual';

interface ConflictHunk {
  /** 0-based line index where `<<<<<<<` marker is */
  startLine: number;
  oursStart: number;
  oursLines: string[];
  theirsStart: number;
  theirsLines: string[];
  /** 0-based line index AFTER `>>>>>>>` marker (exclusive end) */
  endLine: number;
  resolution?: ConflictResolution;
}

export interface ConflictMergeViewProps {
  filePath: string;
  /** Called after a file is successfully resolved & staged. */
  onResolved?: (resolvedFile: string) => void;
}

/**
 * Parse Git conflict markers from a file content string.
 * Returns the list of conflict hunks (regions delimited by
 * `<<<<<<<` / `=======` / `>>>>>>>`).
 *
 * Marker format:
 *   <<<<<<< HEAD
 *   ... ours ...
 *   =======
 *   ... theirs ...
 *   >>>>>>> branch-name
 */
function parseConflicts(content: string): ConflictHunk[] {
  const lines = content.split('\n');
  const hunks: ConflictHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i;
      const oursStart = i + 1;
      const oursLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('=======')) {
        oursLines.push(lines[i]);
        i++;
      }
      i++; // skip =======
      const theirsStart = i;
      const theirsLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirsLines.push(lines[i]);
        i++;
      }
      i++; // skip >>>>>>> ...
      hunks.push({ startLine, oursStart, oursLines, theirsStart, theirsLines, endLine: i });
    } else {
      i++;
    }
  }
  return hunks;
}

export function ConflictMergeView({ filePath, onResolved }: ConflictMergeViewProps) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [loading, setLoading] = useState(true);
  /** The full content of the working-tree file (the editable middle pane). */
  const [content, setContent] = useState<string>('');
  /**
   * The left/right panes show ONE conflict hunk at a time (with surrounding
   * context lines from the respective stage versions). They're loaded once
   * per file and updated only when the user navigates between hunks.
   */
  const [baseContent, setBaseContent] = useState<string>('');
  const [oursContent, setOursContent] = useState<string>('');
  const [theirsContent, setTheirsContent] = useState<string>('');
  const [currentHunk, setCurrentHunk] = useState(0);
  const [saving, setSaving] = useState(false);
  /** Dirty flag — set when the user edits the middle pane. */
  const [dirty, setDirty] = useState(false);
  /**
   * Ref to the editable middle pane. We use a contentEditable <div> instead
   * of <textarea> because:
   *   - textarea doesn't render conflict markers in color
   *   - textarea doesn't support inline syntax highlighting
   *   - textarea resets scroll position on re-render
   * The div is uncontrolled: we set initialContent and read .innerText on save.
   */
  const editorRef = useRef<HTMLDivElement | null>(null);

  // ===== Load file content + stage versions =================================

  const loadFile = useCallback(async () => {
    setLoading(true);
    setDirty(false);
    try {
      // Stage versions for the conflicted file:
      //   :1:filePath = BASE (common ancestor)
      //   :2:filePath = OURS (current branch / HEAD)
      //   :3:filePath = THEIRS (incoming branch)
      // NOTE: `:0:filePath` (stage 0 = "fully merged") does NOT exist while
      // the file is still conflicted — `git show :0:file.ts` throws
      //   "fatal: path 'file.ts' is in the index, but not at stage 0"
      // The middle pane reads the working-tree content directly from disk.
      const [base, ours, theirs] = await Promise.all([
        api.git.raw(repo.path, ['show', `:1:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:2:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:3:${filePath}`]).catch(() => ''),
      ]);
      setBaseContent(base);
      setOursContent(ours);
      setTheirsContent(theirs);
      const fullPath = `${repo.path}/${filePath}`.replace(/\/\+/g, '/');
      let fileContent = '';
      try { fileContent = await api.fs.readFile(fullPath); } catch { fileContent = ''; }
      setContent(fileContent);
      // Reflect content into the contentEditable div.
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.innerText = fileContent;
        }
      });
    } catch (e) {
      toast.error(t('changes.conflictLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, filePath, toast, t]);

  useEffect(() => { loadFile(); }, [loadFile]);

  // ===== Conflict hunks (re-parsed from middle pane on demand) =============

  /**
   * Conflict hunks in the middle pane. Recomputed from `content` state — but
   * `content` is only updated when the middle pane changes structurally (load,
   * apply resolution button). Normal typing in the editor does NOT update
   * `content`; the X/Y counter is recomputed from the editor's live innerText
   * on a debounced handler instead, to avoid re-rendering the page on every
   * keystroke.
   */
  const hunks = useMemo(() => parseConflicts(content), [content]);
  const unresolvedCount = hunks.length; // raw count of conflict blocks
  const currentHunkIdx = Math.min(currentHunk, Math.max(0, hunks.length - 1));

  // ===== Editor input handling (uncontrolled contentEditable) ==============

  /**
   * On user input in the middle pane:
   *   - Mark the view dirty (Save button becomes active)
   *   - Debounce re-parsing conflict markers for the counter
   */
  const parseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleEditorInput = useCallback(() => {
    setDirty(true);
    if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
    parseTimerRef.current = setTimeout(() => {
      if (editorRef.current) {
        const text = editorRef.current.innerText;
        const newHunks = parseConflicts(text);
        // Only update state if the conflict count changed (avoid re-render spam)
        if (newHunks.length !== hunks.length) {
          setContent(text);
          setCurrentHunk((c) => Math.min(c, Math.max(0, newHunks.length - 1)));
        }
      }
    }, 400);
  }, [hunks.length]);

  // ===== Resolution actions =================================================

  /**
   * Replace the CURRENT conflict hunk in the editor with the resolved content.
   * Mutates the editor's innerText in-place and updates `content` state.
   */
  const applyResolution = useCallback((resolution: ConflictResolution) => {
    if (!editorRef.current || hunks.length === 0) return;
    const h = hunks[currentHunkIdx];
    let resolved: string[];
    if (resolution === 'ours') resolved = h.oursLines;
    else if (resolution === 'theirs') resolved = h.theirsLines;
    else if (resolution === 'base') {
      const baseAll = baseContent.split('\n');
      // Use the lines from base that fall within the conflict region.
      // Approximate: same line count as ours+theirs combined — base often
      // matches one side or the other, fall back to ours if missing.
      resolved = baseAll.slice(h.oursStart, h.oursStart + Math.max(h.oursLines.length, h.theirsLines.length)) || h.oursLines;
    } else if (resolution === 'both-ours-first') {
      resolved = [...h.oursLines, '', ...h.theirsLines];
    } else if (resolution === 'both-theirs-first') {
      resolved = [...h.theirsLines, '', ...h.oursLines];
    } else {
      return; // 'manual' = no-op, let the user edit
    }
    const allLines = editorRef.current.innerText.split('\n');
    // Replace [startLine, endLine) with `resolved`.
    const newLines = [...allLines.slice(0, h.startLine), ...resolved, ...allLines.slice(h.endLine)];
    const newText = newLines.join('\n');
    editorRef.current.innerText = newText;
    setContent(newText);
    setDirty(true);
    toast.success(`Hunk ${currentHunkIdx + 1}: ${resolution.replace(/-/g, ' ')}`);
    // Auto-advance to the next unresolved hunk
    if (currentHunkIdx < hunks.length - 1) {
      setCurrentHunk(currentHunkIdx + 1);
    } else {
      // Reached end — wrap or stay
      setCurrentHunk(0);
    }
  }, [hunks, currentHunkIdx, baseContent, toast]);

  /**
   * Reset the current hunk back to its raw conflict markers (undo applyResolution).
   */
  const resetHunk = useCallback(() => {
    if (!editorRef.current || hunks.length === 0) return;
    const h = hunks[currentHunkIdx];
    const allLines = editorRef.current.innerText.split('\n');
    // Reconstruct the original conflict block
    const markers = [
      `<<<<<<< HEAD`,
      ...h.oursLines,
      `=======`,
      ...h.theirsLines,
      `>>>>>>> branch`,
    ];
    const newLines = [...allLines.slice(0, h.startLine), ...markers, ...allLines.slice(h.endLine)];
    const newText = newLines.join('\n');
    editorRef.current.innerText = newText;
    setContent(newText);
    setDirty(true);
  }, [hunks, currentHunkIdx]);

  // ===== Save & Stage ======================================================

  const handleSave = async () => {
    setSaving(true);
    try {
      const resolved = editorRef.current?.innerText ?? content;
      // Sanity check: warn if any conflict markers remain (git add will reject)
      if (resolved.includes('<<<<<<<') || resolved.includes('>>>>>>>')) {
        toast.warning('Conflict markers remain', 'Save anyway? File will be staged but not resolvable.');
      }
      const fullPath = `${repo.path}/${filePath}`.replace(/\/\+/g, '/');
      await api.fs.writeFile(fullPath, resolved);
      await api.git.add(repo.path, [filePath]);
      toast.success(t('changes.conflictResolvedStaged'));
      await refreshStatus(repo.path);
      setDirty(false);
      onResolved?.(filePath);
    } catch (e) {
      toast.error(t('changes.saveFailed'), String(e));
    } finally {
      setSaving(false);
    }
  };

  // ===== Keyboard shortcuts (Meld / SmartGit style) ========================

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // F7 / Shift+F7 — navigate between conflicts
      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) setCurrentHunk((h) => Math.max(0, h - 1));
        else setCurrentHunk((h) => Math.min(hunks.length - 1, h + 1));
        return;
      }
      // Ctrl/Cmd+1/2/3 — quick resolve current hunk
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === '1') { e.preventDefault(); applyResolution('ours'); }
      else if (e.key === '2') { e.preventDefault(); applyResolution('theirs'); }
      else if (e.key === '3') { e.preventDefault(); applyResolution('both-ours-first'); }
      else if (e.key === 'Enter' && !e.shiftKey) {
        // Ctrl/Cmd+Enter — save & stage
        e.preventDefault();
        if (!saving) void handleSave();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [hunks.length, currentHunkIdx, applyResolution, saving]);

  // ===== Render: loading / binary / empty states ============================

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-tertiary text-sm flex items-center gap-2">
          <Loader size={16} className="spin" />
          {t('changes.loadingConflict')}
        </div>
      </div>
    );
  }

  if (hunks.length === 0 && !dirty) {
    const oursEmpty = oursContent.length === 0;
    const theirsEmpty = theirsContent.length === 0;
    const isBinary = !oursEmpty && !theirsEmpty && content.includes('\0');
    const isDeleteModify = oursEmpty || theirsEmpty;

    if (isBinary || isDeleteModify) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="panel p-6 max-w-md text-center">
            <AlertCircle size={28} className="mx-auto mb-3 text-status-modified" />
            <div className="text-sm font-medium mb-1">
              {isBinary ? 'Binary file conflict' : 'Delete / Modify conflict'}
            </div>
            <div className="text-xs text-text-tertiary mb-4">
              {isBinary
                ? 'This file is binary and cannot be merged with a text-based solver. Choose which version to keep.'
                : oursEmpty
                  ? 'The file was deleted on our side but modified on their side. Choose to keep theirs or delete.'
                  : 'The file was deleted on their side but modified on our side. Choose to keep ours or delete.'}
            </div>
            <div className="flex items-center justify-center gap-2">
              {!oursEmpty && (
                <button className="btn btn-secondary text-xs" title="Keep our version (git checkout --ours)"
                  onClick={async () => {
                    try {
                      await api.git.raw(repo.path, ['checkout', '--ours', '--', filePath]);
                      await api.git.add(repo.path, [filePath]);
                      toast.success('Took ours');
                      await refreshStatus(repo.path);
                      onResolved?.(filePath);
                    } catch (e) { toast.error('Failed', String(e)); }
                  }}
                >Take ours</button>
              )}
              {!theirsEmpty && (
                <button className="btn btn-secondary text-xs" title="Keep their version (git checkout --theirs)"
                  onClick={async () => {
                    try {
                      await api.git.raw(repo.path, ['checkout', '--theirs', '--', filePath]);
                      await api.git.add(repo.path, [filePath]);
                      toast.success('Took theirs');
                      await refreshStatus(repo.path);
                      onResolved?.(filePath);
                    } catch (e) { toast.error('Failed', String(e)); }
                  }}
                >Take theirs</button>
              )}
              <button className="btn btn-danger text-xs" title="Resolve as deleted (git rm)"
                onClick={async () => {
                  try {
                    await api.git.raw(repo.path, ['rm', '--', filePath]);
                    toast.success('Resolved as deleted');
                    await refreshStatus(repo.path);
                    onResolved?.(filePath);
                  } catch (e) { toast.error('Failed', String(e)); }
                }}
              >Resolve as deleted</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-status-modified" />
          <div className="text-sm font-medium mb-1">{t('changes.noConflictMarkers')}</div>
          <div className="text-xs text-text-tertiary">{t('changes.noConflictHint')}</div>
        </div>
      </div>
    );
  }

  // ===== Render: side pane content ==========================================

  /**
   * Build the display lines for the left/right panes for the current hunk.
   * Shows the OURS/THEIRS side of the conflict (just the conflicted region).
   * Surrounding context lines are NOT included for clarity (Meld default).
   */
  const currentH = hunks[currentHunkIdx];
  const oursLines = currentH?.oursLines ?? oursContent.split('\n');
  const theirsLines = currentH?.theirsLines ?? theirsContent.split('\n');

  /**
   * Render the side panes as colored, line-numbered code.
   * `side` controls whether ours/theirs is highlighted as "added" (green) —
   * both sides are shown as conflict (red bg) to mirror the screenshot.
   */
  const renderSidePane = (
    title: string,
    lines: string[],
    side: 'ours' | 'theirs',
    onTake: () => void,
    takeLabel: string,
  ) => (
    <div className="flex-1 flex flex-col border-r border-border-default last:border-r-0 min-w-0 overflow-hidden">
      {/* Pane header — branch name + commit hash + "Use" button */}
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0">
        <span className={cn(
          'truncate',
          side === 'ours' ? 'text-status-added' : 'text-status-deleted',
        )}>
          {title}
        </span>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={onTake}
          title={takeLabel}
        >
          <ArrowRight size={10} className="inline -mt-0.5" /> {side === 'ours' ? 'Take Left' : 'Take Right'}
        </button>
      </div>
      {/* Pane content — read-only line-numbered code */}
      <div className="flex-1 overflow-auto">
        {lines.length > 0 ? lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'flex font-mono text-xs leading-5 px-1',
              // Conflict region: light red/pink background (matches screenshot)
              'bg-status-conflict/10',
            )}
          >
            <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle">
              {i + 1}
            </span>
            <pre
              className={cn(
                'flex-1 pl-2 whitespace-pre-wrap break-all',
                side === 'ours' ? 'text-status-added' : 'text-status-deleted',
              )}
              style={{ fontFamily: 'inherit' }}
            >
              {line || ' '}
            </pre>
          </div>
        )) : (
          <div className="text-text-tertiary italic text-2xs p-3">
            {t('changes.emptyStage')}
          </div>
        )}
      </div>
    </div>
  );

  // ===== Render: main 3-pane view ===========================================

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ===== Top toolbar — file path, conflict count, navigation, save ===== */}
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary border-b border-border-default flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle size={14} className="text-status-conflict flex-shrink-0" />
          <span className="text-xs font-medium truncate">
            {t('changes.conflictSolverTitle')}
          </span>
          <code className="text-2xs font-mono text-text-tertiary truncate">{filePath}</code>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Conflict counter */}
          <span className="text-2xs text-text-secondary tabular-nums">
            <span className="text-status-conflict font-medium">{unresolvedCount}</span> conflicts
          </span>
          <div className="w-px h-4 bg-border-default" />
          {/* Prev / Next conflict navigation */}
          <button
            className="icon-btn"
            title="Previous conflict (Shift+F7)"
            onClick={() => setCurrentHunk((h) => Math.max(0, h - 1))}
            disabled={currentHunkIdx === 0}
          >
            <ChevronUp size={14} />
          </button>
          <span className="text-2xs mono text-text-secondary tabular-nums">
            {hunks.length > 0 ? `${currentHunkIdx + 1} / ${hunks.length}` : '— / —'}
          </span>
          <button
            className="icon-btn"
            title="Next conflict (F7)"
            onClick={() => setCurrentHunk((h) => Math.min(hunks.length - 1, h + 1))}
            disabled={hunks.length === 0 || currentHunkIdx === hunks.length - 1}
          >
            <ChevronDown size={14} />
          </button>
          <div className="w-px h-4 bg-border-default" />
          {/* VS Code integration */}
          <button
            className="btn btn-secondary text-2xs"
            title="Open in VS Code 3-way merge editor (code --merge)"
            onClick={async () => {
              try {
                const res = await api.vscode.openMerge(repo.path, filePath);
                if (res.ok) toast.success('Opened in VS Code merge editor');
                else toast.error('VS Code not found', res.detail || 'Install VS Code or configure path');
              } catch (e) { toast.error('VS Code merge failed', String(e)); }
            }}
          >
            <ExternalLink size={10} /> VS Code
          </button>
          <button
            className="btn btn-primary text-2xs"
            onClick={handleSave}
            disabled={saving}
            title="Save resolved content and stage the file (Ctrl+Enter)"
          >
            {saving ? <Loader size={11} className="spin" /> : <Check size={11} />}
            {t('changes.saveStage')}
            {dirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-status-modified inline-block" />}
          </button>
        </div>
      </div>

      {/* ===== Merge action toolbar — Take Left / Right / Both / Reset ====== */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-bg-tertiary border-b border-border-default flex-shrink-0 overflow-x-auto">
        <span className="text-2xs text-text-tertiary mr-2">Resolve:</span>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('ours')}
          title="Use OURS for this hunk (Ctrl+1)"
        >
          <ArrowLeft size={10} className="inline -mt-0.5" /> Take Left
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('both-ours-first')}
          title="Both: ours first, then theirs"
        >
          <Plus size={10} className="inline -mt-0.5" /> Both (L→R)
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('both-theirs-first')}
          title="Both: theirs first, then ours"
        >
          <Plus size={10} className="inline -mt-0.5" /> Both (R→L)
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={() => applyResolution('theirs')}
          title="Use THEIRS for this hunk (Ctrl+2)"
        >
          Take Right <ArrowRight size={10} className="inline -mt-0.5" />
        </button>
        <div className="w-px h-4 bg-border-default mx-1" />
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          onClick={resetHunk}
          title="Reset this hunk to raw conflict markers"
        >
          <RotateCcw size={10} className="inline -mt-0.5" /> Reset Hunk
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          title="Open external editor"
          onClick={() => {
            const fullPath = `${repo.path}/${filePath}`.replace(/\/+/g, '/');
            api.git.openFile(fullPath);
          }}
        >
          <ExternalLink size={10} className="inline -mt-0.5" /> External
        </button>
        <button
          className="btn btn-secondary text-2xs !py-0.5 !px-2"
          title="Run git mergetool"
          onClick={async () => {
            try {
              await api.git.raw(repo.path, ['mergetool', '--', filePath]);
              toast.success('Merge tool completed', 'Reloading file content…');
              await loadFile();
              await refreshStatus(repo.path);
            } catch (e) { toast.error('Merge tool failed', String(e)); }
          }}
        >
          <GitMerge size={10} className="inline -mt-0.5" /> Merge Tool
        </button>
      </div>

      {/* ===== 3-pane layout: Ours | Working Tree (editable) | Theirs ======== */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Ours (HEAD / current branch) — read-only */}
        {renderSidePane(
          `ours ("HEAD")`,
          oursLines,
          'ours',
          () => applyResolution('ours'),
          'Take ours for this hunk',
        )}

        {/* Middle: Working Tree — EDITABLE */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0">
            <span className="text-text-primary truncate">
              {t('changes.workingTree')}
              <span className="ml-2 text-2xs text-text-tertiary normal-case font-normal">(editable)</span>
            </span>
            {dirty && (
              <span className="text-2xs text-status-modified flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-status-modified" />
                modified
              </span>
            )}
          </div>
          {/* Editable area — contentEditable div */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleEditorInput}
            spellCheck={false}
            className="flex-1 overflow-auto p-3 font-mono text-xs leading-5 outline-none focus:bg-bg-hover/20 whitespace-pre-wrap break-all"
            style={{ minHeight: 0 }}
            data-testid="conflict-editor"
          />
        </div>

        {/* Right: Theirs (incoming branch) — read-only */}
        {renderSidePane(
          `theirs`,
          theirsLines,
          'theirs',
          () => applyResolution('theirs'),
          'Take theirs for this hunk',
        )}
      </div>

      {/* ===== Bottom status bar ===== */}
      <div className="flex items-center justify-between px-3 py-1 bg-bg-secondary border-t border-border-default text-2xs text-text-tertiary flex-shrink-0">
        <span className="flex items-center gap-1">
          <Check size={9} className="text-status-added" />
          Editable center — direct typing or use toolbar actions above.
        </span>
        <span className="font-mono">
          Shortcuts: F7 next · Shift+F7 prev · Ctrl+1 ours · Ctrl+2 theirs · Ctrl+3 both · Ctrl+Enter save
        </span>
      </div>
    </div>
  );
}
