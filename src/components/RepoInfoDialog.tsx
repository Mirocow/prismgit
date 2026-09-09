import { useState, useEffect, useCallback } from 'react';
import { X, Check, Trash, Plus, Star, RefreshCw, Loader, ExternalLink, GitBranch, Tag as TagIcon, FileText } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type RepositoryMetadata } from '../lib/api';
import { cn, formatDate, shortHash } from '../lib/utils';

interface RepoInfoDialogProps {
  open: boolean;
  onClose: () => void;
}

export function RepoInfoDialog({ open, onClose }: RepoInfoDialogProps) {
  const { currentRepo, currentMetadata, updateMetadata, toggleFavorite, addTag, removeTag, refreshStats } = useRepositoryStore();
  const toast = useToastStore();
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [newTag, setNewTag] = useState('');
  const [color, setColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    if (currentMetadata) {
      setDescription(currentMetadata.description || '');
      setNotes(currentMetadata.notes || '');
      setColor(currentMetadata.color || '');
    }
  }, [currentMetadata]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleSave = async () => {
    if (!currentRepo) return;
    setSaving(true);
    try {
      await updateMetadata(currentRepo.path, { description, notes, color });
      toast.success('Repository info saved');
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

  if (!open || !currentRepo) return null;

  const meta: Partial<RepositoryMetadata> = currentMetadata || {};
  const colors = ['#39BAE6', '#AAD94C', '#F26D78', '#D2A6FF', '#FFD700', '#95E6CB', '#FF8F6F', '#69A4FF'];

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[560px] max-h-[80vh] flex flex-col shadow-lg"
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
            <div className="flex items-center gap-2">
              {colors.map(c => (
                <button
                  key={c}
                  className={cn(
                    'w-6 h-6 rounded-full border-2 transition-transform',
                    color === c ? 'border-text-primary scale-110' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(color === c ? '' : c)}
                />
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
