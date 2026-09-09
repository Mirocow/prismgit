import { useState, useEffect, useCallback } from 'react';
import { X, Check, AlertCircle, Loader, ChevronLeft, ChevronRight, ExternalLink } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

type ConflictResolution = 'ours' | 'theirs' | 'both' | 'manual';

interface ConflictFile {
  path: string;
  // Three-way content
  oursContent: string;
  theirsContent: string;
  baseContent: string;
  // Conflict markers parsed
  conflicts: ConflictHunk[];
}

interface ConflictHunk {
  startLine: number;
  baseStart: number;
  baseLines: string[];
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
      const baseStart = i + 1; // after =======
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
        baseStart,
        baseLines: [], // base not available in markers
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

  const loadFile = useCallback(async () => {
    setLoading(true);
    try {
      // Read the working tree file with conflict markers
      const result = await api.git.raw(repo.path, ['show', `:${filePath}`]);
      // Actually, we need the working tree file, not staged
      // Use fs via raw
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.join(repo.path, filePath);
      const fileContent = fs.existsSync(fullPath)
        ? fs.readFileSync(fullPath, 'utf-8')
        : '';
      setContent(fileContent);
      const parsed = parseConflicts(fileContent);
      setHunks(parsed);
    } catch (e) {
      toast.error('Failed to load file', String(e));
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
    if (resolution === 'ours') {
      resolved = hunks[idx].oursLines;
    } else if (resolution === 'theirs') {
      resolved = hunks[idx].theirsLines;
    } else if (resolution === 'both') {
      resolved = [...hunks[idx].oursLines, '', ...hunks[idx].theirsLines];
    } else {
      resolved = hunks[idx].oursLines; // default to ours for manual
    }
    next[idx] = { ...next[idx], resolution, resolvedContent: resolved };
    setHunks(next);
    // Move to next conflict
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
          // Unresolved — keep original
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
          Loading conflict...
        </div>
      </div>
    );
  }

  if (hunks.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
        <div className="panel p-8 text-center" onClick={(e) => e.stopPropagation()}>
          <AlertCircle size={32} className="mx-auto mb-3 text-status-modified" />
          <div className="text-sm font-medium mb-1">No conflicts found</div>
          <div className="text-xs text-text-tertiary mb-4">This file may not have conflict markers</div>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const hunk = hunks[currentHunk];

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

      {/* Three-pane view */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Ours */}
        <div className="flex-1 flex flex-col border-r border-border-default">
          <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between">
            <span className="text-status-added">Ours (HEAD)</span>
            <button
              className="btn btn-secondary text-2xs"
              onClick={() => resolveHunk(currentHunk, 'ours')}
              disabled={hunk.resolution === 'ours'}
            >
              Use ours
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3 font-mono text-xs">
            {hunk.oursLines.map((line, i) => (
              <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
            ))}
          </div>
        </div>

        {/* Center: Working tree (merged result) */}
        <div className="flex-1 flex flex-col border-r border-border-default bg-bg-elevated">
          <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between">
            <span className="text-text-secondary">Working Tree</span>
            {hunk.resolution && (
              <span className="badge badge-added">RESOLVED: {hunk.resolution}</span>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3 font-mono text-xs">
            {hunk.resolution ? (
              hunk.resolvedContent?.map((line, i) => (
                <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
              ))
            ) : (
              <div className="text-text-tertiary italic">
                Select a resolution (ours, theirs, or both) to populate this view
              </div>
            )}
          </div>
        </div>

        {/* Right: Theirs */}
        <div className="flex-1 flex flex-col">
          <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border-default text-xs font-medium flex items-center justify-between">
            <span className="text-status-deleted">Theirs (incoming)</span>
            <button
              className="btn btn-secondary text-2xs"
              onClick={() => resolveHunk(currentHunk, 'theirs')}
              disabled={hunk.resolution === 'theirs'}
            >
              Use theirs
            </button>
          </div>
          <div className="flex-1 overflow-auto p-3 font-mono text-xs">
            {hunk.theirsLines.map((line, i) => (
              <div key={i} className="text-text-primary whitespace-pre">{line || ' '}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-secondary border-t border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-secondary text-xs"
            onClick={() => resolveHunk(currentHunk, 'both')}
            disabled={hunk.resolution === 'both'}
          >
            Use both (concatenate)
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
          >
            {saving ? <Loader size={12} className="spin" /> : <Check size={12} />}
            Save & Stage
          </button>
        </div>
      </div>
    </div>
  );
}
