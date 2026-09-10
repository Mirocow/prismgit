import { useState, useEffect, useCallback } from 'react';
import { CloudDownload, RefreshCw, Plus, Trash, Pencil, ExternalLink, Loader, GitBranch, ChevronDown, ChevronRight, Check, Eye, EyeOff } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type RemoteInfo } from '../lib/api';
import { cn, copyToClipboard } from '../lib/utils';
import { useContextMenu } from '../lib/useContextMenu';
import { buildRemoteContextMenu } from '../lib/remoteContextMenu';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { RenameDialog } from '../components/RemoteDialogs';
import { isBackgroundFetchEnabled, setBackgroundFetchForRepo } from '../lib/backgroundFetch';
import { getRemoteAuth, setRemoteAuth, hasRemoteAuth } from '../lib/remoteAuth';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
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
  const [editBackground, setEditBackground] = useState(false);
  // Per-remote authorization — the SAME stored credential as Repository
  // Settings → Remotes; used by push/pull/fetch/ls-remote in the main process.
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);

  // Rename remote dialog (SmartGit-style modal instead of native prompt)
  const [renameOld, setRenameOld] = useState<string | null>(null);

  // Expanded ls-remote previews per remote name
  const [preview, setPreview] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Native context menu (same pattern as the repository list in the sidebar)
  const showContextMenu = useContextMenu();

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
    if (!(await confirmDialog({
      title: `Remove remote '${remote.name}'`,
      message: 'This only removes the remote configuration — the local branches and data stay untouched.',
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
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

  const handleRenameSubmit = async (newName: string) => {
    if (!renameOld) return;
    setBusy(renameOld);
    try {
      await api.git.renameRemote(repo.path, renameOld, newName);
      toast.success(`Remote '${renameOld}' renamed to '${newName}'`);
      await load();
      setRenameOld(null);
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
      setBackgroundFetchForRepo(repo.path, editRemote.name, editBackground);
      setRemoteAuth(repo.path, editRemote.name, { username: editUsername, password: editPassword });
      toast.success(`Remote '${editRemote.name}' updated`);
      setEditRemote(null);
      await load();
    } catch (e) {
      toast.error('Update remote failed', String(e));
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

  const openEditRemote = useCallback((r: RemoteInfo) => {
    setEditRemote(r);
    setEditFetchUrl(r.refs.fetch);
    setEditPushUrl(r.refs.push);
    setEditBackground(isBackgroundFetchEnabled(repo.path, r.name));
    const cred = getRemoteAuth(repo.path, r.name);
    setEditUsername(cred.username ?? '');
    setEditPassword(cred.password ?? '');
    setShowEditPassword(false);
  }, [repo.path]);

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

  // Right-click menu on a remote row — mirrors the sidebar's native repo menu
  // and exposes the same actions as the row buttons (plus clipboard helpers).
  const showRemoteMenu = useCallback((e: React.MouseEvent, r: RemoteInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const items = buildRemoteContextMenu(r, {
      busy: busy === r.name,
      expanded: expanded.has(r.name),
      backgroundFetch: isBackgroundFetchEnabled(repo.path, r.name),
    });
    void showContextMenu(items, (clickId) => {
      switch (clickId) {
        case 'fetch': void handleFetchOne(r); break;
        case 'preview': void togglePreview(r); break;
        case 'copy-fetch': void copyToClipboard(r.refs.fetch); break;
        case 'copy-push': void copyToClipboard(r.refs.push); break;
        case 'branches': window.location.hash = '#/branches'; break;
        case 'edit': openEditRemote(r); break;
        case 'rename': setRenameOld(r.name); break;
        case 'toggle-background':
          setBackgroundFetchForRepo(repo.path, r.name, !isBackgroundFetchEnabled(repo.path, r.name));
          break;
        case 'remove': void handleRemove(r); break;
      }
    });
  }, [showContextMenu, repo.path, busy, expanded, openEditRemote]);

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
              <div
                className="group flex items-center gap-3 px-3 py-3 hover:bg-bg-hover"
                onContextMenu={(e) => showRemoteMenu(e, r)}
              >
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
                    {hasRemoteAuth(repo.path, r.name) && (
                      <span className="badge badge-added" title="Authorization configured — used for push/pull/fetch">AUTH</span>
 )}
                    {isBackgroundFetchEnabled(repo.path, r.name) && (
                      <span className="badge" title="Refresh automatically (background poll)">AUTO</span>
 )}
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
                      {/* Cross-tool: open Branches (its remote groups show this remote's branches) */}
                      <button
                        className="btn btn-secondary text-xs"
                        title={`Browse branches of '${r.name}'`}
                        onClick={() => { window.location.hash = '#/branches'; }}
                      >
                        <GitBranch size={11} />
                        Branches
                      </button>
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
                        onClick={() => setRenameOld(r.name)}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title="Edit URLs / authorization"
                        onClick={() => openEditRemote(r)}
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

      {/* Rename remote dialog (SmartGit-style) */}
      {renameOld && (
        <RenameDialog
          kind="remote"
          oldName={renameOld}
          busy={busy === renameOld}
          onSubmit={handleRenameSubmit}
          onClose={() => setRenameOld(null)}
        />
      )}

      {/* Edit URLs dialog */}
      {editRemote && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setEditRemote(null)}
        >
          <div className="panel w-[480px] p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Edit Remote — {editRemote.name}</h3>
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
              <div className="border-t border-border-subtle pt-3">
                <label className="text-xs text-text-tertiary block mb-1.5">
                  Authorization (HTTP/HTTPS) — same setting as Repository Settings → Remotes
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    className="w-full text-sm"
                    placeholder="Username"
                    autoComplete="off"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                  />
                  <div className="relative">
                    <input
                      type={showEditPassword ? 'text' : 'password'}
                      className="w-full text-sm pr-8"
                      placeholder="Password / token"
                      autoComplete="new-password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                    />
                    <button
                      className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn !w-6 !h-6"
                      title={showEditPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowEditPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showEditPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>
                <div className="text-2xs text-text-tertiary mt-1">
                  Applied to push, pull, fetch and ls-remote for this remote. Leave empty for SSH or public servers.
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editBackground}
                  onChange={(e) => setEditBackground(e.target.checked)}
                />
                Perform background Poll or Fetch
              </label>
              <div className="text-2xs text-text-tertiary">
                When enabled, PrismGit quietly fetches this remote every 5 minutes while the repository is open.
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
