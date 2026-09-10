import { useState, useEffect, useCallback, useRef } from 'react';
import { GitBranch, Loader, Check, X, SkipForward, RotateCcw, FileText, AlertTriangle, Search, RefreshCw } from '../components/icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn, shortHash } from '../lib/utils';

import { useEscapeKey } from '../hooks/useEscapeKey';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
interface BisectState {
  state: 'bisecting' | 'none';
  remaining?: number;
  rev?: string;
}

export function BisectPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [bisect, setBisect] = useState<BisectState>({ state: 'none' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Start form
  const [goodRef, setGoodRef] = useState('');
  const [badRef, setBadRef] = useState('HEAD');

  // Log dialog
  const [showLog, setShowLog] = useState(false);
  useEscapeKey(showLog, () => setShowLog(false));
  const [logText, setLogText] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.git.bisectStatus(repo.path);
      setBisect(result);
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
      toast.error(`Bisect ${name} failed`, String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleStart = () =>
    run('start', async () => {
      await api.git.bisectStart(repo.path);
      if (badRef.trim()) await api.git.bisectBad(repo.path, badRef.trim());
      if (goodRef.trim()) await api.git.bisectGood(repo.path, goodRef.trim());
      toast.success('Bisect started');
    });

  const handleGood = () =>
    run('good', async () => {
      await api.git.bisectGood(repo.path);
      toast.success('Marked GOOD — moving to next candidate');
    });

  const handleBad = () =>
    run('bad', async () => {
      await api.git.bisectBad(repo.path);
      toast.success('Marked BAD — moving to next candidate');
    });

  const handleSkip = () =>
    run('skip', async () => {
      await api.git.bisectSkip(repo.path);
      toast.info('Skipped — moving to next candidate');
    });

  const handleReset = async () => {
    if (!(await confirmDialog({
      title: 'Reset bisect',
      message: 'This ends the bisect session and returns HEAD to the original branch.',
      confirmLabel: 'Reset',
      danger: true,
    }))) return;
    run('reset', async () => {
      await api.git.bisectReset(repo.path);
      toast.success('Bisect reset');
    });
  };

  const handleShowLog = async () => {
    try {
      const log = await api.git.bisectLog(repo.path);
      setLogText(log);
      setShowLog(true);
    } catch (e) {
      toast.error('Failed to read bisect log', String(e));
    }
  };

  const bisecting = bisect.state === 'bisecting';

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Bisect</span>
          <span className={cn('badge', bisecting ? 'badge-modified' : 'badge-untracked')}>
            {bisecting ? 'BISECTING' : 'IDLE'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
          <button className="btn btn-secondary text-xs" onClick={handleShowLog} disabled={!bisecting}>
            <FileText size={12} />
            View Log
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
                <h3 className="text-sm font-medium">Binary search for the commit that introduced a bug</h3>
              </div>
              <p className="text-xs text-text-tertiary leading-relaxed">
                Bisect walks the commit graph between a <b>known-good</b> and a <b>known-bad</b> commit,
                checking out the middle commit each step. You test the current checkout and mark it
                good or bad — git narrows the range until the culprit is found (~log2(N) steps).
              </p>
            </div>
          )}

          {!bisecting ? (
            /* ===== Start card ===== */
            <div className="panel p-4 space-y-3">
              <h3 className="text-sm font-medium">Start Bisect</h3>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  Known BAD ref (where the bug exists)
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
                  Known GOOD ref (last version that worked)
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
                Start Bisect
              </button>
              {!goodRef.trim() && (
                <div className="text-2xs text-text-tertiary">
                  A known-good ref is required to bound the search range.
                </div>
              )}
            </div>
          ) : (
            /* ===== Active session card ===== */
            <>
              <div className="panel p-4 space-y-3 border-l-2 border-l-status-modified">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-status-modified" />
                  <h3 className="text-sm font-medium">Bisect in progress</h3>
                  {bisect.remaining !== undefined && (
                    <span className="badge badge-modified ml-auto">~{bisect.remaining} steps left</span>
                  )}
                </div>
                <div className="text-xs text-text-secondary flex items-center gap-2">
                  Current checkout:
                  {bisect.rev ? (
                    <code className="font-mono text-accent">{shortHash(bisect.rev)}</code>
                  ) : (
                    <span className="text-text-tertiary">—</span>
                  )}
                </div>
                <div className="text-xs text-text-tertiary">
                  Test the current checkout (build, run tests, ...), then mark the result:
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="btn text-xs hover:!bg-status-added hover:!text-white"
                    onClick={handleGood}
                    disabled={busy !== null}
                    title="This commit works — git bisect good"
                  >
                    {busy === 'good' ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                    Good
                  </button>
                  <button
                    className="btn text-xs hover:!bg-status-deleted hover:!text-white"
                    onClick={handleBad}
                    disabled={busy !== null}
                    title="This commit is broken — git bisect bad"
                  >
                    {busy === 'bad' ? <Loader size={12} className="animate-spin" /> : <X size={12} />}
                    Bad
                  </button>
                  <button
                    className="btn btn-secondary text-xs"
                    onClick={handleSkip}
                    disabled={busy !== null}
                    title="Cannot test this commit — git bisect skip"
                  >
                    {busy === 'skip' ? <Loader size={12} className="animate-spin" /> : <SkipForward size={12} />}
                    Skip
                  </button>
                  <div className="flex-1" />
                  <button
                    className="btn btn-secondary text-xs hover:!text-status-deleted"
                    onClick={handleReset}
                    disabled={busy !== null}
                    title="End the session and return to the original branch"
                  >
                    {busy === 'reset' ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Reset
                  </button>
                </div>
              </div>

              <div className="panel p-4 text-xs text-text-tertiary space-y-1">
                <div className="font-semibold text-text-secondary">When the culprit is found:</div>
                <div>
                  git prints <code className="text-accent">&lt;hash&gt; is the first bad commit</code> —
                  the hash also appears in the status bar. Use History → right-click →
                  <b> Reset to this commit</b> or create a fix branch from a good commit.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bisect log dialog */}
      {showLog && (
        <div
          className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowLog(false)}
        >
          <div className="panel w-[560px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium px-4 pt-4">Bisect Log</h3>
            <div className="px-4 py-2 text-2xs text-text-tertiary">
              Replay a session later with: git bisect replay &lt;file&gt;
            </div>
            <pre className="flex-1 overflow-auto mx-4 mb-3 text-2xs font-mono bg-bg-tertiary p-3 rounded whitespace-pre-wrap text-text-secondary">
              {logText || '(empty)'}
            </pre>
            <div className="flex justify-end px-4 pb-3">
              <button className="btn btn-secondary text-xs" onClick={() => setShowLog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
