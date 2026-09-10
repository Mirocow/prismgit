import { useState, useEffect, useCallback, useMemo } from 'react';
import { StickyNote, RefreshCw, Plus, Trash, Copy, GitCommit, CloudDownload, CloudUpload } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type NoteCategory, type CommitNote, type LogEntry } from '../lib/api';
import { cn, formatDate, shortHash, copyToClipboard } from '../lib/utils';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';

/**
 * SmartGit "Notes" feature: add/remove notes on commits, one category at a
 * time (refs/notes/<category>). Categories come from [smartgit-notes "<id>"]
 * config sections plus auto-detected refs/notes/* refs.
 */
export function NotesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const selectCommit = useSelectionStore((s) => s.selectCommit);

  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [activeCat, setActiveCat] = useState<string>('commits');
  const [notes, setNotes] = useState<CommitNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [commitMeta, setCommitMeta] = useState<Record<string, LogEntry>>({});
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCategories = useCallback(async () => {
    if (!repo) return;
    try {
      const cats = await api.git.noteCategories(repo.path);
      setCategories(cats);
      if (!cats.some((c) => c.ref === activeCat)) setActiveCat(cats[0]?.ref ?? 'commits');
    } catch (e) {
      toast.error('Failed to load note categories', String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path]);

  const loadNotes = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const list = await api.git.notesList(repo.path, activeCat, 500);
      setNotes(list);
      // Enrich with commit metadata (batched via findCommit per note is too
      // chatty for big repos — use one log pass instead)
      const meta: Record<string, LogEntry> = {};
      const hashes = new Set(list.map((n) => n.commit));
      if (hashes.size > 0) {
        const entries = await api.git.log(repo.path, { maxCount: 500, all: true });
        for (const e of entries) {
          if (hashes.has(e.hash)) meta[e.hash] = e;
        }
      }
      setCommitMeta(meta);
    } catch (e) {
      toast.error('Failed to load notes', String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path, activeCat]);

  useEffect(() => { loadCategories(); }, [loadCategories]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const filtered = useMemo(() => {
    if (!search.trim()) return notes;
    const q = search.toLowerCase();
    return notes.filter(
      (n) =>
        n.note.toLowerCase().includes(q) ||
        n.commit.startsWith(q) ||
        (commitMeta[n.commit]?.subject ?? '').toLowerCase().includes(q)
    );
  }, [notes, search, commitMeta]);

  const handleAdd = async () => {
    const message = newNote.trim();
    if (!message) return;
    setSaving(true);
    try {
      // Where to attach: the commit selected in History, else HEAD
      const selected = useSelectionStore.getState().selectedCommitHash;
      let target = selected;
      if (!target) {
        const head = await api.git.revParse(repo.path, 'HEAD');
        target = head;
      }
      const exists = notes.some((n) => n.commit === target);
      if (exists) {
        const ok = await confirmDialog({
          title: 'Overwrite note?',
          message: `A note already exists on ${shortHash(target)} in this category. Overwrite it?`,
          confirmLabel: 'Overwrite',
        });
        if (!ok) return;
      }
      await api.git.notesAdd(repo.path, activeCat, target, message, true);
      setNewNote('');
      toast.success(`Note added to ${shortHash(target)}`);
      await loadNotes();
    } catch (e) {
      toast.error('Failed to add note', String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (commit: string) => {
    const ok = await confirmDialog({
      title: 'Remove note',
      message: `Remove the note from commit ${shortHash(commit)}?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.git.notesRemove(repo.path, activeCat, commit);
      toast.success('Note removed');
      await loadNotes();
    } catch (e) {
      toast.error('Failed to remove note', String(e));
    }
  };

  const handleSyncPush = async () => {
    const remote = await promptDialog({
      title: 'Push notes',
      message: 'Push this notes ref to a remote (refs/notes are NOT pushed by default)',
      input: { initialValue: 'origin', placeholder: 'origin' },
    });
    if (!remote) return;
    try {
      await api.git.raw(repo.path, ['push', remote, `refs/notes/${activeCat}:refs/notes/${activeCat}`]);
      toast.success(`Notes pushed to ${remote}`);
    } catch (e) {
      toast.error('Failed to push notes', String(e));
    }
  };

  const handleSyncFetch = async () => {
    const remote = await promptDialog({
      title: 'Fetch notes',
      message: 'Fetch notes refs from a remote',
      input: { initialValue: 'origin', placeholder: 'origin' },
    });
    if (!remote) return;
    try {
      await api.git.raw(repo.path, ['fetch', remote, `refs/notes/${activeCat}:refs/notes/${activeCat}`]);
      toast.success(`Notes fetched from ${remote}`);
      await loadNotes();
    } catch (e) {
      toast.error('Failed to fetch notes', String(e));
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <StickyNote size={18} className="text-accent shrink-0" />
        <h1 className="text-sm font-semibold">Notes</h1>
        <div className="flex items-center gap-1 ml-2">
          {categories.map((c) => (
            <button
              key={c.ref}
              onClick={() => setActiveCat(c.ref)}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                activeCat === c.ref
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-surface hover:bg-surface-hover text-text-secondary'
              )}
              title={`refs/notes/${c.ref}`}
            >
              {c.id}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter notes…"
          className="w-48 px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent"
        />
        <button
          onClick={handleSyncFetch}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
          title="Fetch notes ref from remote"
        >
          <CloudDownload size={16} />
        </button>
        <button
          onClick={handleSyncPush}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
          title="Push notes ref to remote (notes are not pushed by default!)"
        >
          <CloudUpload size={16} />
        </button>
        <button
          onClick={() => { loadCategories(); loadNotes(); }}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
          title="Refresh (F5)"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Add note bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface/40">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAdd();
          }}
          placeholder="New note text… (attached to the commit selected in History, or HEAD). Ctrl+Enter to add"
          rows={1}
          className="flex-1 px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent resize-none"
        />
        <button
          onClick={handleAdd}
          disabled={!newNote.trim() || saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-40 shrink-0"
        >
          <Plus size={14} />
          Add Note
        </button>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-tertiary text-sm">Loading notes…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-tertiary text-sm gap-2">
            <StickyNote size={32} className="opacity-40" />
            <div>No notes in category “{activeCat}”</div>
            <div className="text-xs opacity-70">
              Add a note above, or configure categories via <code className="text-accent">git config smartgit.notes.&lt;id&gt;.ref</code>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((n) => {
              const meta = commitMeta[n.commit];
              return (
                <div key={n.commit} className="px-4 py-3 hover:bg-surface/50 group">
                  <div className="flex items-center gap-2 mb-1.5">
                    <GitCommit size={14} className="text-text-tertiary shrink-0" />
                    <CommitHashLink hash={n.commit} />
                    {meta ? (
                      <>
                        <span className="text-xs text-text-secondary truncate flex-1">{meta.subject}</span>
                        <span className="text-xs text-text-tertiary shrink-0">{meta.author.name}</span>
                        <span className="text-xs text-text-tertiary shrink-0">{formatDate(meta.author.date)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-text-tertiary flex-1">(commit details unavailable)</span>
                    )}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => copyToClipboard(n.note).then(() => toast.success('Note copied'))}
                        className="p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary"
                        title="Copy note"
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        onClick={() => handleRemove(n.commit)}
                        className="p-1 rounded hover:bg-surface-hover text-red-400"
                        title="Remove note"
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  </div>
                  <pre className="text-xs text-text-primary whitespace-pre-wrap pl-6 border-l-2 border-accent/40 ml-2.5">
                    {n.note}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
