import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const mins = Math.floor(diff / (1000 * 60));
      if (mins < 1) return 'just now';
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatRelativeTime(timestamp: number): string {
  return formatDate(new Date(timestamp).toISOString());
}

export function truncateMiddle(s: string, max = 40): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 3) / 2);
  return s.substring(0, half) + '...' + s.substring(s.length - half);
}

export function shortHash(hash: string): string {
  return hash.substring(0, 7);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    modified: 'var(--status-modified)',
    added: 'var(--status-added)',
    deleted: 'var(--status-deleted)',
    renamed: 'var(--status-renamed)',
    untracked: 'var(--status-untracked)',
    conflicted: 'var(--status-conflict)',
    typechanged: 'var(--status-modified)',
    unmodified: 'var(--text-tertiary)',
    ignored: 'var(--text-tertiary)',
    copied: 'var(--status-renamed)',
  };
  return colors[status] || 'var(--text-primary)';
}

export function getStatusColorFromCode(code: string): string {
  switch (code) {
    case 'M': return 'var(--status-modified)';
    case 'A': return 'var(--status-added)';
    case 'D': return 'var(--status-deleted)';
    case 'R': return 'var(--status-renamed)';
    case 'C': return 'var(--status-renamed)';
    case '?': return 'var(--status-untracked)';
    case 'U': return 'var(--status-conflict)';
    case 'T': return 'var(--status-modified)';
    default: return 'var(--text-tertiary)';
  }
}

export function getStatusCode(code: string): string {
  switch (code) {
    case '?': return 'untracked';
    case 'U': return 'conflict';
    case 'M': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'copied';
    case 'T': return 'typechanged';
    default: return 'modified';
  }
}
