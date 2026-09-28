import { useEffect, useState } from 'react';
import { AlertCircle, Copy, ChevronDown, ChevronRight, X } from './icons';
import { useErrorDialogStore } from '../stores/errorDialogStore';
import { useI18n } from '../lib/i18n';

/**
 * ErrorDialogHost — single mount (App.tsx) rendering the store-driven error
 * modal. Centered popup in the app window, canonical dialog style
 * (bg-black/30 dark:bg-black/55 backdrop, z-60 — same layer as
 * ConfirmDialog, which can open on top of other dialogs).
 *
 * The raw error detail starts collapsed behind a "details" chevron when it
 * is longer than one line — the modal leads with the human message, the
 * full text is one click away (and copyable) for bug reports.
 */
export function ErrorDialogHost() {
  const { t } = useI18n();
  const open = useErrorDialogStore((s) => s.open);
  const title = useErrorDialogStore((s) => s.title);
  const message = useErrorDialogStore((s) => s.message);
  const detail = useErrorDialogStore((s) => s.detail);
  const close = useErrorDialogStore((s) => s.close);
  const [showDetail, setShowDetail] = useState(false);

  // Escape closes (registered while open only).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  // Reset the details toggle between show()s so a new error starts collapsed.
  useEffect(() => {
    if (open) setShowDetail(false);
  }, [open, title, message]);

  if (!open) return null;

  const hasDetail = detail.trim().length > 0;
  const longDetail = detail.includes('\n') || detail.length > 120;

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-60 animate-fade-in"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="panel w-[440px] max-w-[92vw] p-4"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="error-dialog"
      >
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-status-deleted shrink-0 mt-0.5" aria-hidden={true} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-text-primary" data-testid="error-dialog-title">
              {title}
            </h3>
            {message && (
              <p className="text-xs text-text-secondary mt-1 wrap-break-word" data-testid="error-dialog-message">
                {message}
              </p>
            )}
          </div>
          <button className="icon-btn shrink-0" onClick={close} aria-label={t('common.close')}>
            <X size={14} />
          </button>
        </div>

        {hasDetail && (
          <div className="mt-3">
            {longDetail && (
              <button
                className="flex items-center gap-1 text-2xs text-text-tertiary hover:text-text-secondary"
                onClick={() => setShowDetail((s) => !s)}
                data-testid="error-dialog-details-toggle"
              >
                {showDetail ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('common.errorDetails', { defaultValue: 'Details' })}
              </button>
            )}
            {(showDetail || !longDetail) && (
              <pre
                className="mt-2 text-2xs font-mono text-text-secondary bg-bg-tertiary border border-border-subtle rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word"
                data-testid="error-dialog-detail"
              >
                {detail}
              </pre>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          {hasDetail && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(detail).catch(() => {});
              }}
              data-testid="error-dialog-copy"
            >
              <Copy size={13} />
              {t('common.copy')}
            </button>
          )}
          <button className="btn btn-primary" onClick={close} data-testid="error-dialog-close">
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
