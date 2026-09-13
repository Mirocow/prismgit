import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, GitBranch, Tag, CornerDownRight } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

interface FoundRef {
  name: string;
  hash: string;
  type: 'branch' | 'tag' | 'remote';
}

interface FindObjectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (ref: FoundRef) => void;
}

export function FindObjectDialog({ open, onClose, onSelect }: FindObjectDialogProps) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastActions();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (!repo || !q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const found = await api.git.findRef(repo.path, q);
      setResults(found);
      setSelectedIdx(0);
    } catch (e) {
      toast.error(t('search.findObject.searchFailed'), String(e));
    } finally {
      setLoading(false);
    }
  }, [repo, toast, t]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => search(query), 200);
    return () => clearTimeout(t);
  }, [query, search]);

  const handleSelect = (ref: FoundRef) => {
    if (onSelect) {
      onSelect(ref);
    } else {
      // Default: write the global selection so EVERY tool (Toolbar chips,
      // History, Diff, Branches, Tags) follows the found ref, then jump to
      // History where the commit is highlighted.
      const selection = useSelectionStore.getState();
      if (ref.type === 'branch') {
        selection.selectBranch(ref.name);
      } else if (ref.type === 'tag') {
        selection.selectTag(ref.name);
      }
      selection.selectCommit(ref.hash);
      if (!window.location.hash.startsWith('#/history')) {
        window.location.hash = '#/history';
      }
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIdx]) {
      e.preventDefault();
      handleSelect(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-24 z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[560px] max-h-[60vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
          <Search size={16} className="text-text-tertiary" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-0 text-sm"
            placeholder={t('search.findObject.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ background: 'transparent', border: 'none', padding: 0 }}
          />
          {loading && <span className="text-2xs text-text-tertiary">{t('search.findObject.searching')}</span>}
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-tertiary">
              {query.trim() ? t('search.findObject.noRefs') : t('search.findObject.startTyping')}
            </div>
          ) : (
            results.map((ref, idx) => {
              const Icon = ref.type === 'tag' ? Tag : GitBranch;
              return (
                <div
                  key={ref.name}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2 cursor-pointer text-sm',
                    idx === selectedIdx ? 'bg-bg-selected' : 'hover:bg-bg-hover'
                  )}
                  onClick={() => handleSelect(ref)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <Icon
                    size={14}
                    className={
                      ref.type === 'tag'
                        ? 'text-status-modified'
                        : ref.type === 'remote'
                        ? 'text-status-renamed'
                        : 'text-status-added'
                    }
                  />
                  <span className="flex-1 truncate">{ref.name}</span>
                  <code className="text-2xs text-text-tertiary mono">
                    {ref.hash.substring(0, 8)}
                  </code>
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-border-default text-2xs text-text-tertiary flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>{t('search.findObject.navigate')}</span>
            <span>{t('search.findObject.select')}</span>
            <span>{t('search.findObject.close')}</span>
          </div>
          <span>{t('search.findObject.results').replace('{count}', String(results.length))}</span>
        </div>
      </div>
    </div>
  );
}
