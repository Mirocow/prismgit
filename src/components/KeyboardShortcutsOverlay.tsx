import { useEffect, useState } from 'react';
import { X } from './icons';
import { useI18n } from '../lib/i18n';

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
  /** i18n key — translated at render time. */
  descKey: string;
  keys: string[]; // e.g. ['Ctrl', 'Enter']
}

interface ShortcutGroup {
  /** i18n key — translated at render time. */
  titleKey: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shell.shortcutGroupGlobal',
    shortcuts: [
      { descKey: 'shell.scCommandPalette', keys: ['Ctrl', 'K'] },
      { descKey: 'shell.scCommandPaletteAlt', keys: ['Ctrl', 'P'] },
      { descKey: 'shell.scOpenRepo', keys: ['Ctrl', 'O'] },
      { descKey: 'shell.scCloneRepo', keys: ['Ctrl', 'Shift', 'O'] },
      { descKey: 'shell.scFindObject', keys: ['Ctrl', 'F'] },
      { descKey: 'shell.scRefreshStatus', keys: ['F5'] },
      { descKey: 'shell.scToggleTheme', keys: ['Ctrl', 'Shift', 'T'] },
      { descKey: 'shell.scShowOverlay', keys: ['?'] },
      { descKey: 'shell.scToggleOverlay', keys: ['Ctrl', '?'] },
      { descKey: 'shell.scGitFlow', keys: ['Ctrl', 'Shift', 'G'] },
      { descKey: 'shell.interactiveRebase', keys: ['Ctrl', 'Shift', 'R'] },
      { descKey: 'shell.scWindowStyleStandard', keys: ['Ctrl', 'Shift', '1'] },
      { descKey: 'shell.scWindowStyleLog', keys: ['Ctrl', 'Shift', '2'] },
      { descKey: 'shell.scWindowStyleWorktree', keys: ['Ctrl', 'Shift', '3'] },
    ],
  },
  {
    titleKey: 'shell.shortcutGroupNavigation',
    shortcuts: [
      { descKey: 'shell.scGoChanges', keys: ['Alt', '1'] },
      { descKey: 'shell.scGoHistory', keys: ['Alt', '2'] },
      { descKey: 'shell.scGoDiff', keys: ['Alt', '3'] },
      { descKey: 'shell.scGoBranches', keys: ['Alt', '4'] },
      { descKey: 'shell.scGoTags', keys: ['Alt', '5'] },
      { descKey: 'shell.scGoStashes', keys: ['Alt', '6'] },
      { descKey: 'shell.scGoSettings', keys: ['Alt', ','] },
      { descKey: 'shell.scQuickNavChanges', keys: ['Ctrl', '1–3'] },
      { descKey: 'shell.scQuickNavRefs', keys: ['Ctrl', '4–6'] },
      { descKey: 'shell.scQuickNavRemotes', keys: ['Ctrl', '7–9'] },
    ],
  },
  {
    titleKey: 'shell.shortcutGroupGitOps',
    shortcuts: [
      { descKey: 'shell.scCommit', keys: ['Ctrl', 'Enter'] },
      { descKey: 'shell.scPush', keys: ['Ctrl', 'Shift', 'P'] },
      { descKey: 'shell.scPull', keys: ['Ctrl', 'Shift', 'L'] },
      { descKey: 'shell.scFetch', keys: ['Ctrl', 'Shift', 'F'] },
      { descKey: 'shell.scStageAll', keys: ['Ctrl', 'Shift', 'A'] },
      { descKey: 'shell.scCloseDialog', keys: ['Esc'] },
    ],
  },
  {
    titleKey: 'shell.shortcutGroupHistory',
    shortcuts: [
      { descKey: 'shell.scMoveUp', keys: ['↑'] },
      { descKey: 'shell.scMoveDown', keys: ['↓'] },
      { descKey: 'shell.scSelectCommit', keys: ['Enter'] },
      { descKey: 'shell.clearSelection', keys: ['Esc'] },
      { descKey: 'shell.scSearch', keys: ['/'] },
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
  const { t } = useI18n();
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
          <span className="shortcut-overlay-title">{t('shell.keyboardShortcuts')}</span>
          <button
            className="icon-btn !w-8 !h-8"
            onClick={onClose}
            title={t('shell.closeEsc')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="shortcut-overlay-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey}>
              <div className="shortcut-section-title">{t(group.titleKey)}</div>
              {group.shortcuts.map((s) => (
                <div key={s.descKey} className="shortcut-row">
                  <span className="shortcut-row-desc">{t(s.descKey)}</span>
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
          {t('shell.tipPrefix')} <kbd>Ctrl</kbd>+<kbd>?</kbd> {t('shell.tipSuffix')}
        </div>
      </div>
    </div>
  );
}
