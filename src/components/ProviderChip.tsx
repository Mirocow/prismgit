/**
 * Compact provider indicator — shows the current hosting provider (GitHub or
 * GitLab) plus the owner/repo from the shared providerStore.
 *
 * Visible in page headers (PullRequests, Reviews) so the user can see at a
 * glance which provider the current repo is bound to — and that picking
 * "GitLab" on one page carries over to the other.
 *
 * Clicking the chip re-runs detection. Useful when the user has just changed
 * the remote URL and wants to refresh, or when manualOverride is set and they
 * want to drop back to auto-detection.
 */
import { useState } from 'react';
import { useProviderStore, type RepoProvider } from '../stores/providerStore';
import { cn } from '../lib/utils';

const PROVIDER_META: Record<RepoProvider, { label: string; color: string }> = {
  github: { label: 'GitHub', color: 'var(--accent-purple, #6f42c1)' },
  gitlab: { label: 'GitLab', color: 'var(--accent-orange, #fc6d26)' },
  unknown: { label: 'No provider', color: 'var(--text-tertiary)' },
};

export function ProviderChip({ className }: { className?: string }) {
  const provider = useProviderStore((s) => s.provider);
  const owner = useProviderStore((s) => s.owner);
  const repo = useProviderStore((s) => s.repo);
  const manualOverride = useProviderStore((s) => s.manualOverride);
  const detect = useProviderStore((s) => s.detect);
  const [refreshing, setRefreshing] = useState(false);
  const meta = PROVIDER_META[provider];

  const handleClick = async () => {
    // Force re-detection even if manualOverride is set — useful for switching
    // back to auto after a manual override.
    const repoPath = useProviderStore.getState().repoPath;
    if (!repoPath) return;
    setRefreshing(true);
    try {
      await detect(repoPath, { force: true });
    } finally {
      setRefreshing(false);
    }
  };

  if (provider === 'unknown') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium',
          'bg-bg-tertiary text-text-tertiary',
          className
        )}
        title="Provider not detected — open Pull Requests to choose"
      >
        {meta.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={refreshing}
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium',
        'border border-border-default bg-bg-tertiary hover:bg-bg-hover transition-colors',
        className
      )}
      style={{ color: meta.color }}
      title={
        manualOverride
          ? `Manually set to ${meta.label} — click to re-detect from remote URL`
          : `Auto-detected as ${meta.label} — click to re-detect`
      }
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      <span>{meta.label}</span>
      {owner && repo && (
        <span className="text-text-tertiary font-mono">
          {owner}/{repo}
        </span>
      )}
      {manualOverride && (
        <span className="text-text-tertiary opacity-60" title="Manual override">
          *
        </span>
      )}
      {refreshing && <span className="opacity-60">…</span>}
    </button>
  );
}
