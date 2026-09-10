/**
 * ConflictMergeView — non-modal 3-way merge view for embedding in DiffPage.
 *
 * Extracted from ConflictSolver.tsx — same core logic (parseConflicts,
 * resolveHunk, buildResolvedContent, handleSave, keyboard chords, 4 layouts)
 * but WITHOUT the `fixed inset-0 z-50` modal wrapper. Fills its parent
 * container with `flex-1 flex flex-col`.
 *
 * Usage in DiffPage: when a conflicted file is selected and a sequencer
 * state is active (merge/rebase/cherry-pick/revert), render this instead
 * of the normal 2-way DiffViewer.
 */
import { useState, useEffect, useCallback } from 'react';
import { Check, AlertCircle, Loader, ChevronLeft, ChevronRight, ExternalLink, GitMerge } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

type ConflictResolution = 'ours' | 'theirs' | 'base' | 'both-ours-first' | 'both-theirs-first' | 'manual';

interface ConflictHunk {
  startLine: number;
  oursStart: number;
  oursLines: string[];
  theirsStart: number;
  theirsLines: string[];
  endLine: number;
  resolution?: ConflictResolution;
  resolvedContent?: string[];
}

export interface ConflictMergeViewProps {
  filePath: string;
  /** Called after a file is successfully resolved & staged. */
  onResolved?: (resolvedFile: string) => void;
}

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
  const toast = useToastStore();
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<string>('');
  const [hunks, setHunks] = useState<ConflictHunk[]>([]);
  const [currentHunk, setCurrentHunk] = useState(0);
  const [saving, setSaving] = useState(false);
  const [baseContent, setBaseContent] = useState<string>('');
  const [oursContent, setOursContent] = useState<string>('');
  const [theirsContent, setTheirsContent] = useState<string>('');
  const [layout, setLayout] = useState<'3-pane' | 'merge-below' | 'left-merge' | 'right-merge'>('3-pane');

  const loadFile = useCallback(async () => {
    setLoading(true);
    try {
      const [base, ours, theirs, worktree] = await Promise.all([
        api.git.raw(repo.path, ['show', `:1:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:2:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:3:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:${filePath}`]).catch(() => ''),
      ]);
      setBaseContent(base);
      setOursContent(ours);
      setTheirsContent(theirs);
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.join(repo.path, filePath);
      const fileContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : worktree || '';
      setContent(fileContent);
      setHunks(parseConflicts(fileContent));
    } catch (e) {
      toast.error(t('changes.conflictLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, filePath, toast]);

  useEffect(() => { loadFile(); }, [loadFile]);

  const resolveHunk = (idx: number, resolution: ConflictResolution) => {
    const next = [...hunks];
    let resolved: string[];
    const h = hunks[idx];
    if (resolution === 'ours') resolved = h.oursLines;
    else if (resolution === 'theirs') resolved = h.theirsLines;
    else if (resolution === 'base') {
      const baseAll = baseContent.split('\n');
      resolved = baseAll.slice(h.startLine, Math.min(h.endLine, baseAll.length));
      if (resolved.length === 0) resolved = h.oursLines;
    } else if (resolution === 'both-ours-first') resolved = [...h.oursLines, '', ...h.theirsLines];
    else if (resolution === 'both-theirs-first') resolved = [...h.theirsLines, '', ...h.oursLines];
    else {
      const allLines = content.split('\n');
      resolved = allLines.slice(h.startLine, h.endLine);
    }
    next[idx] = { ...next[idx], resolution, resolvedContent: resolved };
    setHunks(next);
    if (idx < hunks.length - 1) setCurrentHunk(idx + 1);
  };

  const buildResolvedContent = (): string => {
    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0, hunkIdx = 0;
    while (i < lines.length) {
      if (hunkIdx < hunks.length && i === hunks[hunkIdx].startLine) {
        if (hunks[hunkIdx].resolvedContent) result.push(...hunks[hunkIdx].resolvedContent!);
        else result.push(...lines.slice(i, hunks[hunkIdx].endLine));
        i = hunks[hunkIdx].endLine;
        hunkIdx++;
      } else {
        result.push(lines[i]);
        i++;
      }
    }
    return result.join('\n');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const resolved = buildResolvedContent();
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.join(repo.path, filePath);
      fs.writeFileSync(fullPath, resolved, 'utf-8');
      await api.git.add(repo.path, [filePath]);
      toast.success(t('changes.conflictResolvedStaged'));
      await refreshStatus(repo.path);
      onResolved?.(filePath);
    } catch (e) {
      toast.error(t('changes.saveFailed'), String(e));
    } finally {
      setSaving(false);
    }
  };

  const unresolvedCount = hunks.filter((h) => !h.resolution).length;
  const resolvedCount = hunks.length - unresolvedCount;

  // Keyboard chords: F7/Shift+F7 next/prev, Mod+1/2/3 ours/theirs/both, Mod+Enter save
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) setCurrentHunk((h) => Math.max(0, h - 1));
        else setCurrentHunk((h) => Math.min(hunks.length - 1, h + 1));
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === '1') { e.preventDefault(); resolveHunk(currentHunk, 'ours'); }
      else if (e.key === '2') { e.preventDefault(); resolveHunk(currentHunk, 'theirs'); }
      else if (e.key === '3') { e.preventDefault(); resolveHunk(currentHunk, 'both-ours-first'); }
      else if (e.key === 'Enter') { e.preventDefault(); if (unresolvedCount === 0 && !saving) void handleSave(); }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [hunks, currentHunk, resolveHunk, unresolvedCount, saving, handleSave]);

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

  if (hunks.length === 0) {
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

  const hunk = hunks[currentHunk];

  const renderPane = (title: string, paneContent: string[], color: string, onUse: () => void, useLabel: string) => (
    <div className="flex-1 flex flex-col border-r border-border-default last:border-r-0">
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0">
        <span className={color}>{title}</span>
        <button className="btn btn-secondary text-2xs" onClick={onUse}>{useLabel}</button>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {paneContent.length > 0 ? paneContent.map((line, i) => (
          <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
        )) : (
          <div className="text-text-tertiary italic text-2xs">{t('changes.emptyStage')}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header — file path, conflict count, layout selector, hunk navigation */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-3">
          <AlertCircle size={16} className="text-status-conflict" />
          <span className="text-sm font-medium">{t('changes.conflictSolverTitle')}</span>
          <code className="text-xs mono text-text-tertiary">{filePath}</code>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-status-added">{t('changes.resolvedCount', { count: resolvedCount })}</span>
            <span className="text-status-conflict">{t('changes.unresolvedCount', { count: unresolvedCount })}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* VS Code integration buttons */}
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
            <ExternalLink size={11} /> VS Code Merge
          </button>
          <button
            className="btn btn-secondary text-2xs"
            title="Open VS Code diff view (ours vs theirs)"
            onClick={async () => {
              try {
                const res = await api.vscode.openFileDiff(repo.path, filePath);
                if (res.ok) toast.success('Opened in VS Code diff');
                else toast.error('VS Code not found', res.detail || 'Install VS Code or configure path');
              } catch (e) { toast.error('VS Code diff failed', String(e)); }
            }}
          >
            <GitMerge size={11} /> VS Code Diff
          </button>
          <div className="w-px h-5 bg-border-default mx-1" />
          <select
            className="text-2xs bg-bg-tertiary border border-border-default rounded px-1 py-0.5"
            value={layout}
            onChange={(e) => setLayout(e.target.value as typeof layout)}
            title={t('changes.layoutTitle')}
          >
            <option value="3-pane">{t('changes.layout3Pane')}</option>
            <option value="merge-below">{t('changes.layoutMergeBelow')}</option>
            <option value="left-merge">{t('changes.layoutLeftMerge')}</option>
            <option value="right-merge">{t('changes.layoutMergeRight')}</option>
          </select>
          <div className="w-px h-5 bg-border-default mx-1" />
          <button className="icon-btn" title={t('changes.prevConflict')} onClick={() => setCurrentHunk(Math.max(0, currentHunk - 1))} disabled={currentHunk === 0}>
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs mono">{currentHunk + 1} / {hunks.length}</span>
          <button className="icon-btn" title={t('changes.nextConflict')} onClick={() => setCurrentHunk(Math.min(hunks.length - 1, currentHunk + 1))} disabled={currentHunk === hunks.length - 1}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* 3-pane view: Base | Ours | Theirs */}
      {layout === '3-pane' && (
        <div className="flex-1 overflow-hidden flex">
          {renderPane(t('changes.paneBase'),
            hunk.oursLines.length > 0 || hunk.theirsLines.length > 0 ? baseContent.split('\n').slice(0, Math.max(hunk.oursLines.length, hunk.theirsLines.length) + 2) : [],
            'text-text-tertiary', () => resolveHunk(currentHunk, 'base'), t('changes.useBase'))}
          {renderPane(t('changes.paneOurs'), hunk.oursLines, 'text-status-added', () => resolveHunk(currentHunk, 'ours'), t('changes.useOurs'))}
          {renderPane(t('changes.paneTheirs'), hunk.theirsLines, 'text-status-deleted', () => resolveHunk(currentHunk, 'theirs'), t('changes.useTheirs'))}
        </div>
      )}

      {/* Merge Below layout */}
      {layout === 'merge-below' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 flex">
            {renderPane(t('changes.paneOurs'), hunk.oursLines, 'text-status-added', () => resolveHunk(currentHunk, 'ours'), t('changes.useOurs'))}
            {renderPane(t('changes.paneTheirs'), hunk.theirsLines, 'text-status-deleted', () => resolveHunk(currentHunk, 'theirs'), t('changes.useTheirs'))}
          </div>
          <div className="h-1/3 flex border-t border-border-strong">
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-1 bg-bg-tertiary border-b border-border-default text-xs font-medium text-text-secondary">
                {t('changes.workingTreeMerged')}
                {hunk.resolution && <span className="ml-2 badge badge-added">{hunk.resolution}</span>}
              </div>
              <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                {hunk.resolution ? hunk.resolvedContent?.map((line, i) => (
                  <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
                )) : <div className="text-text-tertiary italic">{t('changes.selectResolutionPopulate')}</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Left + Merge layout */}
      {layout === 'left-merge' && (
        <div className="flex-1 overflow-hidden flex">
          {renderPane(t('changes.paneOurs'), hunk.oursLines, 'text-status-added', () => resolveHunk(currentHunk, 'ours'), t('changes.useOurs'))}
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1 bg-bg-tertiary border-b border-border-default text-xs font-medium text-text-secondary">
              {t('changes.workingTree')} {hunk.resolution && <span className="ml-2 badge badge-added">{hunk.resolution}</span>}
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {hunk.resolution ? hunk.resolvedContent?.map((line, i) => (
                <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
              )) : <div className="text-text-tertiary italic">{t('changes.selectResolution')}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Merge + Right layout */}
      {layout === 'right-merge' && (
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1 bg-bg-tertiary border-b border-border-default text-xs font-medium text-text-secondary">
              {t('changes.workingTree')} {hunk.resolution && <span className="ml-2 badge badge-added">{hunk.resolution}</span>}
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {hunk.resolution ? hunk.resolvedContent?.map((line, i) => (
                <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
              )) : <div className="text-text-tertiary italic">{t('changes.selectResolution')}</div>}
            </div>
          </div>
          {renderPane(t('changes.paneTheirs'), hunk.theirsLines, 'text-status-deleted', () => resolveHunk(currentHunk, 'theirs'), t('changes.useTheirs'))}
        </div>
      )}

      {/* Action bar — Both/Reset/External/Merge Tool/VS Code/Save & Stage */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-secondary border-t border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary text-xs" onClick={() => resolveHunk(currentHunk, 'both-ours-first')} title={t('changes.concatOursTheirs')}>
            {t('changes.bothOursFirst')}
          </button>
          <button className="btn btn-secondary text-xs" onClick={() => resolveHunk(currentHunk, 'both-theirs-first')} title={t('changes.concatTheirsOurs')}>
            {t('changes.bothTheirsFirst')}
          </button>
          <button className="btn btn-secondary text-xs" onClick={() => {
            const next = [...hunks];
            next[currentHunk] = { ...next[currentHunk], resolution: undefined, resolvedContent: undefined };
            setHunks(next);
          }}>{t('changes.resetButton')}</button>
          <button className="btn btn-secondary text-xs" title={t('changes.openExternalEditor')} onClick={() => {
            const fullPath = `${repo.path}/${filePath}`.replace(/\/+/g, '/');
            api.git.openFile(fullPath);
          }}>
            <ExternalLink size={11} /> {t('changes.external')}
          </button>
          <button className="btn btn-secondary text-xs" title="Run git mergetool (uses your configured merge.tool)" onClick={async () => {
            try {
              await api.git.raw(repo.path, ['mergetool', '--', filePath]);
              toast.success('Merge tool completed', 'Reloading file content…');
              await loadFile();
              await refreshStatus(repo.path);
            } catch (e) { toast.error('Merge tool failed', String(e)); }
          }}>
            <GitMerge size={11} /> Merge Tool
          </button>
        </div>
        <button className="btn btn-primary text-xs" onClick={handleSave} disabled={saving || unresolvedCount > 0}
          title={unresolvedCount > 0 ? t('changes.resolveAllFirst') : t('changes.saveResolvedTitle')}>
          {saving ? <Loader size={12} className="spin" /> : <Check size={12} />}
          {t('changes.saveStage')}
        </button>
      </div>
    </div>
  );
}
