/**
 * SslBypassDialog — the TLS-certificate REACTION surface.
 *
 * The third pillar of the failure-reaction matrix:
 *   local conflicts   → surfaceConflictedState → Changes resolver
 *   rejected pushes   → offerPushRejection → PushRejectionDialog
 *   rejected TLS cert → offerSslBypass → THIS dialog
 *
 * A network operation failed because git rejected the server's certificate
 * (expired — the reported case, self-signed, unknown CA, hostname
 * mismatch). The user needs a CHOICE, not a dead-end toast:
 *
 *   «Продолжить без проверки сертификата» → http.sslVerify=false in THIS
 *   repo's local config (the SmartGit/GitKraken-sanctioned workaround:
 *   traffic stays TLS-encrypted, the trust check is dropped for this one
 *   repo) + the host joins insecureSslHosts so provider API requests to the
 *   same server (MR lists, avatars) also stop failing + the ORIGINAL
 *   operation is retried automatically.
 *
 * Mounted ONCE in App.tsx; opened via offerSslBypass() from every network
 * catch site (Toolbar pull/push/sync, ChangesPage, BranchesPage,
 * PullRequestsPage, GitFlowDialog, CommandPalette).
 */
import { useCallback, useEffect, useState } from 'react';
import { X, AlertTriangle, Loader, Lock, RefreshCw } from './icons';
import { useSslBypassStore } from '../stores/sslBypassStore';
import { useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { SslFailureKind } from '../lib/sslErrors';

export function SslBypassDialog() {
  const ctx = useSslBypassStore((s) => s.ctx);
  const close = useSslBypassStore((s) => s.close);
  const { t } = useI18n();
  const toast = useToastActions();

  const [busy, setBusy] = useState(false);
  /** Effective http.sslVerify of the repo ('false' → already bypassed). */
  const [alreadyOff, setAlreadyOff] = useState(false);

  useEscapeKey(ctx != null && !busy, close);

  // Read the repo's current verification state so the dialog can say
  // "already disabled" instead of offering a no-op fix. CLONE contexts skip
  // the probe — the target repo does not exist yet.
  useEffect(() => {
    if (!ctx || ctx.skipConfigWrite) {
      setAlreadyOff(false);
      return;
    }
    let cancelled = false;
    api.git
      .configGetMany(ctx.repoPath, ['http.sslVerify'])
      .then((values) => {
        if (!cancelled) setAlreadyOff(values?.['http.sslVerify'] === 'false');
      })
      .catch(() => {
        if (!cancelled) setAlreadyOff(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  /**
   * Primary action: (1) http.sslVerify=false for THIS repo (CLONE contexts
   * skip the write — the retry carries `-c http.sslVerify=false`, which git
   * itself persists into the new repo's config), (2) register the host for
   * API-level bypass, (3) RETRY the original operation. A retry that fails
   * for a NON-certificate reason surfaces as an error toast — the failure is
   * real and verification is already off, so re-offering the dialog would be
   * a dead loop, not a reaction.
   */
  const applyBypassAndRetry = useCallback(async () => {
    if (!ctx || busy) return;
    setBusy(true);
    try {
      if (!ctx.skipConfigWrite) {
        await api.git.configSetMany(ctx.repoPath, [{ key: 'http.sslVerify', value: 'false' }]);
      }
      if (ctx.failure.host) {
        try {
          // Dedicated channel — keeps the main-process host cache in sync
          // immediately (a plain settings:set would leave a stale cache
          // until app restart, and the very next MR-list request would
          // still die on the same certificate).
          await api.settings.addInsecureSslHost(ctx.failure.host);
        } catch {
          // Host registration is a best-effort EXTRA — git operations work
          // without it; only provider API calls stay strict.
        }
      }
      if (ctx.retry) {
        await ctx.retry();
      } else {
        toast.success(t('dialogs.ssl.bypassApplied'));
      }
      close();
    } catch (e) {
      toast.error(t('dialogs.ssl.retryFailed'), String(e));
      close();
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, close, toast, t]);

  if (!ctx) return null;

  const bodies: Record<SslFailureKind, string> = {
    expired: t('dialogs.ssl.body.expired', { host: ctx.failure.host ?? '' }),
    'not-yet-valid': t('dialogs.ssl.body.notYetValid', { host: ctx.failure.host ?? '' }),
    'self-signed': t('dialogs.ssl.body.selfSigned', { host: ctx.failure.host ?? '' }),
    untrusted: t('dialogs.ssl.body.untrusted', { host: ctx.failure.host ?? '' }),
    hostname: t('dialogs.ssl.body.hostname', { host: ctx.failure.host ?? '' }),
    revoked: t('dialogs.ssl.body.revoked', { host: ctx.failure.host ?? '' }),
    other: t('dialogs.ssl.body.other', { host: ctx.failure.host ?? '' }),
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50 animate-fade-in"
      onClick={busy ? undefined : close}
    >
      <div
        className="panel w-[560px] max-h-[85vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <AlertTriangle size={16} className="text-status-modified" />
            {t('dialogs.ssl.title')}
          </h3>
          <button className="icon-btn" onClick={close} disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 flex-1 min-h-0">
          {/* Explanation — kind-specific */}
          <div className="flex items-start gap-2 p-3 rounded border border-status-modified/40 bg-status-modified/10 text-sm">
            <Lock size={16} className="text-status-modified shrink-0 mt-0.5" />
            <div>
              <div className="text-xs text-text-secondary whitespace-pre-line">{bodies[ctx.failure.kind]}</div>
              {ctx.failure.host && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-2xs text-text-tertiary">{t('dialogs.ssl.hostLabel')}</span>
                  <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-subtle text-text-primary">
                    {ctx.failure.host}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Security consequence — the user must understand what "continue"
              trades away before clicking the primary button. */}
          <div className="flex items-start gap-2 p-3 mt-3 rounded border border-status-warning/40 bg-status-warning/10 text-xs text-text-secondary">
            <AlertTriangle size={14} className="text-status-warning shrink-0 mt-0.5" />
            <span className="whitespace-pre-line">{t('dialogs.ssl.warning')}</span>
          </div>

          {alreadyOff && (
            <div className="mt-3 text-xs text-status-warning">
              {t('dialogs.ssl.alreadyOff')}
            </div>
          )}

          {/* Raw git output — same details block as PushRejectionDialog */}
          {ctx.failure.message && (
            <div className="mt-3">
              <div className="text-2xs text-text-tertiary mb-1">{t('dialogs.pushRejection.rawLabel')}</div>
              <pre className="max-h-32 overflow-auto text-2xs font-mono text-text-tertiary bg-bg-tertiary border border-border-subtle rounded px-2 py-1.5 whitespace-pre-wrap break-all">
                {ctx.failure.message}
              </pre>
            </div>
          )}
        </div>

        {/* Footer — the reaction */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button
            className="btn btn-primary text-xs flex items-center gap-1"
            onClick={() => void applyBypassAndRetry()}
            disabled={busy}
            title={t('dialogs.ssl.applyHint')}
          >
            {busy ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('dialogs.ssl.apply')}
          </button>
          <button
            className="btn btn-secondary text-xs"
            onClick={close}
            disabled={busy}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
