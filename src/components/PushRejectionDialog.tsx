/**
 * PushRejectionDialog — the REMOTE-conflict reaction surface.
 *
 * Local conflicts (pull / merge / rebase / cherry-pick / stash / gitflow)
 * land in the Changes resolver via surfaceConflictedState. A REJECTED PUSH
 * leaves the repo clean — there is nothing to "resolve in Changes". The
 * conflict is local-vs-REMOTE branch state, and the reaction is a CHOICE:
 *
 *   non-fast-forward  → Стянуть и слить | Стянуть с rebase | Force push
 *   lease-stale       → Fetch и повторить | Force push
 *   protected         → Создать MR/PR (browser) | Копировать имя ветки
 *   policy            → explanation (Preferences → Commands)
 *
 * Pull recovery auto-RETRIES the push; if the pull itself conflicts, the
 * standard resolver takes over (dialog closes, #/changes opens) — the full
 * reaction chain stays uniform.
 *
 * Mounted ONCE in App.tsx; opened via offerPushRejection() from every
 * push catch site (Toolbar push/sync/Push-To, ChangesPage commit&push,
 * GitFlowDialog finish).
 */
import { useEffect, useState, useCallback } from 'react';
import { X, AlertTriangle, Loader, ArrowDown, ArrowUp, GitPullRequest, Copy, Sync, Lock, RefreshCw } from './icons';
import { usePushRejectionStore } from '../stores/pushRejectionStore';
import { useGitStore, surfaceConflictedState } from '../stores/gitStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { buildNewPullRequestUrl } from '../lib/pushFailures';
import { copyToClipboard } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { cn } from '../lib/utils';

export function PushRejectionDialog() {
  const ctx = usePushRejectionStore((s) => s.ctx);
  const close = usePushRejectionStore((s) => s.close);
  const { t } = useI18n();
  const toast = useToastActions();
  const currentBranch = useGitStore((s) => s.status?.current ?? null);
  const settings = useSettingsStore((s) => s.settings);

  const [busy, setBusy] = useState<null | 'pull' | 'fetch' | 'force'>(null);
  // Force-push policy verdict for THIS branch (hides the destructive
  // recovery when the local policy denies it — same gate as Push To…).
  const [forceAllowed, setForceAllowed] = useState(true);

  const kind = ctx?.failure.kind;
  const branch =
    ctx?.targetBranch || ctx?.branch || ctx?.failure.remoteBranch || currentBranch || '';
  // The remote-side branch is what the policy protects (push HEAD:main → 'main').
  const remoteSideBranch = ctx?.targetBranch || ctx?.failure.remoteBranch || ctx?.branch || branch;

  useEscapeKey(ctx != null && busy == null, close);

  useEffect(() => {
    if (!ctx || (kind !== 'non-fast-forward' && kind !== 'lease-stale')) {
      setForceAllowed(true);
      return;
    }
    if (typeof api.git?.isForcePushAllowed !== 'function') return;
    let cancelled = false;
    api.git
      .isForcePushAllowed(remoteSideBranch, settings?.forcePushPolicy ?? 'feature-only', settings?.protectedBranches)
      .then((v) => { if (!cancelled) setForceAllowed(!!v?.allowed); })
      .catch(() => { if (!cancelled) setForceAllowed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, kind, remoteSideBranch, settings?.forcePushPolicy, settings?.protectedBranches]);

  /** Pull (merge/rebase) → auto-retry the SAME push. A conflicted pull hands
   *  over to the Changes resolver (gitStore.pull's catch already surfaced
   *  it) — we just close. A second push rejection re-opens the dialog with
   *  the NEW failure (loop-safe: the user decides again). */
  const pullAndRetry = useCallback(async (strategy: 'merge' | 'rebase') => {
    if (!ctx) return;
    setBusy('pull');
    try {
      await useGitStore.getState().pull(ctx.repoPath, ctx.remote, ctx.branch, strategy);
      await useGitStore.getState().push(ctx.repoPath, ctx.remote, ctx.branch, undefined, ctx.force, ctx.targetBranch, ctx.forceMode);
      toast.success(t('dialogs.pushRejection.recovered'));
      close();
    } catch (e) {
      const again = String(e);
      // A NEW recoverable rejection → show it in place (the situation may
      // have changed — e.g. yet another concurrent push).
      if (/\(non-fast-forward\)|fetch first|stale info|protected branch|hook declined|force-push denied/i.test(again)) {
        const { open } = usePushRejectionStore.getState();
        open({
          ...ctx,
          failure: {
            kind: /stale info/i.test(again)
              ? 'lease-stale'
              : /protected|hook declined/i.test(again)
                ? 'protected'
                : /force-push denied/i.test(again)
                  ? 'policy'
                  : 'non-fast-forward',
            message: again.slice(0, 1600),
            remoteBranch: ctx.failure.remoteBranch,
          },
        });
        return;
      }
      // Anything else: if the repo became conflicted (pull merge conflict),
      // surfaceConflictedState in gitStore.pull's catch has ALREADY taken
      // the user to the resolver — just close silently.
      close();
      const conflicted = await surfaceConflictedState(ctx.repoPath);
      if (!conflicted) toast.error(t('shell.pushFailed'), String(e));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, close, toast, t]);

  /** lease-stale recovery: fetch refreshes the remote-tracking ref so the
   *  SAME --force-with-lease push passes (or fails with fresh information). */
  const fetchAndRetry = useCallback(async () => {
    if (!ctx) return;
    setBusy('fetch');
    try {
      await useGitStore.getState().fetch(ctx.repoPath, ctx.remote, true);
      await useGitStore.getState().push(ctx.repoPath, ctx.remote, ctx.branch, undefined, ctx.force ?? true, ctx.targetBranch, ctx.forceMode ?? 'lease');
      toast.success(t('dialogs.pushRejection.recovered'));
      close();
    } catch (e) {
      toast.error(t('shell.pushFailed'), String(e));
      close();
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, close, toast, t]);

  /** non-fast-forward / lease-stale destructive recovery: overwrite the
   *  remote with --force-with-lease (still refuses when it moved again). */
  const forcePush = useCallback(async () => {
    if (!ctx) return;
    setBusy('force');
    try {
      await useGitStore.getState().push(ctx.repoPath, ctx.remote, ctx.branch, undefined, true, ctx.targetBranch, 'lease');
      toast.success(t('dialogs.pushRejection.recovered'));
      close();
    } catch (e) {
      toast.error(t('shell.pushFailed'), String(e));
      close();
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, close, toast, t]);

  /** protected-branch recovery: open the provider's pre-filled new-MR/PR
   *  page in the browser (the server refuses direct pushes — the MR/PR is
   *  the sanctioned route for the change to land). */
  const createPullRequest = useCallback(async () => {
    if (!ctx) return;
    try {
      const info = await api.git.extractRepoInfo(ctx.repoPath);
      const url = buildNewPullRequestUrl(info.webUrl, info.provider, branch)
        ?? (info.webUrl || undefined);
      if (url) {
        api.app.openExternal(url);
        close();
      } else {
        toast.info(t('shell.noRemoteUrl'));
      }
    } catch (e) {
      toast.error(t('shell.openInBrowserFailed'), String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, branch, close, toast, t]);

  const copyBranch = useCallback(async () => {
    await copyToClipboard(branch);
    toast.success(t('dialogs.pushRejection.branchCopied'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, toast, t]);

  if (!ctx) return null;

  const titles: Record<string, { title: string; body: string; icon: typeof AlertTriangle }> = {
    'non-fast-forward': {
      title: t('dialogs.pushRejection.nonFFTitle'),
      body: t('dialogs.pushRejection.nonFFBody', { branch }),
      icon: ArrowDown,
    },
    'lease-stale': {
      title: t('dialogs.pushRejection.leaseTitle'),
      body: t('dialogs.pushRejection.leaseBody', { branch }),
      icon: Sync,
    },
    protected: {
      title: t('dialogs.pushRejection.protectedTitle'),
      body: t('dialogs.pushRejection.protectedBody', { branch }),
      icon: Lock,
    },
    policy: {
      title: t('dialogs.pushRejection.policyTitle'),
      body: t('dialogs.pushRejection.policyBody'),
      icon: Lock,
    },
  };
  const view = titles[kind ?? 'policy'] ?? titles.policy;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-fade-in"
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
            {view.title}
          </h3>
          <button className="icon-btn" onClick={close} disabled={busy != null}>
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 flex-1 min-h-0">
          {/* Explanation */}
          <div className="flex items-start gap-2 p-3 rounded border border-status-modified/40 bg-status-modified/10 text-sm">
            <view.icon size={16} className="text-status-modified shrink-0 mt-0.5" />
            <div>
              <div className="text-xs text-text-secondary whitespace-pre-line">{view.body}</div>
              {branch && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-2xs text-text-tertiary">{t('dialogs.pushRejection.branchLabel')}</span>
                  <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-bg-tertiary border border-border-subtle text-text-primary">{branch}</span>
                </div>
              )}
            </div>
          </div>

          {/* Raw git output — collapsible-looking details block (kept short) */}
          {ctx.failure.message && (
            <div className="mt-3">
              <div className="text-2xs text-text-tertiary mb-1">{t('dialogs.pushRejection.rawLabel')}</div>
              <pre className="max-h-32 overflow-auto text-2xs font-mono text-text-tertiary bg-bg-tertiary border border-border-subtle rounded px-2 py-1.5 whitespace-pre-wrap break-all">
                {ctx.failure.message}
              </pre>
            </div>
          )}
        </div>

        {/* Footer — per-kind recovery actions */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          {kind === 'non-fast-forward' && (
            <>
              <button
                className="btn btn-secondary text-xs flex items-center gap-1"
                onClick={() => void pullAndRetry('merge')}
                disabled={busy != null}
                title={t('dialogs.pushRejection.pullMergeHint')}
              >
                {busy === 'pull' ? <Loader size={12} className="animate-spin" /> : <ArrowDown size={12} />}
                {t('dialogs.pushRejection.pullAndMerge')}
              </button>
              <button
                className="btn btn-secondary text-xs flex items-center gap-1"
                onClick={() => void pullAndRetry('rebase')}
                disabled={busy != null}
                title={t('dialogs.pushRejection.pullRebaseHint')}
              >
                {busy === 'pull' ? <Loader size={12} className="animate-spin" /> : <ArrowDown size={12} />}
                {t('dialogs.pushRejection.pullAndRebase')}
              </button>
              {forceAllowed && (
                <button
                  className="btn btn-secondary text-xs flex items-center gap-1"
                  onClick={() => void forcePush()}
                  disabled={busy != null}
                  title={t('dialogs.pushRejection.forceHint')}
                >
                  {busy === 'force' ? <Loader size={12} className="animate-spin" /> : <ArrowUp size={12} />}
                  {t('dialogs.pushRejection.forceLease')}
                </button>
              )}
            </>
          )}
          {kind === 'lease-stale' && (
            <>
              <button
                className="btn btn-primary text-xs flex items-center gap-1"
                onClick={() => void fetchAndRetry()}
                disabled={busy != null}
                title={t('dialogs.pushRejection.fetchRetryHint')}
              >
                {busy === 'fetch' ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {t('dialogs.pushRejection.fetchAndRetry')}
              </button>
              {forceAllowed && (
                <button
                  className="btn btn-secondary text-xs flex items-center gap-1"
                  onClick={() => void forcePush()}
                  disabled={busy != null}
                  title={t('dialogs.pushRejection.forceHint')}
                >
                  {busy === 'force' ? <Loader size={12} className="animate-spin" /> : <ArrowUp size={12} />}
                  {t('dialogs.pushRejection.forceLease')}
                </button>
              )}
            </>
          )}
          {kind === 'protected' && (
            <>
              <button
                className="btn btn-secondary text-xs flex items-center gap-1"
                onClick={() => void copyBranch()}
              >
                <Copy size={12} />
                {t('dialogs.pushRejection.copyBranch')}
              </button>
              <button
                className="btn btn-primary text-xs flex items-center gap-1"
                onClick={() => void createPullRequest()}
                title={t('dialogs.pushRejection.createMrHint')}
              >
                <GitPullRequest size={12} />
                {t('dialogs.pushRejection.createMr')}
              </button>
            </>
          )}
          <button
            className={cn('btn text-xs', kind === 'non-fast-forward' || kind === 'lease-stale' ? 'btn-secondary' : 'btn-secondary')}
            onClick={close}
            disabled={busy != null}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
