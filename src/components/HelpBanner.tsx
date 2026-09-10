import { useState, useEffect } from 'react';
import { NAV_DESCRIPTIONS } from './navItems';
import { useLocation } from 'react-router-dom';
import { X, BookOpen } from './icons';

/**
 * Help Banner
 * ===========
 *
 * Shows a dismissible info banner at the top of each tool page explaining
 * what the tool does and how to use it. The banner is dismissed per-page
 * and remembered in localStorage so it doesn't reappear after the user
 * dismisses it.
 *
 * The description text comes from NAV_DESCRIPTIONS (defined in navItems.ts).
 */

const STORAGE_KEY = 'prismgit-help-dismissed';

function getDismissedPages(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function setDismissedPage(path: string): void {
  const set = getDismissedPages();
  set.add(path);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function HelpBanner() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const path = location.pathname;

  // Check if this page has a description AND hasn't been dismissed
  useEffect(() => {
    const description = NAV_DESCRIPTIONS[path];
    if (!description) {
      setVisible(false);
      return;
    }
    const dismissed = getDismissedPages();
    setVisible(!dismissed.has(path));
  }, [path]);

  const description = NAV_DESCRIPTIONS[path];
  if (!description || !visible) return null;

  const handleDismiss = () => {
    setDismissedPage(path);
    setVisible(false);
  };

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 bg-accent-muted border-b border-accent/20 text-xs text-text-secondary animate-fade-in"
      role="note"
    >
      <BookOpen size={14} className="text-accent flex-shrink-0 mt-0.5" />
      <span className="flex-1 leading-relaxed">{description}</span>
      <button
        className="icon-btn !w-5 !h-5 flex-shrink-0"
        onClick={handleDismiss}
        title="Dismiss (won't show again for this page)"
      >
        <X size={10} />
      </button>
    </div>
  );
}
