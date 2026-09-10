import { useState, useEffect, useCallback } from 'react';
import { GitMerge, RefreshCw, Plus, Trash, CloudDownload, CloudUpload, SplitSquareHorizontal, Folder, History } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type SubtreeInfo, type RemoteInfo } from '../lib/api';
import { cn } from '../lib/utils';
import { confirmDialog } from '../components/ConfirmDialog';

/**
 * SmartGit "Remote | Subtree" feature: integrate other repositories into
 * sub-folders of the main repo (git subtree add/pull/push/split).
 */
export function SubtreesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();

  const [subtrees, setSubtrees] = useState<SubtreeInfo[]>([]);
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Add form state
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [squash, setSquash] = useState(true);

  const load = useCallback(async () => {
    if (!repo) return;
    setLoading(true);
    try {
      const [subs, rems] = await Promise.all([
        api.git.subtrees(repo.path),
        api.git.remotes(repo.path),
      ]);
      setSubtrees(subs);
      setRemotes(rems);
    } catch (e) {
      toast.error('Failed to load subtrees', String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const n = name.trim() || path.trim().split('/').pop() || '';
    if (!path.trim() || !remoteName.trim() || !branch.trim()) {
      toast.error('Path, remote and branch are required');
      return;
    }
    setBusy('add');
    try {
      await api.git.subtreeAdd(repo.path, {
        name: n,
        path: path.trim(),
        remote: remoteName.trim(),
        branch: branch.trim(),
        squash,
        remoteUrl: remoteUrl.trim() || undefined,
      });
      toast.success(`Subtree added at ${path.trim()}`);
      setShowAdd(false);
      resetForm();
      await load();
    } catch (e) {
      toast.error('Failed to add subtree', String(e));
    } finally {
      setBusy(null);
    }
  };

  const resetForm = () => {
    setName(''); setPath(''); setRemoteName(''); setRemoteUrl(''); setBranch('main'); setSquash(true);
  };

  const withBusy = async (key: string, fn: () => Promise<void>, okMsg: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(okMsg);
      await load();
    } catch (e) {
      toast.error('Operation failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (t: SubtreeInfo) => {
    const ok = await confirmDialog({
      title: 'Remove subtree configuration',
      message: `Remove the configuration of subtree "${t.name}" (path ${t.path})? Working tree content is not touched.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await withBusy(`rm-${t.name}`, () => api.git.subtreeRemove(repo.path, t.name), 'Subtree configuration removed');
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <GitMerge size={18} className="text-accent shrink-0" />
        <h1 className="text-sm font-semibold">Subtrees</h1>
        <span className="text-xs text-text-tertiary">
          Integrate other repositories into sub-folders — an alternative to submodules
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90"
        >
          <Plus size={14} />
          Add Subtree
        </button>
        <button
          onClick={load}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {showAdd && (
        <div className="px-4 py-3 border-b border-border bg-surface/40 grid grid-cols-2 gap-3">
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            Relative path (e.g. vendor/mylib) *
            <input value={path} onChange={(e) => { setPath(e.target.value); if (!name.trim()) setName(e.target.value.split('/').pop() ?? ''); }} placeholder="vendor/mylib"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            Name (config key)
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mylib"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            Remote name * (created from URL if missing)
            <input value={remoteName} onChange={(e) => setRemoteName(e.target.value)} placeholder="mylib-remote" list="subtree-remotes"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
            <datalist id="subtree-remotes">
              {remotes.map((r) => <option key={r.name} value={r.name} />)}
            </datalist>
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            Remote URL (only when creating a new remote)
            <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://…"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            Remote branch *
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" checked={squash} onChange={(e) => setSquash(e.target.checked)} className="accent-current" />
              Squash subtree into a single commit
            </label>
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button onClick={() => { setShowAdd(false); resetForm(); }}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-surface-hover">Cancel</button>
            <button onClick={handleAdd} disabled={busy === 'add'}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-40">
              {busy === 'add' ? 'Adding…' : 'Add Subtree'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {subtrees.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-tertiary text-sm gap-2">
            <GitMerge size={32} className="opacity-40" />
            <div>No subtrees configured</div>
            <div className="text-xs opacity-70">Use “Add Subtree” to integrate another repository into a sub-folder</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {subtrees.map((t) => (
              <div key={t.name} className="px-4 py-3 hover:bg-surface/50 group">
                <div className="flex items-center gap-2">
                  <Folder size={15} className="text-text-tertiary shrink-0" />
                  <span className="text-sm font-medium">{t.path}</span>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', t.squash ? 'bg-accent/15 text-accent' : 'bg-surface text-text-tertiary')}>
                    {t.squash ? 'squashed' : 'full history'}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    remote <b className="text-text-secondary">{t.remote}</b> · branch <b className="text-text-secondary">{t.branch}</b>
                  </span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {/* Cross-tool: file-history scoped to the subtree folder */}
                    <button
                      onClick={() => {
                        useSelectionStore.getState().selectFile(t.path);
                        useSelectionStore.getState().setPathFilter(t.path);
                        window.location.hash = '#/history';
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover"
                      title={`Show log of '${t.path}/' in History`}
                    >
                      <History size={13} />
                      Log
                    </button>
                    <button
                      onClick={() => withBusy(`pull-${t.name}`, () => api.git.subtreePull(repo.path, t.name), `Pulled upstream into ${t.path}`)}
                      disabled={busy !== null}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover disabled:opacity-40"
                      title="git subtree pull — fetch and merge new upstream changes"
                    >
                      <CloudDownload size={13} className={busy === `pull-${t.name}` ? 'animate-pulse' : ''} />
                      Pull
                    </button>
                    <button
                      onClick={() => withBusy(`push-${t.name}`, () => api.git.subtreePush(repo.path, t.name), `Pushed ${t.path} changes back to ${t.remote}`)}
                      disabled={busy !== null}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover disabled:opacity-40"
                      title="git subtree push — split local changes and push to the subtree remote"
                    >
                      <CloudUpload size={13} className={busy === `push-${t.name}` ? 'animate-pulse' : ''} />
                      Push
                    </button>
                    <button
                      onClick={() => withBusy(`split-${t.name}`, async () => {
                        const b = await api.git.subtreeSplit(repo.path, t.name, { rejoin: true });
                        toast.success(`Subtree commits extracted to branch ${b}`);
                      }, `Split complete — see branch subtree/${t.name}`)}
                      disabled={busy !== null}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover disabled:opacity-40"
                      title="git subtree split — extract subtree commits into a local branch for review"
                    >
                      <SplitSquareHorizontal size={13} className={busy === `split-${t.name}` ? 'animate-pulse' : ''} />
                      Split
                    </button>
                    <button
                      onClick={() => handleRemove(t)}
                      disabled={busy !== null}
                      className="p-1 rounded hover:bg-surface-hover text-red-400 disabled:opacity-40"
                      title="Remove subtree configuration"
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
