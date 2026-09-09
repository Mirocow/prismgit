import { useState, useEffect, useCallback } from 'react';
import { CloudDownload, RefreshCw, Plus, Trash, Pencil, ExternalLink, Loader, GitBranch, ChevronDown, ChevronRight, Check } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type RemoteInfo } from '../lib/api';
import { cn } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
export function RemotesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Add remote dialog
  const [showAdd, setShowAdd] = useState(false);
  useEscapeKey(showAdd, () => setShowAdd(false));
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');

  // Edit URLs dialog (name + which url is being edited)
  const [editRemote, setEditRemote] = useState<RemoteInfo | null>(null);
  useEscapeKey(!!editRemote, () => setEditRemote(null));
  const [editFetchUrl, setEditFetchUrl] = useState('');
  const [editPushUrl, setEditPushUrl] = useState('');

  // Expanded ls-remote previews per remote name
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.remotes(repo.path);
      setRemotes(result);
    } catch (e) {
      toast.error('Failed to load remotes', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!addName.trim() || !addUrl.trim()) { toast.warning('Name and URL are required'); return; }
    setBusy('add');
    try {
      await api.git.addRemote(repo.path, addName.trim(), addUrl.trim());
      toast.success(`Remote '${addName.trim()}' added`);
      setShowAdd(false);
      setAddName(''); setAddUrl('');
      await load();
    } catch (e) {
      toast.error('Add remote failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (remote: RemoteInfo) => {
    if (!confirm(`Remove remote '${remote.name}'?\n\nThis only removes the remote configuration — the local branches and data stay untouched.`)) return;
    setBusy(remote.name);
    try {
      await api.git.removeRemote(repo.path, remote.name);
      toast.success(`Remote '${remote.name}' removed`);
      await load();
    } catch (e) {
      toast.error('Remove remote failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRename = async (remote: RemoteInfo) => {
    const newName = prompt(`Rename remote '${remote.name}' to:`, remote.name);
    if (!newName || !newName.trim() || newName.trim() === remote.name) return;
    setBusy(remote.name);
    try {
      await api.git.renameRemote(repo.path, remote.name, newName.trim());
      toast.success(`Remote '${remote.name}' renamed to '${newName.trim()}'`);
      await load();
    } catch (e) {
      toast.error('Rename failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveUrls = async () => {
    if (!editRemote) return;
    setBusy(editRemote.name);
    try {
      if (editFetchUrl && editFetchUrl !== editRemote.refs.fetch) {
        await api.git.setRemoteUrl(repo.path, editRemote.name, editFetchUrl);
      }
      if (editPushUrl && editPushUrl !== editRemote.refs.push) {
        await api.git.setRemoteUrl(repo.path, editRemote.name, editPushUrl, true);
      }
      toast.success(`URLs updated for '${editRemote.name}'`);
      setEditRemote(null);
      await load();
    } catch (e) {
      toast.error('Update URL failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetchAll = async () => {
    setBusy('fetch-all');
    try {
      await api.git.fetchAll(repo.path, true);
      toast.success('Fetched from all remotes (with prune)');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Fetch all failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetchOne = async (remote: RemoteInfo) => {
    setBusy(remote.name);
    try {
      await api.git.fetch(repo.path, remote.name, true);
      toast.success(`Fetched '${remote.name}'`);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(`Fetch '${remote.name}' failed`, String(e));
    } finally {
      setBusy(null);
    }
  };

  const togglePreview = async (remote: RemoteInfo) => {
    const next = new Set(expanded);
    if (next.has(remote.name)) {
      next.delete(remote.name);
      setExpanded(next);
      return;
    }
    next.add(remote.name);
    setExpanded(next);
    if (!preview[remote.name]) {
      setPreviewLoading(remote.name);
      try {
        const raw = await api.git.listRemote(repo.path, remote.name);
        setPreview((p) => ({ ...p, [remote.name]: raw }));
      } catch (e) {
        toast.error(`ls-remote '${remote.name}' failed`, String(e));
      } finally {
        setPreviewLoading(null);
      }
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Remotes</span>
          <span className="text-2xs text-text-tertiary">{remotes.length} remotes</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={handleFetchAll}
            disabled={remotes.length === 0 || busy === 'fetch-all'}
            title="Fetch from ALL remotes with prune"
          >
            {busy === 'fetch-all' ? <Loader size={12} className="animate-spin" /> : <CloudDownload size={12} />}
            Fetch All
          </button>
          <button className="btn btn-primary text-xs" onClick={() => setShowAdd(true)}>
            <Plus size={12} />
            Add Remote
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : remotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <CloudDownload size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No remotes configured</div>
            <div className="text-xs mt-1">Add a remote to push and pull from a server</div>
          </div>
        ) : (
          remotes.map((r) => (
            <div key={r.name} className="border-b border-border-subtle">
              <div className="group flex items-center gap-3 px-3 py-3 hover:bg-bg-hover">
                <button
                  className="icon-btn !w-5 !h-5 flex-shrink-0"
                  title="Preview remote refs (git ls-remote)"
                  onClick={() => togglePreview(r)}
                >
                  {expanded.has(r.name) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <GitBranch size={15} className="text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{r.name}</span>
                    {r.name === 'origin' && <span className="badge badge-renamed">DEFAULT</span>}
                  </div>
                  <div className="text-xs text-text-tertiary mt-0.5 font-mono truncate" title={r.refs.fetch}>
                    {r.refs.fetch}
                  </div>
                  {r.refs.push && r.refs.push !== r.refs.fetch && (
                    <div className="text-xs text-text-tertiary font-mono truncate" title={`push: ${r.refs.push}`}>
                      ↗ {r.refs.push}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {busy === r.name ? (
                    <Loader size={14} className="animate-spin text-accent" />
                  ) : (
                    <>
                      <button
                        className="btn btn-secondary text-xs"
                        onClick={() => handleFetchOne(r)}
                        title={`Fetch and prune '${r.name}'`}
                      >
                        <CloudDownload size={11} />
                        Fetch
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title="Rename remote"
                        onClick={() => handleRename(r)}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title="Edit URLs"
                        onClick={() => { setEditRemote(r); setEditFetchUrl(r.refs.fetch); setEditPushUrl(r.refs.push); }}
                      >
                        <ExternalLink size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                        title="Remove remote"
                        onClick={() => handleRemove(r)}
                      >
                        <Trash size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {expanded.has(r.name) && (
                <div className="px-3 pb-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1 pl-8">
                    Remote refs (git ls-remote {r.name})
                  </div>
                  <pre className="ml-8 text-2xs font-mono bg-bg-tertiary p-2 rounded max-h-60 overflow-auto whitespace-pre text-text-secondary">
                    {previewLoading === r.name ? 'Loading...' : (preview[r.name] || 'No refs')}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add remote dialog */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Add Remote</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Name</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="origin"
                  value={addName}
                  autoFocus
                  onChange={(e) => setAddName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">URL</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="https://github.com/user/repo.git or git@host:user/repo.git"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit URLs dialog */}
      {editRemote && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setEditRemote(null)}
        >
          <div className="panel w-[480px] p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Edit URLs — {editRemote.name}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Fetch URL</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={editFetchUrl}
                  onChange={(e) => setEditFetchUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  Push URL <span className="text-text-tertiary">(leave = fetch URL)</span>
                </label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={editPushUrl}
                  onChange={(e) => setEditPushUrl(e.target.value)}
                />
              </div>
              <div className="text-2xs text-text-tertiary">
                A separate push URL is useful for push-over-SSH setups where fetch goes through a mirror/CDN.
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setEditRemote(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveUrls} disabled={busy === editRemote.name}>
                {busy === editRemote.name ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
