import { useState, useEffect, useCallback } from 'react';
import { Tag as TagIcon, Plus, Trash, RefreshCw, Check } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { CommitHashLink } from '../components/StatusBar';
import { api, type TagInfo } from '../lib/api';
import { shortHash } from '../lib/utils';

export function TagsPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [ref, setRef] = useState('HEAD');
  const [annotated, setAnnotated] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.tags(repo.path);
      setTags(result);
    } catch (e) {
      toast.error('Failed to load tags', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.warning('Tag name is required');
      return;
    }
    try {
      await api.git.createTag(repo.path, name, annotated ? message : undefined, ref || undefined);
      toast.success(`Tag '${name}' created`);
      setShowDialog(false);
      setName('');
      setMessage('');
      setRef('HEAD');
      setAnnotated(true);
      await load();
    } catch (e) {
      toast.error('Failed to create tag', String(e));
    }
  };

  const handleDelete = async (tag: TagInfo) => {
    if (!confirm(`Delete tag '${tag.name}'?`)) return;
    try {
      await api.git.deleteTag(repo.path, tag.name);
      toast.success(`Tag '${tag.name}' deleted`);
      await load();
    } catch (e) {
      toast.error('Failed to delete tag', String(e));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Tags</span>
          <span className="text-2xs text-text-tertiary">{tags.length} tags</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => setShowDialog(true)}
          >
            <Plus size={12} />
            New Tag
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <TagIcon size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No tags</div>
            <div className="text-xs mt-1">Create a tag to mark a release or important commit</div>
          </div>
        ) : (
          tags.map((t) => (
            <div
              key={t.name}
              className="group flex items-center gap-3 px-3 py-2 border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
              onClick={() => {
                useSelectionStore.getState().selectCommit(t.hash);
                window.location.hash = '#/history';
              }}
              title="Click to view this tag's commit in History"
            >
              <TagIcon size={14} className="text-status-modified flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{t.name}</span>
                  {!t.lightweight && (
                    <span className="badge badge-modified">ANNOTATED</span>
                  )}
                </div>
                {t.annotation && (
                  <div className="text-xs text-text-secondary truncate mt-0.5">
                    {t.annotation}
                  </div>
                )}
                <div className="text-xs text-text-tertiary mt-0.5">
                  <CommitHashLink hash={t.hash} />
                </div>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 icon-btn !w-6 !h-6 hover:!text-status-deleted"
                title="Delete"
                onClick={() => handleDelete(t)}
              >
                <Trash size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      {showDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowDialog(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">New Tag</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Name</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="v1.0.0"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Reference</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="HEAD, branch name, or commit hash"
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={annotated}
                  onChange={(e) => setAnnotated(e.target.checked)}
                />
                Annotated tag
              </label>
              {annotated && (
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">Message</label>
                  <textarea
                    className="w-full text-sm h-20 resize-none"
                    placeholder="Release v1.0.0"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                <Check size={13} />
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
