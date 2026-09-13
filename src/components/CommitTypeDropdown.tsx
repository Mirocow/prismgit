import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

/**
 * Conventional Commits prefix picker.
 *
 * QW-3: clicking the dropdown lists the 11 Conventional Commits types
 * (feat/fix/docs/style/refactor/perf/test/chore/build/ci/revert).
 * On select:
 *  - If the textarea is empty → inserts `${type}: ` at the start.
 *  - If the textarea already starts with `${type}: ` (any of the 11) →
 *    the existing prefix is REPLACED with the new type (so the user can
 *    change "feat:" → "fix:" without manual text editing).
 *  - Otherwise → prepends `${type}: ` to the existing text.
 *
 * The dropdown is keyboard accessible (Enter to open, Esc to close),
 * closes on outside click, and announces itself via aria-label.
 */
export interface CommitTypeDropdownProps {
  /** Called with the new commit-message value after applying the prefix. */
  onPickType: (type: string) => void;
  /** Whether the textarea is empty (controls behaviour). */
  disabled?: boolean;
}

const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'build',
  'ci',
  'revert',
] as const;

export function CommitTypeDropdown({ onPickType, disabled }: CommitTypeDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={cn(
          'text-2xs px-1.5 py-0.5 rounded flex items-center gap-1',
          disabled
            ? 'text-text-tertiary opacity-50 cursor-not-allowed'
            : 'text-text-secondary hover:bg-bg-hover'
        )}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={t('changes.commitTypeHint')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('changes.commitType')}
      >
        {t('changes.commitType')}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t('changes.commitType')}
          className="absolute bottom-full left-0 mb-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 min-w-56 max-h-72 overflow-y-auto py-1"
        >
          {COMMIT_TYPES.map((type) => {
            const labelKey = `changes.commitType${
              type.charAt(0).toUpperCase() + type.slice(1)
            }`;
            return (
              <li key={type} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover truncate font-mono"
                  onClick={() => {
                    onPickType(type);
                    setOpen(false);
                  }}
                >
                  {t(labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

