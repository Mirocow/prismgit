/**
 * ConfirmDialog — app-styled replacement for the native window.confirm() /
 * window.prompt() (which look robotic, block the whole window and ignore
 * the dark theme).
 *
 * Usage — no state wiring needed, the helper returns a Promise:
 *
 *   import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
 *
 *   if (!(await confirmDialog({
 *     title: 'Delete tag',
 *     message: `Delete tag '${name}'? This cannot be undone.`,
 *     confirmLabel: 'Delete',
 *     danger: true,
 *   }))) return;
 *
 *   const name = await promptDialog({
 *     title: 'Move worktree',
 *     message: 'Enter the new location:',
 *     input: { initialValue: wt.path, placeholder: '/path/to/worktree' },
 *   });
 *   if (name == null) return; // cancelled
 *
 * The <ConfirmDialogHost /> is mounted once in App.tsx. When the host is not
 * mounted (unit tests), the helpers transparently fall back to the native
 * dialogs so behavior-level tests keep working.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from './icons';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useI18n } from '../lib/i18n';

export interface ConfirmDialogInput {
  /** Prefilled value. */
  initialValue?: string;
  placeholder?: string;
  /** Hint shown under the input. */
  hint?: string;
}

export interface ConfirmDialogOptions {
  title: string;
  /** Body text. '\n' is rendered as a line break. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red accent: confirm button + warning icon. Use for destructive actions. */
  danger?: boolean;
  /** When set, the dialog shows a single-line text input (prompt mode). */
  input?: ConfirmDialogInput;
  /** Hide the Cancel button — turns the dialog into a plain message box. */
  hideCancel?: boolean;
  /** Prompt mode only: return an error string to block confirming. */
  validate?: (value: string) => string | null;
}

interface Request extends ConfirmDialogOptions {
  resolve: (v: boolean | string | null) => void;
}

// Module-level bridge between the stateless helpers and the mounted host.
let enqueue: ((req: Request) => void) | null = null;

export function confirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  if (!enqueue) {
    // Host not mounted (tests) — native fallback.
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm([opts.title, opts.message].filter(Boolean).join('\n\n')));
  }
  return new Promise<boolean>((resolve) => {
    enqueue!({ ...opts, resolve: (v) => resolve(v === true) });
  });
}

export function promptDialog(opts: ConfirmDialogOptions): Promise<string | null> {
  if (!enqueue) {
    // eslint-disable-next-line no-alert
    return Promise.resolve(
      window.prompt([opts.title, opts.message].filter(Boolean).join('\n\n'), opts.input?.initialValue ?? '')
    );
  }
  return new Promise<string | null>((resolve) => {
    enqueue!({ ...opts, input: opts.input ?? {}, resolve: (v) => resolve(typeof v === 'string' ? v : null) });
  });
}

export function ConfirmDialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    enqueue = (r) => {
      setReq(r);
      setValue(r.input?.initialValue ?? '');
      setError(null);
    };
    return () => { enqueue = null; };
  }, []);

  // Autofocus: the text input in prompt mode, otherwise the confirm button —
  // so Enter/Space immediately act on the focused control.
  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => {
      if (req.input) inputRef.current?.focus();
      else confirmBtnRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [req]);

  useEscapeKey(!!req, () => {
    if (!req) return;
    req.resolve(req.input ? null : false);
    setReq(null);
  });

  if (!req) return null;

  const finish = (v: boolean | string | null) => {
    req.resolve(v);
    setReq(null);
  };

  const handleConfirm = () => {
    if (req.input) {
      const v = value.trim();
      if (req.validate) {
        const err = req.validate(v);
        if (err) { setError(err); return; }
      }
      finish(v);
    } else {
      finish(true);
    }
  };

  return (
    // z-[60] — above page modals (z-50), confirmations can be triggered from
    // inside another dialog (e.g. Settings rows).
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-[60]"
      onMouseDown={() => finish(req.input ? null : false)}
    >
      <div
        className="panel w-[440px] max-w-[92vw]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="px-4 pt-4 flex items-start gap-2.5">
          {req.danger && <AlertTriangle size={16} className="text-status-deleted flex-shrink-0 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">{req.title}</h3>
            {req.message && (
              <div className="text-xs text-text-secondary mt-1.5 whitespace-pre-line leading-relaxed break-words">
                {req.message}
              </div>
            )}
            {req.input && (
              <input
                ref={inputRef}
                type="text"
                className="w-full mt-3 text-xs font-mono px-2 py-1.5 bg-bg-primary border border-border-default rounded focus:border-accent outline-none"
                placeholder={req.input.placeholder}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); }
                }}
              />
            )}
            {req.input?.hint && !error && (
              <div className="text-2xs text-text-tertiary mt-1">{req.input.hint}</div>
            )}
            {error && <div className="text-2xs text-status-error mt-1.5">{error}</div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3">
          {!req.hideCancel && (
            <button
              className="btn btn-secondary text-xs"
              onClick={() => finish(req.input ? null : false)}
            >
              {req.cancelLabel ?? t('common.cancel')}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            className={req.danger ? 'btn btn-danger text-xs' : 'btn btn-primary text-xs'}
            onClick={handleConfirm}
          >
            {req.confirmLabel ?? (req.input ? t('common.ok') : t('dialog.confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}
