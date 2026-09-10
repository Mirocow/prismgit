import { useState, useEffect, useCallback, useRef } from 'react';
import { GitBranch, Loader, Check, X, SkipForward, RotateCcw, FileText, AlertTriangle, Search, RefreshCw } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import { api } from '../lib/api';
import { cn, shortHash } from '../lib/utils';
import { useI18n } from '../lib/i18n';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
interface BisectState {
  state: 'bisecting' | 'none';
  remaining?: number;
  rev?: string;
}

export function BisectPage() {
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const [bisect, setBisect] = useState<BisectState>({ state: 'none' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Start form — prefill the BAD ref from the commit selected in History or
  // another tool (global selection drives every input across the app).
  const [goodRef, setGoodRef] = useState('');
  const [badRef, setBadRef] = useState(selectedCommitHash ?? 'HEAD');

  // Log dialog
  const [showLog, setShowLog] = useState(false);
  useEscapeKey(showLog, () => setShowLog(false));
  const [logText, setLogText] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.git.bisectStatus(repo.path);
      setBisect(result);
      // Feed the current bisect checkout into the global selection so the
      // commit is visible in the Toolbar chip, History, Diff, Notes, etc.
      if (result.state === 'bisecting' && result.rev) {
        const sel = useSelectionStore.getState().selectedCommitHash;
        if (sel !== result.rev) useSelectionStore.getState().selectCommit(result.rev);
      }
    } catch {
      setBisect({ state: 'none' });
    }
  }, [repo.path]);

  useEffect(() => {
    load();
    // Poll while on the page: bisect steps change HEAD asynchronously
    pollRef.current = setInterval(load, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
      await load();
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error(t('pages.bisectActionFailed', { name }), String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleStart = () =>
    run('start', async () => {
      await api.git.bisectStart(repo.path);
      if (badRef.trim()) await api.git.bisectBad(repo.path, badRef.trim());
      if (goodRef.trim()) await api.git.bisectGood(repo.path, goodRef.trim());
      toast.success(t('pages.bisectStarted'));
    });

  const handleGood = () =>
    run('good', async () => {
      await api.git.bisectGood(repo.path);
      toast.success(t('pages.bisectMarkedGood'));
    });

  const handleBad = () =>
    run('bad', async () => {
      await api.git.bisectBad(repo.path);
      toast.success(t('pages.bisectMarkedBad'));
    });

  const handleSkip = () =>
    run('skip', async () => {
      await api.git.bisectSkip(repo.path);
      toast.info(t('pages.bisectSkipped'));
    });

  const handleReset = async () => {
    if (!(await confirmDialog({
      title: t('pages.bisectResetConfirmTitle'),
      message: t('pages.bisectResetMessage'),
      confirmLabel: t('pages.reset'),
      danger: true,
    }))) return;
    run('reset', async () => {
      await api.git.bisectReset(repo.path);
      toast.success(t('pages.bisectResetDone'));
    });
  };

  const handleShowLog = async () => {
    try {
      const log = await api.git.bisectLog(repo.path);
      setLogText(log);
      setShowLog(true);
    } catch (e) {
      toast.error(t('pages.bisectLogFailed'), String(e));
    }
  };

  const bisecting = bisect.state === 'bisecting';
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('nav.bisect')}</span>
          <span className={cn('badge', bisecting ? 'badge-modified' : 'badge-untracked')}>
            {bisecting ? t('pages.bisectStateBisecting') : t('pages.bisectStateIdle')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title={t('common.refresh')} onClick={load}>
            <RefreshCw size={13} />
          </button>
          {/* View Log works even when idle: git returns "We are not bisecting"
              and the service turns it into an empty log — the dialog then
              explains how to start a session instead of doing nothing. */}
          <button className="btn btn-secondary text-xs" onClick={handleShowLog}>
            <FileText size={12} />
            {t('pages.bisectViewLog')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* How it works */}
          {!bisecting && (
            <div className="panel p-4">
              <div className="flex items-center gap-2 mb-2">
                <Search size={15} className="text-accent" />
                <h3 className="text-sm font-medium">{t('pages.bisectHowTitle')}</h3>
              </div>
              <p className="text-xs text-text-tertiary leading-relaxed">
                {t('pages.bisectHowPre')} <b>{t('pages.bisectHowGood')}</b> {t('pages.bisectHowMid')}{' '}<b>{t('pages.bisectHowBad')}</b> {t('pages.bisectHowPost')}
              </p>
            </div>
          )}

          {!bisecting ? (
            /* ===== Start card ===== */
            <div className="panel p-4 space-y-3">
              <h3 className="text-sm font-medium">{t('pages.bisectStart')}</h3>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  {t('pages.bisectBadRefLabel')}
                </label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="HEAD"
                  value={badRef}
                  onChange={(e) => setBadRef(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  {t('pages.bisectGoodRefLabel')}
                </label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="e.g. v1.0.0, main~10, a1b2c3d"
                  value={goodRef}
                  onChange={(e) => setGoodRef(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary text-xs"
                onClick={handleStart}
                disabled={busy !== null || !goodRef.trim()}
                title="git bisect start + mark bad/good refs"
              >
                {busy === 'start' ? <Loader size={12} className="animate-spin" /> : <GitBranch size={12} />}
                {t('pages.bisectStart')}
              </button>
              {!goodRef.trim() && (
                <div className="text-2xs text-text-tertiary">
                  {t('pages.bisectGoodRequired')}
                </div>
              )}
            </div>
          ) : (
            /* ===== Active session card ===== */
            <>
              <div className="panel p-4 space-y-3 border-l-2 border-l-status-modified">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-status-modified" />
                  <h3 className="text-sm font-medium">{t('pages.bisectInProgress')}</h3>
                  {bisect.remaining !== undefined && (
                    <span className="badge badge-modified ml-auto">{t('pages.bisectStepsLeft', { count: bisect.remaining })}</span>
                  )}
                </div>
                <div className="text-xs text-text-secondary flex items-center gap-2">
                  {t('pages.bisectCurrentCheckout')}
                  {bisect.rev ? (
                    <code
                      className="font-mono text-accent cursor-pointer hover:underline"
                      title={t('pages.selectCommitHintFull')}
                      onClick={() => {
                        useSelectionStore.getState().selectCommit(bisect.rev!);
                        window.location.hash = '#/history';
                      }}
                    >
                      {shortHash(bisect.rev)}
                    </code>
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </div>
                <div className="text-xs text-text-tertiary">
                  {t('pages.bisectTestHint')}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="btn text-xs hover:!bg-status-added hover:!text-white"
                    onClick={handleGood}
                    disabled={busy !== null}
                    title={t('pages.bisectGoodTitle')}
                  >
                    {busy === 'good' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                    {t('pages.bisectGood')}
                  </button>
                  <button
                    className="btn text-xs hover:!bg-status-deleted hover:!text-white"
                    onClick={handleBad}
                    disabled={busy !== null}
                    title={t('pages.bisectBadTitle')}
                  >
                    {busy === 'bad' ? <Loader size={12} className="animate-spin" /> : <X size={12} />}
                    {t('pages.bisectBad')}
                  </button>
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={handleSkip}
                    disabled={busy !== null}
                    title={t('pages.bisectSkipTitle')}
                  >
                    {busy === 'skip' ? <Loader size={12} className="animate-spin" /> : <SkipForward size={12} />}
                    {t('pages.bisectSkip')}
                  </button>
                  <div className="flex-1" />
                  <button
                    className="btn btn-secondary text-xs hover:!text-status-deleted"
                    onClick={handleReset}
                    disabled={busy !== null}
                    title={t('pages.bisectResetButtonTitle')}
                  >
                    {busy === 'reset' ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    {t('pages.reset')}
                  </button>
                </div>
              </div>

              <div className="panel p-4 text-xs text-text-tertiary space-y-1">
                <div className="font-semibold text-text-secondary">{t('pages.bisectCulpritTitle')}</div>
                <div>
                  {t('pages.bisectCulpritPre')}{' '}<code className="text-accent">&lt;hash&gt; is the first bad commit</code>{' '}
                  {t('pages.bisectCulpritPost')}{' '}
                  <b>{t('history.resetToCommit')}</b> {t('pages.bisectCulpritPost2')}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bisect log dialog */}
      {showLog && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
          onClick={() => setShowLog(false)}
        >
          <div className="panel w-[560px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium px-4 pt-4">{t('pages.bisectLogTitle')}</h3>
            <div className="px-4 py-2 text-2xs text-text-tertiary">
              {logText
                ? t('pages.bisectLogReplayHint')
                : t('pages.bisectLogEmpty')}
            </div>
            <pre className="flex-1 overflow-auto mx-4 mb-3 text-2xs font-mono bg-bg-tertiary p-3 rounded whitespace-pre-wrap text-text-secondary">
              {logText || t('pages.bisectLogNone')}
            </pre>
            <div className="flex justify-end px-4 pb-3">
              <button className="btn btn-secondary text-xs" onClick={() => setShowLog(false)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
