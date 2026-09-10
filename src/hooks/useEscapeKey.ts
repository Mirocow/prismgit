import { useEffect, useRef } from 'react';

/**
 * Close-on-Escape wiring for modals and dialogs.
 *
 * Usage inside a component that owns (or receives) an `open` flag:
 *   useEscapeKey(open, onClose);
 *
 * The listener runs in the CAPTURE phase so it fires before page-level
 * keydown handlers (history search, diff viewer, etc.) and stops the event
 * from reaching them — pressing Escape closes only the owner of the
 * currently-mounting hook, never triggers an unrelated shortcut.
 *
 * The callback is kept in a ref so callers can pass inline closures without
 * re-subscribing the listener on every render.
 */
export function useEscapeKey(active: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cb.current();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);
}
