/**
 * Provider switcher chip — modeled after the AI Assistant provider switcher.
 *
 * Compact chip in the page header showing the active provider + owner/repo.
 * Click opens a dropdown listing the two supported providers (GitHub, GitLab)
 * plus an "Auto-detect" option to drop back to auto-detection from the
 * remote URL host substring.
 *
 * Why this UI (the user's complaint):
 *   "Pull Requests и Reviews - это не юзабельно, нет единого выбора
 *    провайдера с которым осуществляется работа."
 *
 *   PRs and Reviews had separate provider pickers, and once you picked
 *   "GitLab" on the PR page, Reviews still showed GitHub. The fix lives
 *   in `providerStore` — a single shared store. This chip is its UI:
 *   one control in every page header, click → switch in one click.
 *
 * Same pattern as AI Assistant's provider switcher (see AiAssistant.tsx
 * line ~589): a small chip with the active value + ▾, opening a dropdown
 * of options. The active option gets `bg-accent-muted text-accent` and
 * a "•" indicator.
 */
import { useState, useRef, useEffect } from 'react';
import { useProviderStore, suggestProviderFromUrl, type RepoProvider } from '../stores/providerStore';
import { cn } from '../lib/utils';

const PROVIDERS: { id: 'github' | 'gitlab'; label: string; color: string }[] = [
  { id: 'github', label: 'GitHub', color: 'var(--accent-purple, #6f42c1)' },
  { id: 'gitlab', label: 'GitLab', color: 'var(--accent-orange, #fc6d26)' },
];

export function ProviderChip({ className }: { className?: string }) {
  const provider = useProviderStore((s) => s.provider);
  const owner = useProviderStore((s) => s.owner);
  const repo = useProviderStore((s) => s.repo);
  const url = useProviderStore((s) => s.url);
  const manualOverride = useProviderStore((s) => s.manualOverride);
  const selectProvider = useProviderStore((s) => s.selectProvider);
  const detect = useProviderStore((s) => s.detect);
  const repoPath = useProviderStore((s) => s.repoPath);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const activeMeta = PROVIDERS.find((p) => p.id === provider);
  const suggested = suggestProviderFromUrl(url || '');

  const handleSelect = (id: 'github' | 'gitlab') => {
    selectProvider(id);
    setOpen(false);
  };

  const handleAutoDetect = async () => {
    // Force re-detection — drops the manualOverride flag and re-runs
    // extractRepoInfo against the remote URL.
    if (repoPath) {
      await detect(repoPath, { force: true });
    }
    setOpen(false);
  };

  const chipLabel = activeMeta ? activeMeta.label : (manualOverride ? 'No provider' : 'Auto-detect');
  const chipColor = activeMeta?.color ?? 'var(--text-tertiary)';

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs bg-bg-secondary border border-border-subtle hover:border-accent transition-colors max-w-full"
        title={
          activeMeta
            ? `${activeMeta.label}${owner && repo ? `: ${owner}/${repo}` : ''}${manualOverride ? ' (manual)' : ' (auto-detected)'}`
            : 'No provider — click to choose'
        }
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: chipColor }}
        />
        <span className="truncate max-w-20">{chipLabel}</span>
        {owner && repo && (
          <span className="text-text-tertiary font-mono truncate max-w-32 hidden md:inline">
            {owner}/{repo}
          </span>
        )}
        <span className="text-text-tertiary text-3xs">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-bg-elevated border border-border-default rounded shadow-xl z-50 max-h-80 overflow-y-auto">
          <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold px-3 pt-2 pb-1">
            Switch provider
          </div>
          {/* Auto-detect option — drops manual override */}
          {(manualOverride || provider !== 'unknown') && (
            <button
              type="button"
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors flex items-center gap-2 border-b border-border-subtle',
                provider === 'unknown' && !manualOverride && 'bg-accent-muted text-accent',
              )}
              onClick={handleAutoDetect}
              title="Re-scan the remote URL and pick the provider automatically"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
              <span className="flex-1">Auto-detect from remote URL</span>
              {provider === 'unknown' && !manualOverride && (
                <span className="text-3xs text-accent">•</span>
              )}
            </button>
          )}
          {PROVIDERS.map((p) => {
            const isActive = provider === p.id;
            const isSuggested = !manualOverride && suggested === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors flex items-center gap-2',
                  isActive && 'bg-accent-muted text-accent',
                )}
                onClick={() => handleSelect(p.id)}
                title={p.label}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="flex-1">{p.label}</span>
                {isActive ? (
                  <span className="text-3xs text-accent">•</span>
                ) : isSuggested ? (
                  <span className="text-3xs text-text-tertiary italic">detected</span>
                ) : null}
              </button>
            );
          })}
          <div className="text-3xs text-text-tertiary px-3 py-1.5 border-t border-border-subtle">
            {url
              ? `Remote: ${url.length > 50 ? url.slice(0, 47) + '…' : url}`
              : 'No remote URL configured'}
          </div>
        </div>
      )}
    </div>
  );
}
