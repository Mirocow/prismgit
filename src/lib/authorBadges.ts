/**
 * Generate consistent colors for author badges based on name initials.
 * Matches SmartGit's colored author badge style.
 */

import { formatDate, formatAbsoluteDate } from './formatDate';

const BADGE_COLORS = [
  { bg: '#5B9BD5', text: '#ffffff' }, // Steel Blue
  { bg: '#C65911', text: '#ffffff' }, // Brown/Orange
  { bg: '#548235', text: '#ffffff' }, // Olive Green
  { bg: '#7030A0', text: '#ffffff' }, // Purple
  { bg: '#BF9000', text: '#ffffff' }, // Dark Yellow
  { bg: '#2E75B6', text: '#ffffff' }, // Medium Blue
  { bg: '#A5A5A5', text: '#ffffff' }, // Gray
  { bg: '#C00000', text: '#ffffff' }, // Dark Red
  { bg: '#385723', text: '#ffffff' }, // Dark Green
  { bg: '#4472C4', text: '#ffffff' }, // Blue
];

/**
 * Get initials from a name (max 2-3 chars).
 */
export function getInitials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Get a consistent color for an author based on their name hash.
 */
export function getAuthorColor(name: string): { bg: string; text: string } {
  if (!name) return BADGE_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % BADGE_COLORS.length;
  return BADGE_COLORS[index];
}

/**
 * Format time for the Journal/commit list — locale-aware.
 *
 * QW-6: previously hardcoded English ("now", "5m ago", "Yesterday")
 * and forced 'en-US' for absolute dates. Non-English users still saw
 * English text. Now delegates to formatDate / formatAbsoluteDate in
 * lib/formatDate which read the active locale from useI18nStore.
 */
export function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  // Re-use formatDate's relative-time strings for short ranges so we
  // share translations across the Journal and the rest of the app.
  if (mins < 1) return formatDate(dateStr);
  if (mins < 60) return formatDate(dateStr);
  if (hours < 24) return formatDate(dateStr);
  if (days === 1) return formatDate(dateStr);
  if (days < 7) return formatDate(dateStr);
  if (days < 365) return formatAbsoluteDate(dateStr, undefined, { month: 'short', day: 'numeric' });
  return formatAbsoluteDate(dateStr, undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
