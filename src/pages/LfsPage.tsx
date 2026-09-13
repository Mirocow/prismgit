import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, Download, Upload, Plus, Loader, AlertCircle, Check, Lock, Unlock, History } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api, type LfsLock } from '../lib/api';
import { useI18n } from '../lib/i18n';

import { useEscapeKey } from '../hooks/useEscapeKey';
interface LfsFile {
  path: string;
  size: string;
  status: string;
}

export function LfsPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const [installed, setInstalled] = useState(false);
  const [files, setFiles] = useState<LfsFile[]>([]);
  const [tracked, setTracked] = useState<string[]>([]);
  // SmartGit Manual: LFS Locks display
  const [locks, setLocks] = useState<LfsLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showTrack, setShowTrack] = useState(false);
  useEscapeKey(showTrack, () => setShowTrack(false));
  const [trackPattern, setTrackPattern] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Preflight: check if git-lfs is installed BEFORE calling any LFS
      // commands. This avoids "git: 'lfs' is not a git command" errors
      // being shown to the user when LFS is simply not installed.
      const lfsReady = await api.git.isLfsInstalled(repo.path);
      if (!lfsReady) {
        setInstalled(false);
        setFiles([]);
        setTracked([]);
        setLocks([]);
        return;
      }
      const [status, list, lockList] = await Promise.all([
        api.git.lfsStatus(repo.path),
        api.git.lfsList(repo.path).catch(() => []),
        api.git.lfsListLocks(repo.path).catch(() => []),
      ]);
      setInstalled(status.installed);
      setFiles(status.files);
      setTracked(list);
      setLocks(lockList);
    } catch (e) {
      toast.error(t('pages.lfsLoadFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.path, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleInstall = async () => {
    setBusy('install');
    try {
      await api.git.lfsInstall(repo.path);
      toast.success(t('pages.lfsInstalledToast'));
      await load();
    } catch (e) {
      toast.error(t('pages.lfsInstallFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePull = async () => {
    setBusy('pull');
    try {
      await api.git.lfsPull(repo.path);
      toast.success(t('pages.lfsPullDone'));
      await load();
    } catch (e) {
      toast.error(t('pages.lfsPullFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePush = async () => {
    setBusy('push');
    try {
      await api.git.lfsPush(repo.path);
      toast.success(t('pages.lfsPushDone'));
    } catch (e) {
      toast.error(t('pages.lfsPushFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetch = async () => {
    setBusy('fetch');
    try {
      await api.git.lfsFetch(repo.path);
      toast.success(t('pages.lfsFetchDone'));
    } catch (e) {
      toast.error(t('pages.lfsFetchFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleTrack = async () => {
    if (!trackPattern.trim()) {
      toast.warning(t('pages.lfsPatternRequired'));
      return;
    }
    setBusy('track');
    try {
      await api.git.lfsTrack(repo.path, [trackPattern]);
      toast.success(t('pages.lfsTracking', { pattern: trackPattern }));
      setShowTrack(false);
      setTrackPattern('');
      await load();
    } catch (e) {
      toast.error(t('pages.lfsTrackFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleLock = async (file: string) => {
    setBusy('lock-' + file);
    try {
      await api.git.lfsLock(repo.path, file);
      toast.success(t('pages.lfsLocked', { file }));
      await load();
    } catch (e) {
      toast.error(t('pages.lfsLockFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleUnlock = async (file: string) => {
    setBusy('unlock-' + file);
    try {
      await api.git.lfsUnlock(repo.path, file);
      toast.success(t('pages.lfsUnlocked', { file }));
      await load();
    } catch (e) {
      toast.error(t('pages.lfsUnlockFailed'), String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <Package size={14} />
          <span className="text-sm font-medium">{t('nav.lfs')}</span>
          <span className={`badge ${installed ? 'badge-added' : 'badge-deleted'}`}>
            {installed ? t('pages.lfsBadgeInstalled') : t('pages.lfsBadgeNotInstalled')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          {!installed && (
            <button className="btn btn-primary text-xs" onClick={handleInstall} disabled={busy === 'install'}>
              {busy === 'install' ? <Loader size={12} className="spin" /> : <Check size={12} />}
              {t('pages.lfsInstallButton')}
            </button>
          )}
          {installed && (
            <>
              <button className="btn btn-secondary text-xs" onClick={handleFetch} disabled={!!busy}>
                {busy === 'fetch' ? <Loader size={12} className="spin" /> : <Download size={12} />}
                {t('remotes.fetch')}
              </button>
              <button className="btn btn-secondary text-xs" onClick={handlePull} disabled={!!busy}>
                {busy === 'pull' ? <Loader size={12} className="spin" /> : <Download size={12} />}
                {t('remotes.pull')}
              </button>
              <button className="btn btn-secondary text-xs" onClick={handlePush} disabled={!!busy}>
                {busy === 'push' ? <Loader size={12} className="spin" /> : <Upload size={12} />}
                {t('remotes.push')}
              </button>
              <button className="btn btn-primary text-xs" onClick={() => setShowTrack(true)}>
                <Plus size={12} />
                {t('pages.track')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">{t('common.loading')}</div>
        ) : !installed ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <div className="text-sm">{t('pages.lfsNotInstalled')}</div>
            <div className="text-xs mt-1">{t('pages.lfsNotInstalledHint')}</div>
          </div>
        ) : (
          <>
            {/* LFS Locks — SmartGit Manual: LFS Lock command + lock-state display */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center gap-2">
                <Lock size={11} />
                {t('pages.lfsLocksCount', { count: locks.length })}
              </div>
              {locks.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.lfsNoLocks')}</div>
              ) : (
                locks.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover cursor-pointer"
                    title={t('pages.selectFileHint')}
                    onClick={() => useSelectionStore.getState().selectFile(l.path)}
                  >
                    <Lock size={12} className="text-status-modified shrink-0" />
                    <code className="mono flex-1 truncate" title={l.path}>{l.path}</code>
                    <span className="text-2xs text-text-tertiary">{l.owner?.name || t('pages.authorUnknown')}</span>
                    <button
                      className="icon-btn !w-5 !h-5"
                      title={t('pages.lfsUnlock')}
                      onClick={() => handleUnlock(l.path)}
                      disabled={busy === 'unlock-' + l.path}
                    >
                      <Unlock size={10} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Tracked patterns */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default mt-2">
                {t('pages.lfsTrackedPatterns', { count: tracked.length })}
              </div>
              {tracked.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.lfsNoTracked')}</div>
              ) : (
                tracked.map((pattern, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover">
                    <code className="mono text-accent">{pattern}</code>
                  </div>
                ))
              )}
            </div>

            {/* LFS files — with lock/unlock per file */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default mt-2">
                {t('pages.lfsFilesCount', { count: files.length })}
              </div>
              {files.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">{t('pages.lfsNoFiles')}</div>
              ) : (
                files.map((f, i) => {
                  const locked = locks.some(l => l.path === f.path);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover group cursor-pointer"
                      title={t('pages.selectFileHint')}
                      onClick={() => useSelectionStore.getState().selectFile(f.path)}
                    >
                      <Package size={12} className="text-text-tertiary" />
                      <code className="mono flex-1 truncate">{f.path}</code>
                      <span className="text-2xs text-text-tertiary">{f.status}</span>
                      {/* Cross-tool: jump straight to this file's history/blame */}
                      <button
                        className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        title={t('pages.fileHistoryLog')}
                        onClick={() => {
                          useSelectionStore.getState().selectFile(f.path);
                          useSelectionStore.getState().setPathFilter(f.path);
                          window.location.hash = '#/history';
                        }}
                      >
                        <History size={10} />
                      </button>
                      {locked ? (
                        <button
                          className="icon-btn !w-5 !h-5 text-status-modified opacity-100"
                          title={t('pages.lfsUnlockFile')}
                          onClick={() => handleUnlock(f.path)}
                          disabled={busy === 'unlock-' + f.path}
                        >
                          <Lock size={10} />
                        </button>
                      ) : (
                        <button
                          className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t('pages.lfsLockFile')}
                          onClick={() => handleLock(f.path)}
                          disabled={busy === 'lock-' + f.path}
                        >
                          <Unlock size={10} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {showTrack && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowTrack(false)}>
          <div className="panel w-96 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">{t('pages.lfsTrackTitle')}</h3>
            <input
              type="text"
              className="w-full text-sm mono mb-2"
              placeholder="*.psd"
              value={trackPattern}
              autoFocus
              onChange={e => setTrackPattern(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTrack()}
            />
            <div className="text-2xs text-text-tertiary mb-4">
              {t('pages.lfsTrackHint')}
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setShowTrack(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={handleTrack} disabled={busy === 'track'}>
                {busy === 'track' ? <Loader size={13} className="spin" /> : <Check size={13} />}
                {t('pages.track')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
