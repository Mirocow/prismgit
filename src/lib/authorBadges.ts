/**
 * Generate consistent colors for author badges based on name initials.
 * Matches SmartGit's colored author badge style.
 */

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
 * Format time for the Journal/commit list (12-hour format like SmartGit).
 */
export function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 365) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
