import { useState, useEffect, useCallback } from 'react';
import { X, Check, Trash, Plus, Star, RefreshCw, Loader, ExternalLink, GitBranch, Tag as TagIcon, FileText, Eye, EyeOff, KeyRound } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type RepositoryMetadata, type RemoteInfo } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { isBackgroundFetchEnabled, setBackgroundFetchForRepo } from '../lib/backgroundFetch';
import { getAllRemoteAuth, setRemoteAuth } from '../lib/remoteAuth';

interface RepoInfoDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RepoInfoDialog({ open, onClose }: RepoInfoDialogProps) {
  useEscapeKey(open, onClose);
  const { currentRepo, currentMetadata, updateMetadata, toggleFavorite, addTag, removeTag, refreshStats } = useRepositoryStore();
  const toast = useToastStore();
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [newTag, setNewTag] = useState('');
  const [color, setColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // === Remotes & Authorization (ALL remotes of this repository) ===
  const [remotes, setRemotes] = useState<RemoteInfo[]>([]);
  const [remotesLoading, setRemotesLoading] = useState(false);
  const [authDraft, setAuthDraft] = useState<Record<string, { username: string; password: string }>>({});
  const [bgDraft, setBgDraft] = useState<Record<string, boolean>>({});
  const [showPasswords, setShowPasswords] = useState(false);

  const load = useCallback(() => {
    if (currentMetadata) {
      setDescription(currentMetadata.description || '');
      setNotes(currentMetadata.notes || '');
      setColor(currentMetadata.color || '');
    }
  }, [currentMetadata]);

  // Load remotes + their stored auth every time the dialog opens.
  useEffect(() => {
    if (!open || !currentRepo) return;
    load();
    let cancelled = false;
    const repoPath = currentRepo.path;
    setRemotesLoading(true);
    api.git.remotes(repoPath)
      .then(async (rs) => {
        if (cancelled) return;
        setRemotes(rs);
        const auth: Record<string, { username: string; password: string }> = {};
        const bg: Record<string, boolean> = {};
        const stored = getAllRemoteAuth(repoPath);
        for (const r of rs) {
          auth[r.name] = { username: stored[r.name]?.username ?? '', password: stored[r.name]?.password ?? '' };
          bg[r.name] = isBackgroundFetchEnabled(repoPath, r.name);
        }
        setAuthDraft(auth);
        setBgDraft(bg);
      })
      .catch(() => {
        if (!cancelled) setRemotes([]);
      })
      .finally(() => {
        if (!cancelled) setRemotesLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentRepo?.path]);

  const updateAuthDraft = (name: string, patch: Partial<{ username: string; password: string }>) => {
    setAuthDraft((prev) => ({ ...prev, [name]: { ...(prev[name] ?? { username: '', password: '' }), ...patch } }));
  };

  const handleSave = async () => {
    if (!currentRepo) return;
    setSaving(true);
    try {
      // 1. Repository metadata (description, notes, color)
      await updateMetadata(currentRepo.path, { description, notes, color });
      // 2. Per-remote credentials + auto-refresh — shared with the Remotes tool
      for (const r of remotes) {
        setRemoteAuth(currentRepo.path, r.name, {
          username: authDraft[r.name]?.username ?? '',
          password: authDraft[r.name]?.password ?? '',
        });
        setBackgroundFetchForRepo(currentRepo.path, r.name, bgDraft[r.name] ?? false);
      }
      toast.success('Repository settings saved');
      onClose();
    } catch (e) {
      toast.error('Failed to save', String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAddTag = async () => {
    if (!currentRepo || !newTag.trim()) return;
    try {
      await addTag(currentRepo.path, newTag.trim());
      setNewTag('');
    } catch (e) {
      toast.error('Failed to add tag', String(e));
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!currentRepo) return;
    try {
      await removeTag(currentRepo.path, tag);
    } catch (e) {
      toast.error('Failed to remove tag', String(e));
    }
  };

  const handleToggleFavorite = async () => {
    if (!currentRepo) return;
    try {
      await toggleFavorite(currentRepo.path);
    } catch (e) {
      toast.error('Failed to toggle favorite', String(e));
    }
  };

  const handleRefreshStats = async () => {
    if (!currentRepo) return;
    setRefreshing(true);
    try {
      await refreshStats(currentRepo.path);
      toast.success('Stats refreshed');
    } catch (e) {
      toast.error('Failed to refresh', String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenInBrowser = () => {
    if (currentMetadata?.webUrl) {
      api.app.openExternal(currentMetadata.webUrl);
    }
  };

  // Repository maintenance: git count-objects -v (size, pack status)
  const [objectStats, setObjectStats] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);

  const handleCountObjects = async () => {
    if (!currentRepo) return;
    setCounting(true);
    try {
      const raw = await api.git.countObjects(currentRepo.path, true);
      setObjectStats(raw.trim());
    } catch (e) {
      toast.error('count-objects failed', String(e));
    } finally {
      setCounting(false);
    }
  };

  // Update server info for dumb-HTTP hosting (git update-server-info)
  const handleUpdateServerInfo = async () => {
    if (!currentRepo) return;
    try {
      await api.git.updateServerInfo(currentRepo.path);
      toast.success('Server info updated (info/refs + objects/info/packs)');
    } catch (e) {
      toast.error('update-server-info failed', String(e));
    }
  };

  if (!open || !currentRepo) return null;

  const meta: Partial<RepositoryMetadata> = currentMetadata || {};
  const colors = ['#39BAE6', '#AAD94C', '#F26D78', '#D2A6FF', '#FFD700', '#95E6CB', '#FF8F6F', '#69A4FF'];

  const inputCls = 'w-full text-xs bg-bg-secondary border border-border-default rounded px-2 py-1.5 focus:outline-none focus:border-accent';

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[600px] max-h-[85vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <button
              className="icon-btn"
              title={meta.favorite ? 'Remove from favorites' : 'Add to favorites'}
              onClick={handleToggleFavorite}
            >
              <Star
                size={16}
                className={meta.favorite ? 'text-status-modified fill-current' : ''}
              />
            </button>
            <h3 className="text-base font-medium">{currentRepo.name}</h3>
            {meta.provider && meta.provider !== 'unknown' && (
              <span className="badge badge-renamed capitalize">{meta.provider}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="icon-btn"
              title="Refresh stats from Git"
              onClick={handleRefreshStats}
              disabled={refreshing}
            >
              {refreshing ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
            </button>
            {meta.webUrl && (
              <button
                className="icon-btn"
                title="Open in browser"
                onClick={handleOpenInBrowser}
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button className="icon-btn" onClick={onClose}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Path */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Path</label>
            <code className="text-xs mono block bg-bg-tertiary p-2 rounded break-all">
              {currentRepo.path}
            </code>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Description</label>
            <input
              type="text"
              className="w-full text-sm"
              placeholder="Repository description (custom)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Color tag</label>
            <div className="flex items-center gap-2.5">
              {colors.map(c => (
                <button
                  key={c}
                  title={color === c ? `${c} (selected)` : c}
                  className={cn(
                    'w-6 h-6 rounded-full grid place-items-center transition-all',
                    color === c
                      ? 'scale-110 shadow-md'
                      : 'opacity-85 hover:opacity-100 hover:scale-105'
                  )}
                  style={{
                    backgroundColor: c,
                    // Selected: halo in the same color — visible on any theme
                    boxShadow: color === c ? `0 0 0 2px var(--bg-primary), 0 0 0 4px ${c}` : undefined,
                  }}
                  onClick={() => setColor(color === c ? '' : c)}
                >
                  {color === c && <Check size={12} className="text-white drop-shadow" strokeWidth={3} />}
                </button>
              ))}
              {color && (
                <button
                  className="icon-btn !w-6 !h-6"
                  title="Clear color"
                  onClick={() => setColor('')}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Remotes & Authorization — ALL remotes, shared with the Remotes tool */}
          <div className="border-t border-border-default pt-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary flex items-center gap-1.5">
                <KeyRound size={12} />
                Remotes &amp; Authorization
              </div>
              {remotes.length > 0 && (
                <button
                  className="icon-btn !w-6 !h-6"
                  title={showPasswords ? 'Hide passwords' : 'Show passwords'}
                  onClick={() => setShowPasswords((v) => !v)}
                >
                  {showPasswords ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              )}
            </div>
            <p className="text-2xs text-text-tertiary mb-2">
              Credentials are used for push / pull / fetch on this remote (HTTP/HTTPS). The same
              values are editable in the Remotes tool. Stored only in the local app settings.
            </p>
            {remotesLoading ? (
              <div className="flex justify-center py-3"><Loader size={14} className="animate-spin text-text-tertiary" /></div>
            ) : remotes.length === 0 ? (
              <div className="text-xs text-text-tertiary py-2">
                No remotes configured — add one in the Remotes tool.
              </div>
            ) : (
              <div className="space-y-2">
                {remotes.map((r) => {
                  const cred = authDraft[r.name] ?? { username: '', password: '' };
                  const stored = !!(cred.username.trim() || cred.password.trim());
                  return (
                    <div key={r.name} className="rounded-md border border-border-default bg-bg-secondary/40 p-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <GitBranch size={12} className="text-accent flex-shrink-0" />
                        <span className="text-xs font-medium">{r.name}</span>
                        {r.name === 'origin' && <span className="badge badge-renamed">DEFAULT</span>}
                        {stored && <span className="badge badge-added">AUTH</span>}
                        <div className="flex-1" />
                        <label
                          className="flex items-center gap-1.5 text-2xs text-text-secondary cursor-pointer select-none"
                          title="Refresh this remote in the background (also used by the sidebar remote check)"
                        >
                          <input
                            type="checkbox"
                            checked={bgDraft[r.name] ?? false}
                            onChange={(e) => setBgDraft((prev) => ({ ...prev, [r.name]: e.target.checked }))}
                          />
                          Refresh automatically
                        </label>
                      </div>
                      <div className="text-2xs font-mono text-text-tertiary truncate" title={r.refs.fetch}>
                        {r.refs.fetch}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          className={inputCls}
                          placeholder="Username"
                          autoComplete="off"
                          value={cred.username}
                          onChange={(e) => updateAuthDraft(r.name, { username: e.target.value })}
                        />
                        <input
                          type={showPasswords ? 'text' : 'password'}
                          className={inputCls}
                          placeholder="Password / token"
                          autoComplete="new-password"
                          value={cred.password}
                          onChange={(e) => updateAuthDraft(r.name, { password: e.target.value })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {meta.tags && meta.tags.length > 0 ? (
                meta.tags.map(tag => (
                  <span
                    key={tag}
                    className="badge badge-renamed flex items-center gap-1"
                  >
                    <TagIcon size={9} />
                    {tag}
                    <button
                      className="ml-1 hover:text-status-deleted"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-text-tertiary">No tags</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 text-sm"
                placeholder="Add tag..."
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              />
              <button
                className="btn btn-secondary text-xs"
                onClick={handleAddTag}
                disabled={!newTag.trim()}
              >
                <Plus size={12} />
                Add
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Notes</label>
            <textarea
              className="w-full text-sm h-24 resize-none"
              placeholder="Personal notes about this repository..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Repository maintenance */}
          <div className="border-t border-border-default pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
              Repository Maintenance
            </div>
            <div className="flex items-center gap-2 mb-2">
              <button className="btn btn-secondary text-xs" onClick={handleCountObjects} disabled={counting}>
                {counting ? <Loader size={12} className="spin" /> : <RefreshCw size={12} />}
                Count objects
              </button>
              <button
                className="btn btn-secondary text-xs"
                onClick={handleUpdateServerInfo}
                title="git update-server-info — refresh info/refs for dumb-HTTP hosting"
              >
                Update server info
              </button>
            </div>
            {objectStats && (
              <pre className="text-2xs font-mono bg-bg-tertiary p-2 rounded whitespace-pre-wrap text-text-secondary">{
                objectStats
                  .split('\n')
                  .filter((l) => !/^\s*$/.test(l))
                  .join('\n')
              }</pre>
            )}
          </div>

          {/* Auto-collected stats */}
          <div className="border-t border-border-default pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-2">
              Git Statistics
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <GitBranch size={12} className="text-text-tertiary" />
                <span className="text-text-tertiary">Branches:</span>
                <span className="text-text-primary font-medium">{meta.branchCount || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <FileText size={12} className="text-text-tertiary" />
                <span className="text-text-tertiary">Last commit:</span>
                {meta.lastCommitHash ? (
                  <code className="mono text-accent">{shortHash(meta.lastCommitHash)}</code>
                ) : (
                  <span className="text-text-tertiary">—</span>
                )}
              </div>
              {meta.lastCommitMessage && (
                <div className="col-span-2 text-text-secondary truncate">
                  {meta.lastCommitMessage}
                </div>
              )}
              {meta.lastCommitDate && (
                <div className="col-span-2 text-text-tertiary">
                  {formatDate(meta.lastCommitDate)}
                </div>
              )}
              {meta.remoteUrl && (
                <div className="col-span-2">
                  <span className="text-text-tertiary">Remote:</span>
                  <code className="mono text-text-secondary ml-1 break-all">{meta.remoteUrl}</code>
                </div>
              )}
              {meta.owner && meta.repo && (
                <div className="col-span-2">
                  <span className="text-text-tertiary">Repository:</span>
                  <span className="text-text-primary ml-1">{meta.owner}/{meta.repo}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader size={13} className="spin" /> : <Check size={13} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
