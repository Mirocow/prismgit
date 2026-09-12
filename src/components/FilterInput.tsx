import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

/**
 * Reusable FilterInput — a text input with an optional regex `.*` toggle.
 *
 * MED-2: the filter input on ChangesPage had `flex-1 min-w-0 px-2 py-0.5`
 * (full-width, responsive), but the same input on BranchesPage/HistoryPage/
 * TagsPage/StashesPage was `w-32 px-2 py-1` (fixed, narrow). The regex
 * toggle existed only on ChangesPage.
 *
 * This component unifies the layout:
 *  - always `text-xs flex-1 min-w-0 px-2 py-0.5`
 *  - optional regex button (rendered when `isRegex` and `onToggleRegex`
 *    are both provided)
 *  - optional debounce (when `debounceMs > 0`, the parent's onChange is
 *    debounced so heavy re-renders on every keystroke are avoided)
 *
 * Usage:
 *   <FilterInput
 *     value={search}
 *     onChange={setSearch}
 *     placeholder={t('branches.filterPlaceholder')}
 *     isRegex={searchRegex}
 *     onToggleRegex={toggleSearchRegex}
 *   />
 *
 *   <FilterInput
 *     value={search}
 *     onChange={setSearch}
 *     placeholder={t('history.filterPlaceholder')}
 *     debounceMs={250}
 *   />
 */
export interface FilterInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** When provided alongside `onToggleRegex`, a `.*` toggle button is rendered. */
  isRegex?: boolean;
  onToggleRegex?: () => void;
  /** When > 0, delays onChange calls by this many ms (default 0 = no debounce). */
  debounceMs?: number;
  /** Title for the regex button tooltip — defaults to "Regex". */
  regexTitle?: string;
  /** Optional accessible label for screen readers. */
  ariaLabel?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function FilterInput({
  value,
  onChange,
  placeholder,
  isRegex,
  onToggleRegex,
  debounceMs = 0,
  regexTitle = 'Regex',
  ariaLabel,
  autoFocus,
  onKeyDown,
}: FilterInputProps) {
  // Local state mirrors the parent's value when debounce is in use so the
  // input stays responsive; the parent's onChange is fired after debounce.
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef<string>(value);

  // Keep localValue in sync if the parent's value changes externally
  // (e.g. clear button). Without this, the input would show stale text
  // until the user types again.
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setLocalValue(value);
      lastEmittedRef.current = value;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocalValue(next);
    if (debounceMs <= 0) {
      lastEmittedRef.current = next;
      onChange(next);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastEmittedRef.current = next;
      onChange(next);
    }, debounceMs);
  };

  // Cleanup the debounce timer on unmount so we don't fire onChange after
  // the parent has torn down (would warn "setState on unmounted component").
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <input
        type="text"
        className="text-xs flex-1 min-w-0 px-2 py-0.5 bg-transparent border-0 outline-none focus:bg-bg-hover transition-colors"
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={localValue}
        onChange={handleChange}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
      />
      {onToggleRegex && (
        <button
          type="button"
          className={cn(
            'text-2xs px-1.5 py-0.5 border rounded font-mono flex-shrink-0',
            isRegex
              ? 'border-accent bg-accent-muted text-accent'
              : 'border-border-default bg-bg-tertiary text-text-secondary hover:text-text-primary',
          )}
          onClick={onToggleRegex}
          title={regexTitle}
          aria-pressed={isRegex ?? false}
        >
          .*
        </button>
      )}
    </div>
  );
}
