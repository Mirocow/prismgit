/**
 * RemoteAuthDialog — the HTTP-authentication REACTION surface.
 *
 * The fourth pillar of the failure-reaction matrix:
 *   local conflicts   → surfaceConflictedState → Changes resolver
 *   rejected pushes   → offerPushRejection → PushRejectionDialog
 *   rejected TLS cert → offerSslBypass → SslBypassDialog
 *   server 401/no-creds → offerAuthBypass → THIS dialog
 *
 * A network operation failed because the server requires a login/password
 * and none were stored (git with GIT_TERMINAL_PROMPT=0:
 * «could not read Username … terminal prompts disabled»), or the stored
 * ones were rejected. The user needs the QUESTION, not a dead-end toast:
 *
 *   Username + Password/token → SAVED per repo+remote (remoteAuth settings
 *   map — password in the encrypted vault, never in .git/config or the
 *   remote URL; editable later in Repository Settings → Remotes) → the
 *   main-process credential cache is dropped → the ORIGINAL operation is
 *   retried automatically.
 *
 * Mounted ONCE in App.tsx; opened via offerAuthBypass() from every network
 * catch site (Toolbar pull/push/sync, ChangesPage, BranchesPage,
 * PullRequestsPage, GitFlowDialog, CommandPalette, CloneModal).
 */
import { useCallback, useEffect, useState } from 'react';
import { X, AlertTriangle, Loader, RefreshCw, User, KeyRound, Eye, EyeOff, Lock } from './icons';
import { useAuthBypassStore } from '../stores/authBypassStore';
import { useToastActions } from '../stores/toastStore';
import { getRemoteAuth, setRemoteAuth } from '../lib/remoteAuth';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import type { AuthFailureKind } from '../lib/authErrors';
import type { RemoteCredential } from '../../electron/types/settings-api';

/** Minimal remote shape the preselect logic needs. */
interface RemoteEntry {
  name: string;
  refs?: { fetch?: string; push?: string };
}

export function RemoteAuthDialog() {
  const ctx = useAuthBypassStore((s) => s.ctx);
  const close = useAuthBypassStore((s) => s.close);
  const { t } = useI18n();
  const toast = useToastActions();

  const [busy, setBusy] = useState(false);
  const [remotes, setRemotes] = useState<RemoteEntry[]>([]);
  const [remoteName, setRemoteName] = useState('origin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEscapeKey(ctx != null && !busy, close);

  // Load the repo's remotes + the stored credential of the preselected one.
  // CLONE contexts: the repo does not exist yet — api.git.remotes fails and
  // the fallback list is just the (future) 'origin' remote the clone will
  // create; credentials are then saved keyed by the TARGET path and the
  // retried clone picks them up from there.
  useEffect(() => {
    if (!ctx) {
      setRemotes([]);
      setRemoteName('origin');
      setUsername('');
      setPassword('');
      return;
    }
    let cancelled = false;
    const initial = ctx.remoteName ?? 'origin';
    setRemoteName(initial);
    // Prefill BOTH fields with the stored credential (masked) — what you
    // see is what gets saved; editing the password for a rejected login is
    // the primary flow, so the previous value must be right there.
    const stored = getRemoteAuth(ctx.repoPath, initial);
    setUsername(stored.username ?? '');
    setPassword(stored.password ?? '');
    api.git
      .remotes(ctx.repoPath)
      .then((rs: RemoteEntry[]) => {
        if (cancelled || rs.length === 0) return;
        setRemotes(rs);
        // Preselect: the remote the operation used; when unknown (default
        // remote call sites), match the remote whose URL points at the host
        // that failed — pull from a second remote of the same server picks
        // the right one automatically.
        const known = rs.some((r) => r.name === initial);
        if (!known && ctx.failure.host) {
          const byHost = rs.find(
            (r) =>
              hostOfUrl(r.refs?.fetch) === ctx.failure.host ||
              hostOfUrl(r.refs?.push) === ctx.failure.host
          );
          if (byHost) {
            setRemoteName(byHost.name);
            const cred = getRemoteAuth(ctx.repoPath, byHost.name);
            setUsername(cred.username ?? '');
            setPassword(cred.password ?? '');
          }
        }
      })
      .catch(() => {
        /* not a repo (clone context) or remotes unavailable — keep the
           initial remote name; the fallback picker shows just it. */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const changeRemote = useCallback(
    (name: string) => {
      setRemoteName(name);
      const cred = ctx ? getRemoteAuth(ctx.repoPath, name) : {};
      setUsername(cred.username ?? '');
      setPassword(cred.password ?? '');
    },
    [ctx]
  );

  /**
   * Primary action: (1) SAVE Username + Password/token per repo+remote in
   * the remoteAuth settings map (password → encrypted vault — the same
   * storage Repository Settings → Remotes edits), (2) drop the
   * main-process credential cache so the retry reads the FRESH credentials
   * immediately instead of the up-to-5 s stale map, (3) RETRY the original
   * operation. A retry that fails again surfaces as an error toast —
   * re-offering the dialog right away would be a dead loop; the user can
   * reopen it by clicking Pull/Push again (or fix the values in Repository
   * Settings → Remotes).
   */
  const saveAndRetry = useCallback(async () => {
    if (!ctx || busy) return;
    // What you see is what gets saved: the fields are prefilled with the
    // stored credential, so a username-only edit keeps the password shown
    // in the (masked) field, and CLEARED means cleared.
    const cred: RemoteCredential = { username: username.trim(), password };
    if (!cred.username && !cred.password) return;
    setBusy(true);
    try {
      setRemoteAuth(ctx.repoPath, remoteName, cred);
      try {
        await api.git.invalidateCache(ctx.repoPath);
      } catch {
        // Cache drop is best-effort — the 5 s TTL still expires on its own.
      }
      if (ctx.retry) {
        await ctx.retry(cred);
      } else {
        toast.success(t('dialogs.remoteAuth.savedNoRetry'));
      }
      close();
    } catch (e) {
      toast.error(t('dialogs.remoteAuth.retryFailed'), String(e));
      close();
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, remoteName, username, password, close, toast, t]);

  if (!ctx) return null;

  /**
   * Display refinement: git says «could not read Username» (no-credentials)
   * BOTH when nothing was stored AND when the STORED header came back 401
   * (git then re-prompts, prompts are disabled → same stderr). When the
   * preselected remote already has a saved credential, the actionable story
   * is "what we sent was rejected — fix it", so show that body instead.
   */
  const effectiveKind: AuthFailureKind =
    ctx.failure.kind === 'no-credentials' && !!(username.trim() || password)
      ? 'bad-credentials'
      : ctx.failure.kind;

  const bodies: Record<AuthFailureKind, string> = {
    'no-credentials': t('dialogs.remoteAuth.body.noCredentials', { host: ctx.failure.host ?? '' }),
    'bad-credentials': t('dialogs.remoteAuth.body.badCredentials', { host: ctx.failure.host ?? '' }),
    forbidden: t('dialogs.remoteAuth.body.forbidden', { host: ctx.failure.host ?? '' }),
    other: t('dialogs.remoteAuth.body.other', { host: ctx.failure.host ?? '' }),
  };

  const pickerRemotes = remotes.length > 0 ? remotes : [{ name: remoteName }];
  const canSave = busy || (!!username.trim() && !!password);

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50 animate-fade-in"
      onClick={busy ? undefined : close}
    >
      <div
        className="panel w-[520px] max-h-[85vh] flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <KeyRound size={16} className="text-status-modified" />
            {t('dialogs.remoteAuth.title')}
          </h3>
          <button className="icon-btn" onClick={close} disabled={busy}>
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 flex-1 min-h-0">
          {/* Explanation — kind-specific */}
          <div className="flex items-start gap-2 p-3 rounded border border-status-modified/40 bg-status-modified/10 text-sm">
            <AlertTriangle size={16} className="text-status-modified shrink-0 mt-0.5" />
            <div>
              <div className="text-xs text-text-secondary whitespace-pre-line">{bodies[effectiveKind]}</div>
              {ctx.failure.host && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-2xs text-text-tertiary">{t('dialogs.remoteAuth.hostLabel')}</span>
                  <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-subtle text-text-primary">
                    {ctx.failure.host}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* The question: which remote, which login, which password */}
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              {t('dialogs.remoteAuth.remoteLabel')}
              <select
                value={remoteName}
                onChange={(e) => changeRemote(e.target.value)}
                disabled={busy || remotes.length <= 1}
                className="w-full text-xs font-mono"
              >
                {pickerRemotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {r.refs?.fetch ? ` — ${r.refs.fetch}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              {t('dialogs.remoteAuth.usernameLabel')}
              <div className="relative">
                <User size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  className="w-full text-xs py-1.5 pl-7"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="user.name@corp"
                  autoFocus
                />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              {t('dialogs.remoteAuth.passwordLabel')}
              <div className="relative">
                <KeyRound size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  className="w-full text-xs py-1.5 pl-7 pr-8 font-mono"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 icon-btn !p-1"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={busy}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>
            </label>
          </div>

          {/* Storage consequence — what happens to the entered password */}
          <div className="flex items-start gap-2 p-3 mt-3 rounded border border-status-info/40 bg-status-info/10 text-xs text-text-secondary">
            <Lock size={14} className="text-status-info shrink-0 mt-0.5" />
            <span className="whitespace-pre-line">{t('dialogs.remoteAuth.securityNote')}</span>
          </div>

          {/* Raw git output — same details block as SslBypassDialog */}
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
            onClick={() => void saveAndRetry()}
            disabled={!canSave}
            title={t('dialogs.remoteAuth.applyHint')}
          >
            {busy ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('dialogs.remoteAuth.apply')}
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

/** Host of a remote URL (undefined for non-http(s) / unparseable). */
function hostOfUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
