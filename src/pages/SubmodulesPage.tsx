import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, GitBranch, CheckCircle, AlertCircle, Loader, Plus } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type SubmoduleInfo } from '../lib/api';

import { useEscapeKey } from '../hooks/useEscapeKey';
export function SubmodulesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [submodules, setSubmodules] = useState<SubmoduleInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  useEscapeKey(showAdd, () => setShowAdd(false));
  const [addUrl, setAddUrl] = useState('');
  const [addPath, setAddPath] = useState('');
  const [addBranch, setAddBranch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.git.submodules(repo.path);
      setSubmodules(result);
    } catch (e) {
      toast.error('Failed to load submodules', String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleInit = async (name?: string) => {
    setBusy(name || 'all');
    try {
      await api.git.submoduleInit(repo.path, name);
      toast.success(`Initialized ${name || 'all submodules'}`);
      await load();
    } catch (e) {
      toast.error('Init failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleUpdate = async (name?: string) => {
    setBusy(name || 'all');
    try {
      await api.git.submoduleUpdate(repo.path, name, true);
      toast.success(`Updated ${name || 'all submodules'}`);
      await load();
    } catch (e) {
      toast.error('Update failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (name?: string) => {
    setBusy(name || 'sync-all');
    try {
      await api.git.submoduleSync(repo.path, name);
      toast.success(`Synced ${name || 'all submodules'} URLs with .gitmodules`);
      await load();
    } catch (e) {
      toast.error('Sync failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDeinit = async (name: string) => {
    if (!confirm(`Deinit submodule '${name}'?\n\nThe submodule working tree will be removed (the entry stays in .gitmodules). You can re-init it later.`)) return;
    setBusy(name);
    try {
      await api.git.submoduleDeinit(repo.path, name, false);
      toast.success(`Deinitialized '${name}'`);
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Deinit failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async () => {
    if (!addUrl.trim() || !addPath.trim()) { toast.warning('URL and path are required'); return; }
    setBusy('add');
    try {
      await api.git.submoduleAdd(repo.path, addUrl.trim(), addPath.trim(), addBranch.trim() || undefined);
      toast.success(`Submodule '${addPath.trim()}' added`);
      setShowAdd(false);
      setAddUrl(''); setAddPath(''); setAddBranch('');
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Add submodule failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Submodules</span>
          <span className="text-2xs text-text-tertiary">{submodules.length} submodules</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => handleSync()}
            disabled={submodules.length === 0}
            title="Sync remote URLs from .gitmodules for all submodules"
          >
            Sync All
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => setShowAdd(true)}
            title="Add a new submodule from a URL"
          >
            <Plus size={12} />
            Add Submodule
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => handleInit()}
            disabled={submodules.length === 0}
          >
            Init All
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => handleUpdate()}
            disabled={submodules.length === 0}
          >
            Update All
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : submodules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Package size={32} className="mb-2 opacity-50" />
            <div className="text-sm">No submodules</div>
            <div className="text-xs mt-1">This repository has no .gitmodules file</div>
          </div>
        ) : (
          submodules.map((s) => (
            <div
              key={s.name}
              className="group flex items-center gap-3 px-3 py-3 border-b border-border-subtle hover:bg-bg-hover"
            >
              <Package size={16} className="text-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{s.name}</span>
                  {s.initialized ? (
                    s.upToDate ? (
                      <span className="badge badge-added flex items-center gap-1">
                        <CheckCircle size={9} /> INITIALIZED
                      </span>
                    ) : (
                      <span className="badge badge-modified">DIRTY</span>
                    )
                  ) : (
                    <span className="badge badge-untracked flex items-center gap-1">
                      <AlertCircle size={9} /> NOT INITIALIZED
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-tertiary mt-0.5 font-mono truncate">
                  {s.path}
                </div>
                <div className="text-xs text-text-secondary mt-0.5 truncate">
                  {s.url}
                </div>
                {s.branch && (
                  <div className="flex items-center gap-1 text-xs text-text-tertiary mt-1">
                    <GitBranch size={10} />
                    {s.branch}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {busy === s.name ? (
                  <Loader size={14} className="animate-spin text-accent" />
                ) : (
                  <>
                    {!s.initialized && (
                      <button
                        className="btn btn-secondary text-xs"
                        onClick={() => handleInit(s.name)}
                      >
                        Init
                      </button>
                    )}
                    <button
                      className="btn btn-secondary text-xs"
                      onClick={() => handleUpdate(s.name)}
                    >
                      Update
                    </button>
                    <button
                      className="btn btn-secondary text-xs"
                      onClick={() => handleSync(s.name)}
                      title="Sync URL with .gitmodules"
                    >
                      Sync
                    </button>
                    {s.initialized && (
                      <button
                        className="btn btn-secondary text-xs hover:!text-status-deleted"
                        onClick={() => handleDeinit(s.name)}
                        title="Remove the submodule working tree (entry stays in .gitmodules)"
                      >
                        Deinit
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Add Submodule</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Repository URL</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="https://github.com/user/repo.git"
                  value={addUrl}
                  autoFocus
                  onChange={(e) => setAddUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Local path</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="libs/repo"
                  value={addPath}
                  onChange={(e) => setAddPath(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Branch (optional)</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder="default branch"
                  value={addBranch}
                  onChange={(e) => setAddBranch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
