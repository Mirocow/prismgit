import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CloudDownload, ExternalLink, Eye, EyeOff, GitBranch, Loader, Pencil, Plus, RefreshCw, Settings, Trash } from '../components/icons';
import { api, type RemoteInfo } from '../lib/api';
import { buildRemoteContextMenu } from '../lib/remoteContextMenu';
import { useContextMenu } from '../lib/useContextMenu';
import { cn, copyToClipboard } from '../lib/utils';
import { useGitStore } from '../stores/gitStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastActions } from '../stores/toastStore';

import { confirmDialog } from '../components/ConfirmDialog';
import { RenameDialog } from '../components/RemoteDialogs';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { isBackgroundFetchEnabled, setBackgroundFetchForRepo } from '../lib/backgroundFetch';
import { useI18n } from '../lib/i18n';
import { getRemoteAuth, hasRemoteAuth, setRemoteAuth } from '../lib/remoteAuth';
export function RemotesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const status = useGitStore((s) => s.status);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const { t } = useI18n();
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
      toast.error(t('remotes.loadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!addName.trim() || !addUrl.trim()) { toast.warning(t('remotes.nameAndUrlRequired')); return; }
    setBusy('add');
    try {
      await api.git.addRemote(repo.path, addName.trim(), addUrl.trim());
      toast.success(t('remotes.added', { name: addName.trim() }));
      setShowAdd(false);
      setAddName(''); setAddUrl('');
      await load();
    } catch (e) {
      toast.error(t('remotes.addFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (remote: RemoteInfo) => {
    if (!(await confirmDialog({
      title: t('remotes.removeTitle', { name: remote.name }),
      message: t('remotes.removeMessage'),
      confirmLabel: t('common.remove'),
      danger: true,
    }))) return;
    setBusy(remote.name);
    try {
      await api.git.removeRemote(repo.path, remote.name);
      toast.success(t('remotes.removed', { name: remote.name }));
      await load();
    } catch (e) {
      toast.error(t('remotes.removeFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRenameSubmit = async (newName: string) => {
    if (!renameOld) return;
    setBusy(renameOld);
    try {
      await api.git.renameRemote(repo.path, renameOld, newName);
      toast.success(t('remotes.renamed', { old: renameOld, new: newName }));
      await load();
      setRenameOld(null);
    } catch (e) {
      toast.error(t('remotes.renameFailed'), String(e));
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
      toast.success(t('remotes.updated', { name: editRemote.name }));
      setEditRemote(null);
      await load();
    } catch (e) {
      toast.error(t('remotes.updateFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetchAll = async () => {
    setBusy('fetch-all');
    try {
      await api.git.fetchAll(repo.path, true);
      toast.success(t('remotes.fetchedAll'));
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('remotes.fetchAllFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetchOne = async (remote: RemoteInfo) => {
    setBusy(remote.name);
    try {
      await api.git.fetch(repo.path, remote.name, true);
      toast.success(t('remotes.fetched', { name: remote.name }));
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('remotes.fetchFailed', { name: remote.name }), String(e));
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
        toast.error(t('remotes.lsRemoteFailed', { name: remote.name }), String(e));
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
        case 'repo-settings':
          // Same global event the Sidebar's "Repository Settings..." uses;
          // the repo is already open when the Remotes tool is visible.
          window.dispatchEvent(new CustomEvent('prismgit:repo-settings'));
          break;
        case 'remove': void handleRemove(r); break;
      }
    });
  }, [showContextMenu, repo.path, busy, expanded, openEditRemote]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('remotes.title')}</span>
          <span className="text-2xs text-text-tertiary">{t('remotes.count', { count: remotes.length })}</span>
        </div>
        <div className="flex items-center gap-2">

          <button
            className="icon-btn"
            title={t('remotes.repoSettingsTooltip')}
            onClick={() => window.dispatchEvent(new CustomEvent('prismgit:repo-settings'))}
          >
            <Settings size={13} />
          </button>
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={handleFetchAll}
            disabled={remotes.length === 0 || busy === 'fetch-all'}
            title={t('remotes.fetchAllTooltip')}
          >
            {busy === 'fetch-all' ? <Loader size={12} className="animate-spin" /> : <CloudDownload size={12} />}
            {t('remotes.fetchAll')}
          </button>
          <button className="btn btn-primary text-xs" onClick={() => setShowAdd(true)}>
            <Plus size={12} />
            {t('remotes.add')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : remotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <CloudDownload size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('remotes.empty')}</div>
            <div className="text-xs mt-1">{t('remotes.emptyDesc')}</div>
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
                  title={t('remotes.previewTooltip')}
                  onClick={() => togglePreview(r)}
                >
                  {expanded.has(r.name) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <GitBranch size={15} className="text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{r.name}</span>
                    {r.name === 'origin' && <span className="badge badge-renamed">{t('remotes.defaultBadge')}</span>}
                    {hasRemoteAuth(repo.path, r.name) && (
                      <span className="badge badge-added" title={t('remotes.authTooltip')}>{t('remotes.authBadge')}</span>
 )}
                    {isBackgroundFetchEnabled(repo.path, r.name) && (
                      <span className="badge" title={t('remotes.autoTooltip')}>{t('remotes.autoBadge')}</span>
 )}
                  </div>
                  <div className="text-xs text-text-tertiary mt-0.5 font-mono truncate" title={r.refs.fetch}>
                    {r.refs.fetch}
                  </div>
                  {r.refs.push && r.refs.push !== r.refs.fetch && (
                    <div className="text-xs text-text-tertiary font-mono truncate" title={t('remotes.pushPrefix', { url: r.refs.push })}>
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
                        title={t('remotes.browseBranchesTooltip', { name: r.name })}
                        onClick={() => { window.location.hash = '#/branches'; }}
                      >
                        <GitBranch size={11} />
                        {t('nav.branches')}
                      </button>
                      <button
                        className="btn btn-secondary text-xs"
                        onClick={() => handleFetchOne(r)}
                        title={t('remotes.fetchPruneTooltip', { name: r.name })}
                      >
                        <CloudDownload size={11} />
                        {t('remotes.fetch')}
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title={t('remotes.renameTooltip')}
                        onClick={() => setRenameOld(r.name)}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6"
                        title={t('remotes.editTooltip')}
                        onClick={() => openEditRemote(r)}
                      >
                        <ExternalLink size={12} />
                      </button>
                      <button
                        className="icon-btn !w-6 !h-6 hover:!text-status-deleted"
                        title={t('remotes.removeTooltip')}
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
                    {t('remotes.refsHeader', { name: r.name })}
                  </div>
                  <div className="ml-8 text-2xs font-mono bg-bg-tertiary p-2 rounded max-h-60 overflow-auto">
                    {previewLoading === r.name ? (
                      t('common.loading')
                    ) : preview[r.name] ? (
                      preview[r.name]
                        .split('\n')
                        .filter((l) => l.trim())
                        .map((line, i) => {
                          const tabIndex = line.indexOf('\t');
                          const hash = tabIndex >= 0 ? line.slice(0, tabIndex) : line;
                          const refName = tabIndex >= 0 ? line.slice(tabIndex + 1).trim() : '';
                          // Cross-tool: refs found on the remote become global
                          // selections — Branches/Tags/History all follow.
                          const branchMatch = /^refs\/(heads|remotes)\/(.+)$/.exec(refName);
                          const tagMatch = /^refs\/tags\/(.+?)(\^\{\})?$/.exec(refName);
                          const isTagObject = refName.endsWith('^{}');
                          const onClick = isTagObject
                            ? undefined
                            : branchMatch
                            ? () => useSelectionStore.getState().selectBranch(branchMatch[2])
                            : tagMatch
                            ? () => useSelectionStore.getState().selectTag(tagMatch[1])
                            : undefined;
                          return (
                            <div
                              key={`${refName}-${i}`}
                              className={cn(
                                'whitespace-pre flex gap-2',
                                onClick && 'cursor-pointer hover:text-accent hover:underline'
                              )}
                              onClick={onClick}
                              title={onClick ? t('remotes.selectRefTooltip') : undefined}
                            >
                              <span className="text-text-tertiary">{hash.slice(0, 9)}</span>
                              <span className="flex-1">{refName || line}</span>
                            </div>
                          );
                        })
                    ) : (
                      t('remotes.noRefs')
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add remote dialog */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('remotes.add')}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('remotes.nameLabel')}</label>
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
                <label className="text-xs text-text-tertiary block mb-1">{t('remotes.urlLabel')}</label>
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
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={busy === 'add'}>
                {busy === 'add' ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
                {t('common.add')}
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
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setEditRemote(null)}
        >
          <div className="panel w-[480px] p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('remotes.editTitle', { name: editRemote.name })}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">{t('remotes.fetchUrlLabel')}</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={editFetchUrl}
                  onChange={(e) => setEditFetchUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  {t('remotes.pushUrlLabel')} <span className="text-text-tertiary">{t('remotes.pushUrlHint')}</span>
                </label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  value={editPushUrl}
                  onChange={(e) => setEditPushUrl(e.target.value)}
                />
              </div>
              <div className="text-2xs text-text-tertiary">
                {t('remotes.pushUrlDesc')}
              </div>
              <div className="border-t border-border-subtle pt-3">
                <label className="text-xs text-text-tertiary block mb-1.5">
                  {t('remotes.authLabel')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    className="w-full text-sm"
                    placeholder={t('remotes.usernamePlaceholder')}
                    autoComplete="off"
                    value={editUsername}
                    onChange={(e) => setEditUsername(e.target.value)}
                  />
                  <div className="relative">
                    <input
                      type={showEditPassword ? 'text' : 'password'}
                      className="w-full text-sm pr-8"
                      placeholder={t('remotes.passwordPlaceholder')}
                      autoComplete="new-password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                    />
                    <button
                      className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn !w-6 !h-6"
                      title={showEditPassword ? t('remotes.hidePassword') : t('remotes.showPassword')}
                      onClick={() => setShowEditPassword((v) => !v)}
                      tabIndex={-1}
                    >
                      {showEditPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                </div>
                <div className="text-2xs text-text-tertiary mt-1">
                  {t('remotes.authHint')}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editBackground}
                  onChange={(e) => setEditBackground(e.target.checked)}
                />
                {t('remotes.backgroundToggle')}
              </label>
              <div className="text-2xs text-text-tertiary">
                {t('remotes.backgroundHint')}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setEditRemote(null)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleSaveUrls} disabled={busy === editRemote.name}>
                {busy === editRemote.name ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
