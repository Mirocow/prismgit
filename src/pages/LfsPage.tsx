import { useState, useEffect, useCallback } from 'react';
import { Package, RefreshCw, Download, Upload, Plus, Loader, AlertCircle, Check, Lock, Unlock } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type LfsLock } from '../lib/api';

import { useEscapeKey } from '../hooks/useEscapeKey';
interface LfsFile {
  path: string;
  size: string;
  status: string;
}

export function LfsPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
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
      toast.error('Failed to load LFS status', String(e));
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
      toast.success('Git LFS installed');
      await load();
    } catch (e) {
      toast.error('Install failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePull = async () => {
    setBusy('pull');
    try {
      await api.git.lfsPull(repo.path);
      toast.success('LFS pull complete');
      await load();
    } catch (e) {
      toast.error('LFS pull failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handlePush = async () => {
    setBusy('push');
    try {
      await api.git.lfsPush(repo.path);
      toast.success('LFS push complete');
    } catch (e) {
      toast.error('LFS push failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleFetch = async () => {
    setBusy('fetch');
    try {
      await api.git.lfsFetch(repo.path);
      toast.success('LFS fetch complete');
    } catch (e) {
      toast.error('LFS fetch failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleTrack = async () => {
    if (!trackPattern.trim()) {
      toast.warning('Pattern is required');
      return;
    }
    setBusy('track');
    try {
      await api.git.lfsTrack(repo.path, [trackPattern]);
      toast.success(`Tracking: ${trackPattern}`);
      setShowTrack(false);
      setTrackPattern('');
      await load();
    } catch (e) {
      toast.error('Track failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleLock = async (file: string) => {
    setBusy('lock-' + file);
    try {
      await api.git.lfsLock(repo.path, file);
      toast.success(`Locked: ${file}`);
      await load();
    } catch (e) {
      toast.error('Lock failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleUnlock = async (file: string) => {
    setBusy('unlock-' + file);
    try {
      await api.git.lfsUnlock(repo.path, file);
      toast.success(`Unlocked: ${file}`);
      await load();
    } catch (e) {
      toast.error('Unlock failed', String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <Package size={14} />
          <span className="text-sm font-medium">Git LFS</span>
          <span className={`badge ${installed ? 'badge-added' : 'badge-deleted'}`}>
            {installed ? 'INSTALLED' : 'NOT INSTALLED'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          {!installed && (
            <button className="btn btn-primary text-xs" onClick={handleInstall} disabled={busy === 'install'}>
              {busy === 'install' ? <Loader size={12} className="spin" /> : <Check size={12} />}
              Install LFS
            </button>
          )}
          {installed && (
            <>
              <button className="btn btn-secondary text-xs" onClick={handleFetch} disabled={!!busy}>
                {busy === 'fetch' ? <Loader size={12} className="spin" /> : <Download size={12} />}
                Fetch
              </button>
              <button className="btn btn-secondary text-xs" onClick={handlePull} disabled={!!busy}>
                {busy === 'pull' ? <Loader size={12} className="spin" /> : <Download size={12} />}
                Pull
              </button>
              <button className="btn btn-secondary text-xs" onClick={handlePush} disabled={!!busy}>
                {busy === 'push' ? <Loader size={12} className="spin" /> : <Upload size={12} />}
                Push
              </button>
              <button className="btn btn-primary text-xs" onClick={() => setShowTrack(true)}>
                <Plus size={12} />
                Track
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
        ) : !installed ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
            <AlertCircle size={32} className="mb-2 opacity-50" />
            <div className="text-sm">Git LFS is not installed</div>
            <div className="text-xs mt-1">Install Git LFS to manage large files</div>
          </div>
        ) : (
          <>
            {/* LFS Locks — SmartGit Manual: LFS Lock command + lock-state display */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-b border-border-default flex items-center gap-2">
                <Lock size={11} />
                LFS Locks ({locks.length})
              </div>
              {locks.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">No active locks</div>
              ) : (
                locks.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover">
                    <Lock size={12} className="text-status-modified shrink-0" />
                    <code className="mono flex-1 truncate" title={l.path}>{l.path}</code>
                    <span className="text-2xs text-text-tertiary">{l.owner?.name || 'unknown'}</span>
                    <button
                      className="icon-btn !w-5 !h-5"
                      title="Unlock"
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
                Tracked Patterns ({tracked.length})
              </div>
              {tracked.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">No tracked patterns</div>
              ) : (
                tracked.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover">
                    <code className="mono text-accent">{t}</code>
                  </div>
                ))
              )}
            </div>

            {/* LFS files — with lock/unlock per file */}
            <div>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary border-y border-border-default mt-2">
                LFS Files ({files.length})
              </div>
              {files.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-tertiary">No LFS files in working tree</div>
              ) : (
                files.map((f, i) => {
                  const locked = locks.some(l => l.path === f.path);
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle hover:bg-bg-hover group">
                      <Package size={12} className="text-text-tertiary" />
                      <code className="mono flex-1 truncate">{f.path}</code>
                      <span className="text-2xs text-text-tertiary">{f.status}</span>
                      {locked ? (
                        <button
                          className="icon-btn !w-5 !h-5 text-status-modified opacity-100"
                          title="Unlock this file"
                          onClick={() => handleUnlock(f.path)}
                          disabled={busy === 'unlock-' + f.path}
                        >
                          <Lock size={10} />
                        </button>
                      ) : (
                        <button
                          className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Lock this file (LFS server-side)"
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
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowTrack(false)}>
          <div className="panel w-96 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-4">Track LFS Pattern</h3>
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
              This will add the pattern to .gitattributes and configure LFS tracking.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setShowTrack(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleTrack} disabled={busy === 'track'}>
                {busy === 'track' ? <Loader size={13} className="spin" /> : <Check size={13} />}
                Track
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
