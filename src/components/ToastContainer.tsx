import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from './icons';
import { useToastStore } from '../stores/toastStore';
import { cn } from '../lib/utils';

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: 'text-status-added',
  error: 'text-status-deleted',
  warning: 'text-status-modified',
  info: 'text-accent',
};

/**
 * A11Y-2 — aria-live semantics per severity.
 *
 * Two regions: one polite (info/success/warning) and one assertive
 * (error). Putting both inside a single aria-live region would let the
 * SR read them in DOM order rather than severity order, and on most
 * browsers the polite region would queue behind the assertive region
 * unnecessarily.
 *
 * The assertive region gets role='alert' so SR interrupts the user
 * immediately for errors. The polite region uses role='status' so
 * non-critical toasts are queued behind current speech.
 *
 * Severity-prefix is included as visually-hidden text ("Error: ",
 * "Success: ", etc.) so a SR user gets the severity even if the icon
 * is not announced (icons in the visual layer are not always read by
 * SR — the prefix guarantees the severity is in the text stream).
 */
const SR_PREFIX: Record<keyof typeof ICONS, string> = {
  success: 'Success: ',
  error: 'Error: ',
  warning: 'Warning: ',
  info: 'Info: ',
};

export function ToastContainer() {
  // Use granular selectors so that ONLY the ToastContainer re-renders when a
  // toast is added/dismissed — other consumers of the toast store (which
  // only need action methods) use `useToastActions` and don't re-render.
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  // Split toasts by severity so we can route them to the right aria-live
  // region. Order within each region is preserved (newest first).
  const assertiveToasts = toasts.filter(t => t.type === 'error' || t.type === 'warning');
  const politeToasts = toasts.filter(t => t.type === 'success' || t.type === 'info');

  const renderToast = (toast: typeof toasts[number]) => {
    const Icon = ICONS[toast.type];
    return (
      <div
        key={toast.id}
        className="panel min-w-[280px] max-w-md shadow-lg flex items-start gap-3 p-3 animate-fade-in"
      >
        <Icon size={18} className={cn('flex-shrink-0 mt-0.5', COLORS[toast.type])} aria-hidden={true} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary">
            {/* SR-only severity prefix — visually hidden but read by SR */}
            <span className="sr-only">{SR_PREFIX[toast.type]}</span>
            {toast.message}
          </div>
          {toast.detail && (
            <div className="text-xs text-text-secondary mt-1 break-words">
              {toast.detail}
            </div>
          )}
        </div>
        <button
          className="icon-btn flex-shrink-0"
          onClick={() => dismiss(toast.id)}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Assertive region — errors and warnings interrupt the SR user. */}
      {assertiveToasts.length > 0 && (
        <div
          className="fixed bottom-10 right-4 z-50 flex flex-col gap-2 animate-slide-up"
          role="alert"
          aria-live="assertive"
          aria-atomic={false}
        >
          {assertiveToasts.map(renderToast)}
        </div>
      )}
      {/* Polite region — successes and info queue behind current speech. */}
      {politeToasts.length > 0 && (
        <div
          className={cn(
            'fixed right-4 z-50 flex flex-col gap-2 animate-slide-up',
            // Offset so the two regions don't overlap when both have content.
            assertiveToasts.length > 0 ? 'bottom-[calc(2.5rem+8rem)]' : 'bottom-10'
          )}
          role="status"
          aria-live="polite"
          aria-atomic={false}
        >
          {politeToasts.map(renderToast)}
        </div>
      )}
    </>
  );
}
