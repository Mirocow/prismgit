import { useState, useEffect } from 'react';
import { Plus, Folder, X, Loader } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

import { useEscapeKey } from '../hooks/useEscapeKey';
interface InitModalProps {
  open: boolean;
  onClose: () => void;
}

export function InitModal({ open, onClose }: InitModalProps) {
  useEscapeKey(open, onClose);
  const { t } = useI18n();
  const initRepository = useRepositoryStore((s) => s.initRepository);
  const toast = useToastActions();
  const [path, setPath] = useState('');
  const [bare, setBare] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setPath('');
      setBare(false);
    }
  }, [open]);

  const handleBrowse = async () => {
    const p = await api.fs.openDirectoryPicker();
    if (p) setPath(p);
  };

  const handleInit = async () => {
    if (!path.trim()) {
      toast.warning(t('dialogs.targetRequired'));
      return;
    }
    setLoading(true);
    try {
      await initRepository(path);
      toast.success(t('dialogs.initCreated'));
      onClose();
    } catch (e) {
      toast.error(t('dialogs.initFailed'), String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-96 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <Plus size={16} />
            {t('dialogs.initTitle')}
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-text-tertiary block mb-1">
              {t('dialogs.directoryLabel')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 text-sm font-mono"
                placeholder="/path/to/new/repo"
                value={path}
                autoFocus
                onChange={(e) => setPath(e.target.value)}
              />
              <button className="btn btn-secondary" onClick={handleBrowse}>
                <Folder size={12} />
                {t('dialogs.browse')}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={bare}
              onChange={(e) => setBare(e.target.checked)}
            />
            {t('dialogs.bareRepo')}
          </label>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleInit}
            disabled={loading || !path.trim()}
          >
            {loading ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
            {t('dialogs.initButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
