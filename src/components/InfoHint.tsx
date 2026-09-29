import { useId } from 'react';

/**
 * InfoHint — the «!» hitbox next to a setting label (user request: «улучши
 * инструменты настроек — снабди ! хитбоксом, объясняющим настройку»).
 *
 * A tiny circular button that reveals a hover/focus tooltip with a plain
 * -language explanation of what the setting does and when you'd want to
 * change it. Keyboard-accessible (focusable, Esc-collapsible via blur),
 * screen-reader friendly (aria-describedby + role=note).
 *
 * Deliberately NOT a native title= attribute: those need a 1s hover dwell,
 * vanish on touch, and can't wrap — a popover does all three.
 */
export function InfoHint({ text, side = 'top' }: { text: string; side?: 'top' | 'bottom' | 'right' }) {
  const id = useId();
  const pos =
    side === 'right'
      ? 'left-full top-1/2 -translate-y-1/2 ml-1.5'
      : side === 'bottom'
        ? 'top-full left-1/2 -translate-x-1/2 mt-1.5'
        : 'bottom-full left-1/2 -translate-x-1/2 mb-1.5';
  return (
    <span className="relative inline-flex items-center group align-middle">
      <button
        type="button"
        aria-label="?"
        aria-describedby={id}
        className="w-4 h-4 shrink-0 rounded-full border border-border-default text-text-tertiary hover:text-accent hover:border-accent text-2xs leading-none flex items-center justify-center transition-colors"
        // Keep the tooltip open while the pointer travels to it.
        onMouseDown={(e) => e.preventDefault()}
        tabIndex={0}
      >
        <span aria-hidden>!</span>
      </button>
      <span
        role="note"
        id={id}
        className={`pointer-events-none absolute ${pos} z-50 hidden group-hover:block group-focus-within:block w-64 p-2 rounded-md bg-bg-elevated border border-border-default shadow-lg text-2xs leading-relaxed text-text-secondary text-left whitespace-normal`}
      >
        {text}
      </span>
    </span>
  );
}
