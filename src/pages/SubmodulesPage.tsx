import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, GitBranch, CheckCircle, AlertCircle, Loader, Plus } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type SubmoduleInfo } from '../lib/api';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useI18n } from '../lib/i18n';
export function SubmodulesPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
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
      toast.error(t('pages.submoduleLoadFailed'), String(e));
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
      toast.success(name ? t('pages.submoduleInitialized', { name }) : t('pages.submoduleInitializedAll'));
      await load();
    } catch (e) {
      toast.error(t('pages.submoduleInitFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleUpdate = async (name?: string) => {
    setBusy(name || 'all');
    try {
      await api.git.submoduleUpdate(repo.path, name, true);
      toast.success(name ? t('pages.submoduleUpdated', { name }) : t('pages.submoduleUpdatedAll'));
      await load();
    } catch (e) {
      toast.error(t('pages.submoduleUpdateFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (name?: string) => {
    setBusy(name || 'sync-all');
    try {
      await api.git.submoduleSync(repo.path, name);
      toast.success(name ? t('pages.submoduleSynced', { name }) : t('pages.submoduleSyncedAll'));
      await load();
    } catch (e) {
      toast.error(t('pages.submoduleSyncFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDeinit = async (name: string) => {
    if (!(await confirmDialog({
      title: t('pages.submoduleDeinitTitle', { name }),
      message: t('pages.submoduleDeinitMessage'),
      confirmLabel: t('pages.deinit'),
      danger: true,
    }))) return;
    setBusy(name);
    try {
      await api.git.submoduleDeinit(repo.path, name, false);
      toast.success(t('pages.submoduleDeinitialized', { name }));
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('pages.submoduleDeinitFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = async () => {
    if (!addUrl.trim() || !addPath.trim()) { toast.warning(t('pages.submoduleFieldsRequired')); return; }
    setBusy('add');
    try {
      await api.git.submoduleAdd(repo.path, addUrl.trim(), addPath.trim(), addBranch.trim() || undefined);
      toast.success(t('pages.submoduleAdded', { name: addPath.trim() }));
      setShowAdd(false);
      setAddUrl(''); setAddPath(''); setAddBranch('');
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('pages.submoduleAddFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('nav.submodules')}</span>
          <span className="text-2xs text-text-tertiary">{t('pages.submodulesCount', { count: submodules.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => handleSync()}
            disabled={submodules.length === 0}
            title={t('pages.submoduleSyncAllTitle')}
          >
            {t('pages.syncAll')}
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => setShowAdd(true)}
            title={t('pages.submoduleAddButtonTitle')}
          >
            <Plus size={12} />
            {t('pages.addSubmodule')}
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={() => handleInit()}
            disabled={submodules.length === 0}
          >
            {t('pages.initAll')}
          </button>
          <button
            className="btn btn-primary text-xs"
            onClick={() => handleUpdate()}
            disabled={submodules.length === 0}
          >
            {t('pages.updateAll')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : submodules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <Package size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.noSubmodules')}</div>
            <div className="text-xs mt-1">{t('pages.noSubmodulesHint')}</div>
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
                        <CheckCircle size={9} /> {t('pages.badgeInitialized')}
                      </span>
                    ) : (
                      <span className="badge badge-modified">{t('pages.badgeDirty')}</span>
                    )
                  ) : (
                    <span className="badge badge-untracked flex items-center gap-1">
                      <AlertCircle size={9} /> {t('pages.badgeNotInitialized')}
                    </span>
                  )}
                </div>
                <div
                  className="text-xs text-text-tertiary mt-0.5 font-mono truncate cursor-pointer hover:text-accent"
                  title={t('pages.submodulePathHint')}
                  onClick={(e) => {
                    e.stopPropagation();
                    useSelectionStore.getState().selectFile(s.path);
                    useSelectionStore.getState().setPathFilter(s.path);
                  }}
                >
                  {s.path}
                </div>
                <div className="text-xs text-text-secondary mt-0.5 truncate">
                  {s.url}
                </div>
                {s.branch && (
                  <div className="flex items-center gap-1 text-xs text-text-tertiary mt-1">
                    <GitBranch size={10} />
                    <span
                      className="cursor-pointer hover:text-accent hover:underline"
                      title={t('pages.selectBranchHint')}
                      onClick={(e) => {
                        e.stopPropagation();
                        useSelectionStore.getState().selectBranch(s.branch!);
                        window.location.hash = '#/history';
                      }}
                    >
                      {s.branch}
                    </span>
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
                        {t('pages.init')}
                      </button>
                    )}
                    <button
                      className="btn btn-secondary text-xs"
                      onClick={() => handleUpdate(s.name)}
                    >
                      {t('pages.update')}
                    </button>
                    <button
                      className="btn btn-secondary text-xs"
                      onClick={() => handleSync(s.name)}
                      title={t('pages.submoduleSyncTitle')}
                    >
                      {t('pages.sync')}
                    </button>
                    {s.initialized && (
                      <button
                        className="btn btn-secondary text-xs"
                        title={t('pages.submoduleOpenTitle')}
                        onClick={async () => {
                          try {
                            // Build the absolute submodule path ('/' works on all
                            // platforms in Node — .gitmodules paths use forward slashes)
                            const abs = `${repo.path.replace(/[\\/]+$/, '')}/${s.path}`;
                            await useRepositoryStore.getState().openRepository(abs);
                            window.location.hash = '#/changes';
                          } catch (e) {
                            toast.error(t('pages.submoduleOpenFailed'), String(e));
                          }
                        }}
                      >
                        {t('pages.open')}
                      </button>
                    )}
                    {s.initialized && (
                      <button
                        className="btn btn-secondary text-xs hover:!text-status-deleted"
                        onClick={() => handleDeinit(s.name)}
                        title={t('pages.submoduleDeinitButtonTitle')}
                      >
                        {t('pages.deinit')}
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
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('pages.addSubmodule')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('clone.url')}</label>
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
                <label className="text-xs text-text-tertiary block mb-1">{t('pages.localPathLabel')}</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="libs/repo"
                  value={addPath}
                  onChange={(e) => setAddPath(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('clone.branch')}</label>
                <input
                  type="text"
                  className="w-full text-sm"
                  placeholder={t('pages.defaultBranchPlaceholder')}
                  value={addBranch}
                  onChange={(e) => setAddBranch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                {t('common.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
