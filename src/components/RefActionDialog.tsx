import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Search, Loader } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api, type BranchInfo } from '../lib/api';
import { cn, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';

export type RefAction =
  | 'checkout'
  | 'merge'
  | 'rebase'
  | 'cherry-pick'
  | 'revert'
  | 'delete-branch';

/** i18n keys per action — resolved with t() inside the component. */
const ACTION_META: Record<RefAction, { titleKey: string; targetKey: string; confirmKey: string; branchOnly?: boolean; localOnly?: boolean }> = {
  checkout: { titleKey: 'dialogs.checkOut', targetKey: 'dialogs.checkoutTarget', confirmKey: 'dialogs.checkOut' },
  merge: { titleKey: 'toolbar.merge', targetKey: 'dialogs.mergeTarget', confirmKey: 'toolbar.merge' },
  rebase: { titleKey: 'toolbar.rebase', targetKey: 'dialogs.rebaseTarget', confirmKey: 'toolbar.rebase' },
  'cherry-pick': { titleKey: 'dialogs.cherryPick', targetKey: 'dialogs.cherryPickTarget', confirmKey: 'dialogs.cherryPick' },
  revert: { titleKey: 'dialogs.revert', targetKey: 'dialogs.revertTarget', confirmKey: 'dialogs.revert' },
  'delete-branch': { titleKey: 'dialogs.deleteBranchTitle', targetKey: 'dialogs.deleteBranchTarget', confirmKey: 'common.delete', branchOnly: true },
};

/**
 * SmartGit-style dialog behind the Branch menu commands (Check Out…, Merge…,
 * Rebase…, Cherry-Pick…, Revert…): pick a branch from a searchable list or
 * type a commit hash/SHA prefix, preview, and run the REAL git operation.
 */
export function RefActionDialog({ action, onClose }: { action: RefAction; onClose: () => void }) {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const meta = ACTION_META[action];

  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; author: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [bs, cur] = await Promise.all([
          api.git.branches(repo.path),
          api.git.currentBranch(repo.path),
        ]);
        setBranches(bs);
        setCurrent(cur);
        // Sensible default: the branch GLOBALLY selected in another tool
        // (Branches/History/Toolbar chip) wins over the old name heuristic —
        // that's the whole point of the cross-tool selection.
        const globalSel = useSelectionStore.getState().selectedBranch;
        const preferred =
          (globalSel && bs.some((b) => b.name === globalSel && !b.current) ? globalSel : undefined)
          ?? (action === 'checkout'
            ? bs.find((b) => !b.current && !b.remote)?.name
            : bs.find((b) => /^(main|master|develop)$/.test(b.name) && !b.current)?.name);
        if (preferred) setSelected(preferred);
      } catch (e) {
        toast.error(t('dialogs.loadBranchesFailed'), String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path]);

  // Preview the target commit (single log pass over candidates)
  useEffect(() => {
    if (!selected) { setPreview(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const entry = await api.git.findCommit(repo.path, selected);
        if (!cancelled) setPreview(entry ? { subject: entry.subject, author: entry.author.name } : null);
      } catch { if (!cancelled) setPreview(null); }
    })();
    return () => { cancelled = true; };
  }, [repo.path, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = branches;
    if (action === 'checkout') list = list; // remote branches can be checked out too (creates local tracking)
    if (meta.branchOnly) list = list.filter((b) => !b.remote);
    if (!q) return list.slice(0, 200);
    return list.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 200);
  }, [branches, query, action, meta.branchOnly]);

  const run = useCallback(async () => {
    const target = selected?.trim();
    if (!target) return;
    setBusy(true);
    try {
      switch (action) {
        case 'checkout': {
          const isRemote = branches.some((b) => b.remote && b.name === target);
          await api.git.checkout(repo.path, target, { track: isRemote });
          toast.success(t('dialogs.checkedOut', { ref: target }));
          break;
        }
        case 'merge': {
          await api.git.merge(repo.path, target);
          toast.success(t('dialogs.merged', { ref: target }));
          break;
        }
        case 'rebase': {
          await api.git.rebase(repo.path, target);
          toast.success(t('dialogs.rebasedOnto', { ref: target }));
          break;
        }
        case 'cherry-pick': {
          await api.git.cherryPick(repo.path, [target]);
          toast.success(t('dialogs.cherryPicked', { hash: shortHash(target) }));
          break;
        }
        case 'revert': {
          await api.git.revert(repo.path, [target]);
          toast.success(t('dialogs.reverted', { hash: shortHash(target) }));
          break;
        }
        case 'delete-branch': {
          await api.git.deleteBranch(repo.path, target);
          toast.success(t('dialogs.branchDeleted', { ref: target }));
          break;
        }
      }
      onClose();
    } catch (e) {
      toast.error(t('dialogs.actionFailed', { action: t(meta.titleKey) }), String(e));
    } finally {
      setBusy(false);
    }
  }, [action, selected, repo.path, branches, toast, onClose, t, meta.titleKey]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div className="panel w-full max-w-lg flex flex-col max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">{t(meta.titleKey)}…</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover"><X size={14} /></button>
        </div>
        <div className="px-4 pt-3 pb-1 text-xs text-text-secondary">
          {t(meta.targetKey)}
          {current && <span className="text-text-tertiary"> — {t('dialogs.currentBranch')} <b>{current}</b></span>}
        </div>
        <div className="px-4 pb-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(e.target.value.trim() || selected); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && selected) run(); }}
              placeholder={t('dialogs.refPlaceholder')}
              className="w-full pl-8 pr-3 py-2 text-xs mono bg-surface border border-border rounded focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-[120px]">
          {filtered.map((b) => (
            <button
              key={b.name}
              onClick={() => {
                setSelected(b.name);
                setQuery(b.name);
                // Cross-tool: picking a branch here also becomes the global
                // selection so Branches/History/Toolbar stay in sync.
                if (!b.remote) useSelectionStore.getState().selectBranch(b.name);
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 rounded text-xs flex items-center gap-2 hover:bg-surface-hover',
                selected === b.name && 'bg-accent/15 text-accent'
              )}
            >
              <span className="truncate flex-1 mono">{b.name}</span>
              {b.current && <span className="text-2xs px-1 rounded bg-green-500/20 text-green-500">HEAD</span>}
              {typeof b.ahead === 'number' && typeof b.behind === 'number' && (b.ahead || b.behind) && (
                <span className="text-2xs text-text-tertiary">{b.ahead > 0 ? `↑${b.ahead}` : ''}{b.behind > 0 ? `↓${b.behind}` : ''}</span>
              )}
            </button>
          ))}
          {filtered.length === 0 && query && (
            <div className="px-3 py-4 text-xs text-text-tertiary">
              {t('dialogs.noMatchingBranch', { query })}
            </div>
          )}
        </div>
        {preview && (
          <div className="px-4 py-2 border-t border-border text-xs">
            <span className="mono text-accent">{shortHash(selected ?? '')}</span>{' '}
            <span className="text-text-primary">{preview.subject}</span>{' '}
            <span className="text-text-tertiary">— {preview.author}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button className="px-3 py-1.5 text-xs rounded border border-border hover:bg-surface-hover" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
            disabled={!selected || busy}
            onClick={run}
          >
            {busy && <Loader size={12} className="animate-spin" />}
            {t(meta.confirmKey)}
          </button>
        </div>
      </div>
    </div>
  );
}
