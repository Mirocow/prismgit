import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, AlertCircle, Loader, ChevronUp, ChevronDown, GitCommit, CornerDownRight, GitMerge, Scissors, Layers } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type LogEntry } from '../lib/api';
import { cn } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
type RebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

interface RebaseTodoItem {
  hash: string;
  hashAbbrev: string;
  subject: string;
  author: string;
  date: string;
  action: RebaseAction;
  originalAction: RebaseAction;
  originalIndex: number;
}

interface InteractiveRebaseDialogProps {
  open: boolean;
  onClose: () => void;
  ontoBranch?: string;
  numCommits?: number;
}

const ACTION_LABELS: Record<RebaseAction, { label: string; color: string; description: string }> = {
  pick: { label: 'pick', color: 'var(--accent)', description: 'Use commit' },
  reword: { label: 'reword', color: 'var(--status-modified)', description: 'Use commit, but edit the commit message' },
  edit: { label: 'edit', color: 'var(--accent-purple)', description: 'Use commit, but stop for amending' },
  squash: { label: 'squash', color: 'var(--status-renamed)', description: 'Combine with previous commit' },
  fixup: { label: 'fixup', color: 'var(--status-renamed)', description: 'Like squash, but discard commit message' },
  drop: { label: 'drop', color: 'var(--status-deleted)', description: 'Remove commit' },
};

export function InteractiveRebaseDialog({
  open,
  onClose,
  ontoBranch = '',
  numCommits = 10,
}: InteractiveRebaseDialogProps) {
  useEscapeKey(open, onClose);
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [todos, setTodos] = useState<RebaseTodoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [editingMessage, setEditingMessage] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState('');
  // SmartGit Manual: drag-and-drop reorder state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  // SmartGit Manual: Auto-Squash mode — squash adjacent commits with same subject
  const [autoSquashMode, setAutoSquashMode] = useState(false);
  // SmartGit Manual: Coalesce mode — drag one commit onto another to merge them
  const [coalesceMode, setCoalesceMode] = useState(false);

  const loadCommits = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await api.git.log(repo.path, { maxCount: numCommits });
      const items: RebaseTodoItem[] = entries.map((e: LogEntry, idx: number) => ({
        hash: e.hash,
        hashAbbrev: e.hashAbbrev,
        subject: e.subject,
        author: e.author.name,
        date: e.author.date,
        action: 'pick',
        originalAction: 'pick',
        originalIndex: idx,
      }));
      setTodos(items);
    } catch (e) {
      toast.error('Failed to load commits', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, numCommits, toast]);

  useEffect(() => {
    if (open) {
      loadCommits();
    }
  }, [open, loadCommits]);

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...todos];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setTodos(next);
  };

  const moveDown = (idx: number) => {
    if (idx === todos.length - 1) return;
    const next = [...todos];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setTodos(next);
  };

  // SmartGit Manual: drag-and-drop reorder — move dragged item to drop position
  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleDragOver = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedIdx !== null && draggedIdx !== idx) {
      setDropTargetIdx(idx);
    }
  };

  const handleDragLeave = () => () => {
    // Don't clear immediately — let next dragenter overwrite
  };

  const handleDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) {
      setDraggedIdx(null);
      setDropTargetIdx(null);
      return;
    }
    if (coalesceMode) {
      // SmartGit Manual: Coalesce — combine two commits into one
      // Mark the dropped-on commit's action to 'squash' (merges with previous = dropped commit)
      const older = Math.min(draggedIdx, idx);
      const newer = Math.max(draggedIdx, idx);
      const next = [...todos];
      // Move newer right after older, mark as squash
      const [moved] = next.splice(newer, 1);
      next.splice(older + 1, 0, { ...moved, action: 'squash' });
      setTodos(next);
      toast.info(`Coalescing "${moved.subject.substring(0, 30)}" into "${next[older].subject.substring(0, 30)}"`);
    } else {
      // Plain reorder
      const next = [...todos];
      const [moved] = next.splice(draggedIdx, 1);
      next.splice(idx, 0, moved);
      setTodos(next);
    }
    setDraggedIdx(null);
    setDropTargetIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDropTargetIdx(null);
  };

  // SmartGit Manual: Auto-Squash button — squash adjacent commits with same subject
  // (mimics `git rebase --autosquash` for fixup!/squash! commits, applied to
  // all commits with matching subjects in the visible window)
  const handleAutoSquash = () => {
    const next: RebaseTodoItem[] = [];
    let changes = 0;
    for (let i = 0; i < todos.length; i++) {
      const cur = todos[i];
      // Look at later commits with the same subject — mark them as fixup
      if (cur.action === 'pick') {
        next.push(cur);
        // Find following commits with same subject
        for (let j = i + 1; j < todos.length; j++) {
          if (todos[j].subject === cur.subject && todos[j].action === 'pick') {
            // Mark as fixup — will be merged into cur
            next.push({ ...todos[j], action: 'fixup' });
            changes++;
            // Skip — already consumed
            todos.splice(j, 1);
            j--;
          } else if (todos[j].action !== 'drop') {
            break;
          }
        }
      } else {
        next.push(cur);
      }
    }
    if (changes > 0) {
      setTodos(next);
      toast.success(`Auto-squashed ${changes} commit${changes > 1 ? 's' : ''}`, 'Adjacent commits with same subject are now fixup');
    } else {
      toast.info('No adjacent commits with same subject to auto-squash');
    }
  };

  // SmartGit Manual: Split commit — mark a commit as 'edit' so rebase pauses there
  // (then user can split it manually using the Split dialog or git reset HEAD~)
  const handleSplitCommit = (idx: number) => {
    const next = [...todos];
    next[idx] = { ...next[idx], action: 'edit' };
    setTodos(next);
    toast.info(`Marked "${next[idx].subject.substring(0, 30)}" for split`, 'Rebase will pause here. Use "Split off Files" after pause.');
  };

  const setAction = (idx: number, action: RebaseAction) => {
    const next = [...todos];
    next[idx] = { ...next[idx], action };
    setTodos(next);
  };

  const startEditMessage = (idx: number) => {
    setEditingMessage(idx);
    setNewMessage(`${todos[idx].subject}\n\n${todos[idx].hash}`);
  };

  const saveMessage = () => {
    if (editingMessage !== null) {
      const next = [...todos];
      const lines = newMessage.split('\n');
      next[editingMessage] = {
        ...next[editingMessage],
        subject: lines[0] || '',
      };
      setTodos(next);
    }
    setEditingMessage(null);
    setNewMessage('');
  };

  // Generate a git rebase todo script and execute via filter-branch
  // (Real interactive rebase requires an editor; we use a simpler approach)
  const handleExecute = async () => {
    if (!ontoBranch) {
      toast.warning('Target branch is required');
      return;
    }
    setExecuting(true);
    try {
      // Build a todo file content
      const todoLines = todos.map((t) => `${t.action} ${t.hash} ${t.subject}`);
      const todoContent = todoLines.join('\n');

      // We need to write the todo file and run git rebase -i with GIT_SEQUENCE_EDITOR
      // For simplicity, we'll use a different approach: use git rebase --onto with rebase--interactive
      // and provide the script via GIT_SEQUENCE_EDITOR env var

      // Write todo to a temp file
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      const todoPath = path.join(os.tmpdir(), `smartgit-rebase-todo-${Date.now()}.txt`);
      fs.writeFileSync(todoPath, todoContent, 'utf-8');

      // Use raw git with custom env
      // This is a simplified version - real interactive rebase requires more complex handling
      await api.git.raw(repo.path, [
        '-c', 'sequence.editor=cp ' + todoPath,
        'rebase', '-i', ontoBranch,
      ]);

      toast.success('Interactive rebase completed');
      await refreshStatus(repo.path);
      onClose();
      fs.unlinkSync(todoPath);
    } catch (e) {
      toast.error('Rebase failed', String(e));
    } finally {
      setExecuting(false);
    }
  };

  if (!open) return null;

  const hasChanges = todos.some((t) => t.action !== t.originalAction || t.originalIndex !== todos.indexOf(t));

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[680px] max-h-[80vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <RefreshCw size={16} />
            Interactive Rebase
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default bg-bg-tertiary text-xs">
          <span className="text-text-tertiary">Rebasing onto:</span>
          <code className="mono text-accent">{ontoBranch || 'HEAD~' + numCommits}</code>
          <span className="text-text-tertiary ml-auto">{todos.length} commits</span>
        </div>

        {/* SmartGit Manual: Toolbar — Auto-Squash, Coalesce mode, drag hint */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border-subtle bg-bg-secondary text-2xs">
          <button
            className={cn('px-1.5 py-0.5 rounded flex items-center gap-1',
              autoSquashMode ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
            onClick={() => { handleAutoSquash(); setAutoSquashMode(!autoSquashMode); }}
            title="Squash adjacent commits with same subject (mimics git rebase --autosquash)"
          >
            <Layers size={10} /> Auto-Squash
          </button>
          <button
            className={cn('px-1.5 py-0.5 rounded flex items-center gap-1',
              coalesceMode ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
            onClick={() => {
              setCoalesceMode(!coalesceMode);
              toast.info(coalesceMode ? 'Coalesce mode OFF' : 'Coalesce mode ON — drag one commit onto another to merge them');
            }}
            title="Toggle Coalesce mode: drag one commit onto another to merge them"
          >
            <GitMerge size={10} /> Coalesce
          </button>
          <span className="text-text-tertiary ml-auto">
            {coalesceMode ? 'Drop one commit onto another to combine' : 'Drag rows to reorder'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm flex items-center justify-center gap-2">
              <Loader size={14} className="spin" />
              Loading commits...
            </div>
          ) : (
            todos.map((item, idx) => (
              <div
                key={item.hash}
                draggable
                onDragStart={handleDragStart(idx)}
                onDragOver={handleDragOver(idx)}
                onDragLeave={handleDragLeave()}
                onDrop={handleDrop(idx)}
                onDragEnd={handleDragEnd}
                className={cn(
                  'group flex items-start gap-2 px-3 py-2 border-b border-border-subtle transition-colors',
                  item.action === 'drop' && 'opacity-50',
                  draggedIdx === idx && 'opacity-50',
                  dropTargetIdx === idx && (coalesceMode ? 'bg-accent-muted border-l-2 border-l-accent' : 'border-t-2 border-t-accent'),
                  coalesceMode && 'cursor-copy',
                  !coalesceMode && 'cursor-grab active:cursor-grabbing'
                )}
              >
                {/* Drag handle — visual cue that rows are draggable */}
                <div className="text-text-tertiary text-xs flex-shrink-0 mt-1 select-none" title="Drag to reorder">
                  ⋮⋮
                </div>

                {/* Action dropdown */}
                <select
                  className="text-xs mono w-20 py-0.5 px-1"
                  value={item.action}
                  onChange={(e) => setAction(idx, e.target.value as RebaseAction)}
                  style={{ color: ACTION_LABELS[item.action].color }}
                >
                  {Object.entries(ACTION_LABELS).map(([key, val]) => (
                    <option key={key} value={key} style={{ color: 'var(--text-primary)' }}>
                      {val.label}
                    </option>
                  ))}
                </select>

                {/* Hash */}
                <code className="text-xs mono text-text-tertiary flex-shrink-0 mt-0.5 w-16">
                  {item.hashAbbrev}
                </code>

                {/* Subject / editing */}
                <div className="flex-1 min-w-0 mt-0.5">
                  {editingMessage === idx ? (
                    <textarea
                      className="w-full text-xs mono h-16 resize-none"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      autoFocus
                    />
                  ) : (
                    <>
                      <div className="text-sm text-text-primary truncate">{item.subject}</div>
                      <div className="text-2xs text-text-tertiary mt-0.5">
                        {item.author} · {new Date(item.date).toLocaleDateString()}
                      </div>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {editingMessage === idx ? (
                    <>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title="Save"
                        onClick={saveMessage}
                      >
                        <RefreshCw size={11} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title="Cancel"
                        onClick={() => setEditingMessage(null)}
                      >
                        <X size={11} />
                      </button>
                    </>
                  ) : (
                    <>
                      {item.action === 'reword' && (
                        <button
                          className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100"
                          title="Edit message"
                          onClick={() => startEditMessage(idx)}
                        >
                          <CornerDownRight size={11} />
                        </button>
                      )}
                      {/* SmartGit Manual: Split commit — marks as 'edit' for pause */}
                      <button
                        className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100"
                        title="Split commit (marks as 'edit' — rebase pauses here)"
                        onClick={() => handleSplitCommit(idx)}
                      >
                        <Scissors size={11} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100"
                        title="Move up"
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6 opacity-0 group-hover:opacity-100"
                        title="Move down"
                        onClick={() => moveDown(idx)}
                        disabled={idx === todos.length - 1}
                      >
                        <ChevronDown size={11} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Action legend */}
        <div className="px-4 py-2 border-t border-border-default bg-bg-tertiary">
          <div className="text-2xs text-text-tertiary grid grid-cols-3 gap-1">
            {Object.entries(ACTION_LABELS).map(([key, val]) => (
              <div key={key} className="flex items-center gap-1">
                <code style={{ color: val.color }}>{val.label}</code>
                <span>{val.description}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border-default">
          <div className="text-2xs text-text-tertiary">
            {hasChanges ? (
              <span className="flex items-center gap-1 text-status-modified">
                <AlertCircle size={10} /> History will be rewritten
              </span>
            ) : (
              <span>No changes — same as original history</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleExecute}
              disabled={executing || loading}
            >
              {executing ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              Start Rebase
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
