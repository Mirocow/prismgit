import { useState, useEffect, useCallback } from 'react';
import { GitMerge, RefreshCw, Plus, Trash, CloudDownload, CloudUpload, SplitSquareHorizontal, Folder, History } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type SubtreeInfo, type RemoteInfo } from '../lib/api';
import { cn } from '../lib/utils';
import { confirmDialog } from '../components/ConfirmDialog';
import { useI18n } from '../lib/i18n';

/**
 * SmartGit "Remote | Subtree" feature: integrate other repositories into
 * sub-folders of the main repo (git subtree add/pull/push/split).
 */
export function SubtreesPage() {
  const { t } = useI18n();
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
      toast.error(t('pages.subtreeLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const n = name.trim() || path.trim().split('/').pop() || '';
    if (!path.trim() || !remoteName.trim() || !branch.trim()) {
      toast.error(t('pages.subtreeFieldsRequired'));
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
      toast.success(t('pages.subtreeAdded', { path: path.trim() }));
      setShowAdd(false);
      resetForm();
      await load();
    } catch (e) {
      toast.error(t('pages.subtreeAddFailed'), String(e));
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
      toast.error(t('pages.operationFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (sub: SubtreeInfo) => {
    const ok = await confirmDialog({
      title: t('pages.subtreeRemoveTitle'),
      message: t('pages.subtreeRemoveMessage', { name: sub.name, path: sub.path }),
      confirmLabel: t('common.remove'),
      danger: true,
    });
    if (!ok) return;
    await withBusy(`rm-${sub.name}`, () => api.git.subtreeRemove(repo.path, sub.name), t('pages.subtreeRemoved'));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <GitMerge size={18} className="text-accent shrink-0" />
        <h1 className="text-sm font-semibold">{t('nav.subtrees')}</h1>
        <span className="text-xs text-text-tertiary">
          {t('pages.subtreeSubtitle')}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90"
        >
          <Plus size={14} />
          {t('pages.addSubtree')}
        </button>
        <button
          onClick={load}
          className="p-1.5 rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary"
          title={t('common.refresh')}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {showAdd && (
        <div className="px-4 py-3 border-b border-border bg-surface/40 grid grid-cols-2 gap-3">
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            {t('pages.subtreePathLabel')}
            <input value={path} onChange={(e) => { setPath(e.target.value); if (!name.trim()) setName(e.target.value.split('/').pop() ?? ''); }} placeholder="vendor/mylib"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            {t('pages.subtreeNameLabel')}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="mylib"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            {t('pages.subtreeRemoteLabel')}
            <input value={remoteName} onChange={(e) => setRemoteName(e.target.value)} placeholder="mylib-remote" list="subtree-remotes"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
            <datalist id="subtree-remotes">
              {remotes.map((r) => <option key={r.name} value={r.name} />)}
            </datalist>
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            {t('pages.subtreeRemoteUrlLabel')}
            <input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://…"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <label className="text-xs text-text-secondary flex flex-col gap-1">
            {t('pages.subtreeBranchLabel')}
            <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main"
              className="px-2.5 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent" />
          </label>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" checked={squash} onChange={(e) => setSquash(e.target.checked)} className="accent-current" />
              {t('pages.subtreeSquashLabel')}
            </label>
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button onClick={() => { setShowAdd(false); resetForm(); }}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-surface-hover">{t('common.cancel')}</button>
            <button onClick={handleAdd} disabled={busy === 'add'}
              className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-40">
              {busy === 'add' ? t('pages.adding') : t('pages.addSubtree')}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {subtrees.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-text-tertiary text-sm gap-2">
            <GitMerge size={32} className="opacity-40" />
            <div>{t('pages.noSubtrees')}</div>
            <div className="text-xs opacity-70">{t('pages.noSubtreesHint')}</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {subtrees.map((sub) => (
              <div key={sub.name} className="px-4 py-3 hover:bg-surface/50 group">
                <div className="flex items-center gap-2">
                  <Folder size={15} className="text-text-tertiary shrink-0" />
                  <span className="text-sm font-medium">{sub.path}</span>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', sub.squash ? 'bg-accent/15 text-accent' : 'bg-surface text-text-tertiary')}>
                    {sub.squash ? t('pages.badgeSquashed') : t('pages.badgeFullHistory')}
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {t('pages.remoteWord')} <b className="text-text-secondary">{sub.remote}</b> · {t('pages.branchWord')} <b className="text-text-secondary">{sub.branch}</b>
                  </span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {/* Cross-tool: file-history scoped to the subtree folder */}
                    <button
                      onClick={() => {
                        useSelectionStore.getState().selectFile(sub.path);
                        useSelectionStore.getState().setPathFilter(sub.path);
                        window.location.hash = '#/history';
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover"
                      title={t('pages.subtreeLogTitle', { path: sub.path })}
                    >
                      <History size={13} />
                      {t('branches.log')}
                    </button>
                    <button
                      onClick={() => withBusy(`pull-${sub.name}`, () => api.git.subtreePull(repo.path, sub.name), t('pages.subtreePulled', { path: sub.path }))}
                      disabled={busy !== null}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover disabled:opacity-40"
                      title={t('pages.subtreePullTitle')}
                    >
                      <CloudDownload size={13} className={busy === `pull-${sub.name}` ? 'animate-pulse' : ''} />
                      {t('remotes.pull')}
                    </button>
                    <button
                      onClick={() => withBusy(`push-${sub.name}`, () => api.git.subtreePush(repo.path, sub.name), t('pages.subtreePushed', { path: sub.path, remote: sub.remote }))}
                      disabled={busy !== null}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover disabled:opacity-40"
                      title={t('pages.subtreePushTitle')}
                    >
                      <CloudUpload size={13} className={busy === `push-${sub.name}` ? 'animate-pulse' : ''} />
                      {t('remotes.push')}
                    </button>
                    <button
                      onClick={() => withBusy(`split-${sub.name}`, async () => {
                        const b = await api.git.subtreeSplit(repo.path, sub.name, { rejoin: true });
                        toast.success(t('pages.subtreeSplitToast', { branch: b }));
                      }, t('pages.subtreeSplitDone', { name: sub.name }))}
                      disabled={busy !== null}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-surface-hover disabled:opacity-40"
                      title={t('pages.subtreeSplitTitle')}
                    >
                      <SplitSquareHorizontal size={13} className={busy === `split-${sub.name}` ? 'animate-pulse' : ''} />
                      {t('pages.split')}
                    </button>
                    <button
                      onClick={() => handleRemove(sub)}
                      disabled={busy !== null}
                      className="p-1 rounded hover:bg-surface-hover text-red-400 disabled:opacity-40"
                      title={t('pages.subtreeRemoveTitle')}
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
