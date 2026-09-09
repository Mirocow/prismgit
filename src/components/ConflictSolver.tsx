import { useState, useEffect, useCallback } from 'react';
import { X, Check, AlertCircle, Loader, ChevronLeft, ChevronRight, ExternalLink } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

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

interface ConflictSolverProps {
  filePath: string;
  onClose: () => void;
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
      hunks.push({
        startLine,
        oursStart,
        oursLines,
        theirsStart,
        theirsLines,
        endLine: i,
      });
    } else {
      i++;
    }
  }
  return hunks;
}

export function ConflictSolver({ filePath, onClose }: ConflictSolverProps) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<string>('');
  const [hunks, setHunks] = useState<ConflictHunk[]>([]);
  const [currentHunk, setCurrentHunk] = useState(0);
  const [saving, setSaving] = useState(false);
  // 3-way content from git stages
  const [baseContent, setBaseContent] = useState<string>('');
  const [oursContent, setOursContent] = useState<string>('');
  const [theirsContent, setTheirsContent] = useState<string>('');
  const [layout, setLayout] = useState<'3-pane' | 'merge-below' | 'left-merge' | 'right-merge'>('3-pane');

  const loadFile = useCallback(async () => {
    setLoading(true);
    try {
      // Load all 3 stages from git
      const [base, ours, theirs, worktree] = await Promise.all([
        api.git.raw(repo.path, ['show', `:1:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:2:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:3:${filePath}`]).catch(() => ''),
        api.git.raw(repo.path, ['show', `:${filePath}`]).catch(() => ''),
      ]);

      setBaseContent(base);
      setOursContent(ours);
      setTheirsContent(theirs);

      // Read working tree file
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.join(repo.path, filePath);
      const fileContent = fs.existsSync(fullPath)
        ? fs.readFileSync(fullPath, 'utf-8')
        : worktree || '';
      setContent(fileContent);
      const parsed = parseConflicts(fileContent);
      setHunks(parsed);
    } catch (e) {
      toast.error('Failed to load conflict', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, filePath, toast]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const resolveHunk = (idx: number, resolution: ConflictResolution) => {
    const next = [...hunks];
    let resolved: string[];
    const h = hunks[idx];
    if (resolution === 'ours') {
      resolved = h.oursLines;
    } else if (resolution === 'theirs') {
      resolved = h.theirsLines;
    } else if (resolution === 'both-ours-first') {
      resolved = [...h.oursLines, '', ...h.theirsLines];
    } else if (resolution === 'both-theirs-first') {
      resolved = [...h.theirsLines, '', ...h.oursLines];
    } else {
      resolved = h.oursLines;
    }
    next[idx] = { ...next[idx], resolution, resolvedContent: resolved };
    setHunks(next);
    if (idx < hunks.length - 1) {
      setCurrentHunk(idx + 1);
    }
  };

  const buildResolvedContent = (): string => {
    const lines = content.split('\n');
    const result: string[] = [];
    let i = 0;
    let hunkIdx = 0;
    while (i < lines.length) {
      if (hunkIdx < hunks.length && i === hunks[hunkIdx].startLine) {
        if (hunks[hunkIdx].resolvedContent) {
          result.push(...hunks[hunkIdx].resolvedContent!);
        } else {
          result.push(...lines.slice(i, hunks[hunkIdx].endLine));
        }
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
      toast.success('Conflict resolved and staged');
      await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      toast.error('Failed to save', String(e));
    } finally {
      setSaving(false);
    }
  };

  const unresolvedCount = hunks.filter((h) => !h.resolution).length;
  const resolvedCount = hunks.length - unresolvedCount;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="text-text-tertiary text-sm flex items-center gap-2">
          <Loader size={16} className="spin" />
          Loading 3-way conflict...
        </div>
      </div>
    );
  }

  if (hunks.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
        <div className="panel p-8 text-center" onClick={(e) => e.stopPropagation()}>
          <AlertCircle size={32} className="mx-auto mb-3 text-status-modified" />
          <div className="text-sm font-medium mb-1">No conflict markers found</div>
          <div className="text-xs text-text-tertiary mb-4">This file may have been resolved already or has no conflicts.</div>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const hunk = hunks[currentHunk];

  const renderPane = (title: string, content: string[], color: string, onUse: () => void, useLabel: string) => (
    <div className="flex-1 flex flex-col border-r border-border-default last:border-r-0">
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between flex-shrink-0">
        <span className={color}>{title}</span>
        <button
          className="btn btn-secondary text-2xs"
          onClick={onUse}
        >
          {useLabel}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {content.length > 0 ? content.map((line, i) => (
          <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
        )) : (
          <div className="text-text-tertiary italic text-2xs">(empty — no content at this stage)</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 flex flex-col z-50 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-3">
          <AlertCircle size={16} className="text-status-conflict" />
          <span className="text-sm font-medium">Conflict Solver</span>
          <code className="text-xs mono text-text-tertiary">{filePath}</code>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-status-added">Resolved: {resolvedCount}</span>
            <span className="text-status-conflict">Unresolved: {unresolvedCount}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Layout selector */}
          <select
            className="text-2xs bg-bg-tertiary border border-border-default rounded px-1 py-0.5"
            value={layout}
            onChange={(e) => setLayout(e.target.value as typeof layout)}
            title="Layout"
          >
            <option value="3-pane">3-Pane (Base | Ours | Theirs)</option>
            <option value="merge-below">Merge Below</option>
            <option value="left-merge">Left + Merge</option>
            <option value="right-merge">Merge + Right</option>
          </select>
          <div className="w-px h-5 bg-border-default mx-1" />
          <button
            className="icon-btn"
            title="Previous conflict"
            onClick={() => setCurrentHunk(Math.max(0, currentHunk - 1))}
            disabled={currentHunk === 0}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs mono">{currentHunk + 1} / {hunks.length}</span>
          <button
            className="icon-btn"
            title="Next conflict"
            onClick={() => setCurrentHunk(Math.min(hunks.length - 1, currentHunk + 1))}
            disabled={currentHunk === hunks.length - 1}
          >
            <ChevronRight size={14} />
          </button>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Three-pane view: Base | Ours | Theirs */}
      {layout === '3-pane' && (
        <div className="flex-1 overflow-hidden flex">
          {renderPane(
            'Base (common ancestor)', 
            hunk.oursLines.length > 0 || hunk.theirsLines.length > 0 ? baseContent.split('\n').slice(0, Math.max(hunk.oursLines.length, hunk.theirsLines.length) + 2) : [],
            'text-text-tertiary',
            () => resolveHunk(currentHunk, 'base'),
            'Use base'
          )}
          {renderPane(
            'Ours (HEAD)', 
            hunk.oursLines,
            'text-status-added',
            () => resolveHunk(currentHunk, 'ours'),
            'Use ours'
          )}
          {renderPane(
            'Theirs (incoming)', 
            hunk.theirsLines,
            'text-status-deleted',
            () => resolveHunk(currentHunk, 'theirs'),
            'Use theirs'
          )}
        </div>
      )}

      {/* Merge Below layout */}
      {layout === 'merge-below' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 flex">
            {renderPane('Ours (HEAD)', hunk.oursLines, 'text-status-added', () => resolveHunk(currentHunk, 'ours'), 'Use ours')}
            {renderPane('Theirs (incoming)', hunk.theirsLines, 'text-status-deleted', () => resolveHunk(currentHunk, 'theirs'), 'Use theirs')}
          </div>
          <div className="h-1/3 flex border-t border-border-strong">
            <div className="flex-1 flex flex-col">
              <div className="px-3 py-1 bg-bg-tertiary border-b border-border-default text-xs font-medium text-text-secondary">
                Working Tree (merged result)
                {hunk.resolution && <span className="ml-2 badge badge-added">{hunk.resolution}</span>}
              </div>
              <div className="flex-1 overflow-auto p-3 font-mono text-xs">
                {hunk.resolution ? (
                  hunk.resolvedContent?.map((line, i) => (
                    <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
                  ))
                ) : (
                  <div className="text-text-tertiary italic">Select a resolution to populate</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Left + Merge layout */}
      {layout === 'left-merge' && (
        <div className="flex-1 overflow-hidden flex">
          {renderPane('Ours (HEAD)', hunk.oursLines, 'text-status-added', () => resolveHunk(currentHunk, 'ours'), 'Use ours')}
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1 bg-bg-tertiary border-b border-border-default text-xs font-medium text-text-secondary">
              Working Tree {hunk.resolution && <span className="ml-2 badge badge-added">{hunk.resolution}</span>}
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {hunk.resolution ? hunk.resolvedContent?.map((line, i) => (
                <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
              )) : <div className="text-text-tertiary italic">Select a resolution</div>}
            </div>
          </div>
        </div>
      )}

      {/* Merge + Right layout */}
      {layout === 'right-merge' && (
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1 bg-bg-tertiary border-b border-border-default text-xs font-medium text-text-secondary">
              Working Tree {hunk.resolution && <span className="ml-2 badge badge-added">{hunk.resolution}</span>}
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {hunk.resolution ? hunk.resolvedContent?.map((line, i) => (
                <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
              )) : <div className="text-text-tertiary italic">Select a resolution</div>}
            </div>
          </div>
          {renderPane('Theirs (incoming)', hunk.theirsLines, 'text-status-deleted', () => resolveHunk(currentHunk, 'theirs'), 'Use theirs')}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-secondary border-t border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-secondary text-xs"
            onClick={() => resolveHunk(currentHunk, 'both-ours-first')}
            title="Concatenate ours + theirs"
          >
            Both (ours first)
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => resolveHunk(currentHunk, 'both-theirs-first')}
            title="Concatenate theirs + ours"
          >
            Both (theirs first)
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => {
              const next = [...hunks];
              next[currentHunk] = { ...next[currentHunk], resolution: undefined, resolvedContent: undefined };
              setHunks(next);
            }}
          >
            Reset
          </button>
          <button
            className="btn btn-secondary text-xs"
            title="Open in external editor"
            onClick={() => {
              const fullPath = `${repo.path}/${filePath}`.replace(/\/+/g, '/');
              api.git.openFile(fullPath);
            }}
          >
            <ExternalLink size={11} />
            External
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary text-xs" onClick={onClose}>
            Save & Close (keep markers)
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={handleSave}
            disabled={saving || unresolvedCount > 0}
            title={unresolvedCount > 0 ? 'Resolve all conflicts first' : 'Save resolved content and stage'}
          >
            {saving ? <Loader size={12} className="spin" /> : <Check size={12} />}
            Save & Stage
          </button>
        </div>
      </div>
    </div>
  );
}
