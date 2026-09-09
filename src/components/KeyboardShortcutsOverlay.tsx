import { useEffect, useState } from 'react';
import { X } from './icons';

/**
 * Keyboard Shortcuts Overlay
 * ==========================
 *
 * Modal overlay that shows all available keyboard shortcuts in PrismGit.
 * Triggered by Ctrl+? / Cmd+? (or Ctrl+/ on some layouts).
 *
 * Closes on: Esc, clicking outside the panel, or clicking the X button.
 */

interface ShortcutEntry {
  desc: string;
  keys: string[]; // e.g. ['Ctrl', 'Enter']
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    shortcuts: [
      { desc: 'Command palette (pages, actions, tools)', keys: ['Ctrl', 'K'] },
      { desc: 'Command palette (alternative)', keys: ['Ctrl', 'P'] },
      { desc: 'Open repository', keys: ['Ctrl', 'O'] },
      { desc: 'Clone repository', keys: ['Ctrl', 'Shift', 'O'] },
      { desc: 'Find object (commit/branch/tag)', keys: ['Ctrl', 'F'] },
      { desc: 'Refresh git status', keys: ['F5'] },
      { desc: 'Toggle theme (dark/light)', keys: ['Ctrl', 'Shift', 'T'] },
      { desc: 'Show this shortcuts overlay', keys: ['?'] },
      { desc: 'Toggle this shortcuts overlay', keys: ['Ctrl', '?'] },
      { desc: 'Git-Flow dialog', keys: ['Ctrl', 'Shift', 'G'] },
      { desc: 'Interactive rebase', keys: ['Ctrl', 'Shift', 'R'] },
      { desc: 'Window style: Standard', keys: ['Ctrl', 'Shift', '1'] },
      { desc: 'Window style: Log', keys: ['Ctrl', 'Shift', '2'] },
      { desc: 'Window style: Working Tree', keys: ['Ctrl', 'Shift', '3'] },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { desc: 'Go to Changes', keys: ['Alt', '1'] },
      { desc: 'Go to History', keys: ['Alt', '2'] },
      { desc: 'Go to Diff', keys: ['Alt', '3'] },
      { desc: 'Go to Branches', keys: ['Alt', '4'] },
      { desc: 'Go to Tags', keys: ['Alt', '5'] },
      { desc: 'Go to Stashes', keys: ['Alt', '6'] },
      { desc: 'Go to Settings', keys: ['Alt', ','] },
      { desc: 'Quick nav: Changes / History / Diff', keys: ['Ctrl', '1–3'] },
      { desc: 'Quick nav: Branches / Tags / Stashes', keys: ['Ctrl', '4–6'] },
      { desc: 'Quick nav: Remotes / Journal / Investigate', keys: ['Ctrl', '7–9'] },
    ],
  },
  {
    title: 'Git Operations',
    shortcuts: [
      { desc: 'Commit (when in Changes)', keys: ['Ctrl', 'Enter'] },
      { desc: 'Push', keys: ['Ctrl', 'Shift', 'P'] },
      { desc: 'Pull', keys: ['Ctrl', 'Shift', 'L'] },
      { desc: 'Fetch', keys: ['Ctrl', 'Shift', 'F'] },
      { desc: 'Stage all', keys: ['Ctrl', 'Shift', 'A'] },
      { desc: 'Close dialog / palette', keys: ['Esc'] },
    ],
  },
  {
    title: 'History / Commit List',
    shortcuts: [
      { desc: 'Move selection up', keys: ['↑'] },
      { desc: 'Move selection down', keys: ['↓'] },
      { desc: 'Select commit (open detail)', keys: ['Enter'] },
      { desc: 'Clear selection', keys: ['Esc'] },
      { desc: 'Search by message/author/hash', keys: ['/'] },
    ],
  },
];

export function KeyboardShortcutsOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="shortcut-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="shortcut-overlay-panel">
        <div className="shortcut-overlay-header">
          <span className="shortcut-overlay-title">Keyboard Shortcuts</span>
          <button
            className="icon-btn !w-8 !h-8"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
        <div className="shortcut-overlay-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="shortcut-section-title">{group.title}</div>
              {group.shortcuts.map((s) => (
                <div key={s.desc} className="shortcut-row">
                  <span className="shortcut-row-desc">{s.desc}</span>
                  <span className="shortcut-row-keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div
          className="px-5 py-3 border-t border-border-default text-2xs text-text-tertiary"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          Tip: press <kbd>Ctrl</kbd>+<kbd>?</kbd> anytime to reopen this overlay.
        </div>
      </div>
    </div>
  );
}
