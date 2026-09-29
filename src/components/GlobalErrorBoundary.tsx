import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  type CapturedError,
  formatErrorStack,
  collectEnvironment,
  persistError,
} from './ErrorReportDialog';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called when a render error is caught. The boundary persists the error
   *  to localStorage itself; this callback is for the App to OPEN the
   *  ErrorReportDialog (which lives outside the boundary so it can render
   *  even when the rest of the tree is broken). */
  onError?: (error: CapturedError) => void;
}

interface ErrorBoundaryState {
  /** When set, the boundary has caught an error and is rendering the
   *  fallback. The App's outer layer reads this and shows the
   *  ErrorReportDialog. We DON'T render the dialog inside the boundary
   *  because if the dialog itself threw, we'd have no UI at all. */
  captured: CapturedError | null;
}

/**
 * Global React Error Boundary.
 *
 * Why this exists:
 *   - Without an error boundary, a single throw in any component's render
 *     unmounts the entire React tree — the user sees a white screen with
 *     no explanation. They have to open DevTools to find the error.
 *   - With this boundary, the error is caught, persisted to localStorage
 *     (so it survives a reload), and surfaced via the `onError` callback.
 *     The App renders the ErrorReportDialog OUTSIDE this boundary so the
 *     dialog can show even when the rest of the app is broken.
 *   - The boundary also surfaces the React componentStack — which is
 *     CRITICAL for debugging render errors (it tells you exactly which
 *     component threw, not just the JS stack frame).
 *
 * Recovery:
 *   - The user clicks "Reload app" in the dialog → window.location.reload()
 *     → React remounts → the persisted error is loaded by the App and
 *     the dialog re-opens (so the user can copy the trace BEFORE deciding
 *     what to do).
 *   - The user clicks "Dismiss" → the persisted error is cleared and the
 *     app continues. If the error is non-fatal, the user keeps working.
 *   - The user clicks "Clear log" → the persisted error is cleared AND
 *     the dialog closes (the next reload will NOT re-open the dialog).
 *
 * Notes:
 *   - This boundary is NON-BLOCKING: it catches the error and reports it,
 *     but does NOT render a fallback UI (the parent App keeps the previous
 *     UI visible). This is intentional — a blocking fallback would hide
 *     the user's work behind an error screen, which is worse than a
 *     broken-but-visible UI.
 *   - The boundary is at the App root, ABOVE the page router. Errors in
 *     any page (Changes, History, Diff, etc.) are caught here.
 */
export class GlobalErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { captured: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const { message, stack } = formatErrorStack(error);
    const captured: CapturedError = {
      id: `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      kind: 'render',
      message,
      stack,
      ...collectEnvironment(),
    };
    persistError(captured);
    return { captured };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Enrich the captured error with the React componentStack — this is the
    // most useful field for debugging render errors because it tells you
    // WHICH component threw, not just the JS stack frame (which is often
    // deep inside React internals).
    // React's ErrorInfo.componentStack can be null in edge cases — coerce
    // to undefined so the CapturedError type stays happy.
    const componentStack = errorInfo.componentStack ?? undefined;
    if (this.state.captured) {
      this.setState((prev) => prev.captured
        ? { captured: { ...prev.captured, componentStack } }
        : prev
      );
    }
    // eslint-disable-next-line no-console
    console.error('[PrismGit] Render error caught by boundary:', error, errorInfo);
    // Notify the parent — the App renders the ErrorReportDialog outside
    // the boundary so the dialog can show even if the boundary itself is
    // in a broken state.
    const captured = this.state.captured;
    if (captured && this.props.onError) {
      this.props.onError({ ...captured, componentStack });
    }
  }

  render(): ReactNode {
    // NON-BLOCKING: render the children as usual. The error is reported
    // via onError (which opens the ErrorReportDialog), but the previous
    // UI is NOT replaced with a fallback. This is intentional — a
    // blocking fallback would hide the user's work behind an error screen.
    //
    // If React re-throws the same error on the next render (e.g. because
    // the broken component is still mounted), getDerivedStateFromError
    // fires again and the dialog stays open. The user can click "Reload"
    // to escape the loop.
    return this.props.children;
  }
}
