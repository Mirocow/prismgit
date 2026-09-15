import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';

// ─── Boot-time error capture ────────────────────────────────────────────────
// This runs BEFORE React mounts. If the renderer script itself fails to
// load (e.g. a syntax error in a dependency, a CSP violation, a network
// failure in dev), the user would otherwise see a permanent white screen
// with the boot spinner forever.
//
// Strategy:
//   1. Install window.onerror + unhandledrejection listeners that persist
//      the error to localStorage (same key the App's ErrorReportDialog
//      reads from).
//   2. When React mounts, the App's useEffect reads the persisted error
//      and opens the ErrorReportDialog automatically.
//   3. If React NEVER mounts (a hard syntax error in App.tsx), the boot
//      screen's safety timeout (15s) fires and hides the spinner. The
//      persisted error is still in localStorage, so on the NEXT reload
//      the App will see it and show the dialog.
//
// This must be a separate module-level block (not a React useEffect) so
// it runs even if React never mounts.
try {
  const persistBootError = (kind: 'uncaught' | 'unhandledrejection', reason: unknown) => {
    try {
      const err = reason instanceof Error
        ? { message: reason.message || reason.name, stack: reason.stack || String(reason) }
        : { message: String(reason), stack: String(reason) };
      const captured = {
        id: `${kind}-boot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        kind: kind as 'uncaught' | 'unhandledrejection',
        message: err.message,
        stack: err.stack,
        context: 'Boot-time error (before React mount)',
      };
      localStorage.setItem('prismgit-last-error', JSON.stringify(captured));
    } catch {
      /* localStorage unavailable — nothing we can do */
    }
  };
  window.addEventListener('error', (event) => {
    // Don't preventDefault — we want the error to ALSO show in the console
    // for debugging. We just persist it so React can show the dialog.
    persistBootError('uncaught', event.error || new Error(event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    persistBootError('unhandledrejection', event.reason);
  });
} catch {
  /* if the error handler itself fails, we're truly stuck — nothing to do */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
