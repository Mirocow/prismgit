import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader, Check, X, GitMerge } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore, surfaceConflictedState } from '../stores/gitStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

import { useEscapeKey } from '../hooks/useEscapeKey';
interface ApplyPatchModalProps {
  open: boolean;
  onClose: () => void;
}

type Mode = 'file' | 'paste';

/**
 * Apply Patch — wraps `git apply` with three common use cases:
 *  - apply a saved .diff/.patch file to the working tree
 *  - validate only (--check) without touching files
 *  - reverse-apply (--reverse) to undo a previously applied patch
 */
export function ApplyPatchModal({ open, onClose }: ApplyPatchModalProps) {
  useEscapeKey(open, onClose);
  const { t } = useI18n();
  const repo = useRepositoryStore((s) => s.currentRepo);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastActions();
  const [mode, setMode] = useState<Mode>('paste');
  const [patchFile, setPatchFile] = useState('');
  const [patchText, setPatchText] = useState('');
  const [checkOnly, setCheckOnly] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [index, setIndex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Conflict-reaction audit (v3.6): a patch that "does not apply" used to be
  // a dead end — raw error toast, modal closed, nothing to react to. Now the
  // failed run is remembered and a "Retry with 3-way merge" action is
  // offered: `git apply --3way` tolerates conflicts, writes conflict markers
  // into the files and the user resolves them in the Changes tool like every
  // other conflicted operation.
  const [lastRun, setLastRun] = useState<{ patch: string | string[]; options: string[] } | null>(null);
  const [retry3way, setRetry3way] = useState(false);

  // The backend's applyPatch detects raw unified-diff content (paste mode) and
  // writes it to a temp file itself; file mode passes the path straight through.
  const handleApply = useCallback(async () => {
    if (!repo) return;
    if (mode === 'file' && !patchFile.trim()) {
      toast.warning(t('dialogs.patchPathRequired'));
      return;
    }
    if (mode === 'paste' && !patchText.trim()) {
      toast.warning(t('dialogs.patchContentRequired'));
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      let patchArg: string | string[];
      if (mode === 'paste') {
        // Backend detects raw unified-diff content and writes it to a temp file itself
        patchArg = patchText;
      } else {
        patchArg = patchFile.trim();
      }
      const options: string[] = [];
      if (checkOnly) options.push('--check');
      if (reverse) options.push('--reverse');
      if (index) options.push('--index');
      setLastRun({ patch: patchArg, options });
      const output = await api.git.applyPatch(repo.path, patchArg, options);
      const msg = checkOnly
        ? t('dialogs.patchCheckPassed')
        : t('dialogs.patchApplied');
      toast.success(msg);
      setResult(output || msg);
      if (!checkOnly) await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      toast.error(t('dialogs.applyPatchFailed'), String(e));
      setResult(String(e));
      // "patch does not apply" / textual conflicts → offer the 3-way retry.
      // (Not for --check runs — a check result is not an applied state.)
      setRetry3way(!checkOnly && /does not apply|patch failed|conflict|already exists|error: /i.test(String(e)));
    } finally {
      setBusy(false);
    }
  }, [repo, mode, patchFile, patchText, checkOnly, reverse, index, toast, refreshStatus, onClose, t]);

  // Retry with `--3way`: conflicts become conflict markers in the working
  // tree (git exits 1 AFTER writing them) → the standard Changes-tool
  // resolver flow takes over via surfaceConflictedState.
  const handleRetry3way = useCallback(async () => {
    if (!repo || !lastRun) return;
    setBusy(true);
    try {
      await api.git.applyPatch(repo.path, lastRun.patch, [...lastRun.options, '--3way']);
      toast.success(t('dialogs.patchApplied'));
      setResult(t('dialogs.patchApplied'));
      await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      const conflicted = await surfaceConflictedState(repo.path, {
        title: t('dialogs.applyPatch3wayDone'),
        detail: t('dialogs.applyPatch3wayHint'),
      });
      if (!conflicted) toast.error(t('dialogs.applyPatchFailed'), String(e));
      setResult(String(e));
      onClose();
    } finally {
      setBusy(false);
      setRetry3way(false);
    }
  }, [repo, lastRun, toast, refreshStatus, onClose, t]);

  useEffect(() => {
    if (open) {
      setPatchFile('');
      setPatchText('');
      setCheckOnly(false);
      setReverse(false);
      setIndex(false);
      setResult(null);
      setMode('paste');
      setLastRun(null);
      setRetry3way(false);
    }
  }, [open]);

  if (!open) return null;
  if (!repo) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div className="panel w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-accent" />
            <h3 className="text-base font-medium">{t('dialogs.applyPatchTitle')}</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Mode switch */}
          <div className="flex bg-bg-tertiary rounded overflow-hidden border border-border-default w-fit">
            <button
              className={cn('px-3 py-1 text-xs transition-colors', mode === 'paste' ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
              onClick={() => setMode('paste')}
            >
              {t('dialogs.pastePatchTab')}
            </button>
            <button
              className={cn('px-3 py-1 text-xs transition-colors border-l border-border-default', mode === 'file' ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
              onClick={() => setMode('file')}
            >
              {t('dialogs.patchFileTab')}
            </button>
          </div>

          {mode === 'paste' ? (
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('dialogs.patchContentLabel')}</label>
              <textarea
                className="w-full h-48 text-xs font-mono resize-none"
                placeholder={'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n old\n-new\n+new'}
                value={patchText}
                autoFocus
                onChange={(e) => setPatchText(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('dialogs.patchPathLabel')}</label>
              <input
                type="text"
                className="w-full text-sm font-mono"
                placeholder="/path/to/fix.patch"
                value={patchFile}
                onChange={(e) => setPatchFile(e.target.value)}
              />
            </div>
          )}

          {/* Options */}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title={t('dialogs.checkTooltip')}>
              <input type="checkbox" checked={checkOnly} onChange={(e) => setCheckOnly(e.target.checked)} />
              {t('dialogs.checkOnly')}
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title={t('dialogs.reverseTooltip')}>
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              {t('dialogs.reverse')}
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title={t('dialogs.applyIndexTooltip')}>
              <input type="checkbox" checked={index} onChange={(e) => setIndex(e.target.checked)} />
              {t('dialogs.applyToIndex')}
            </label>
          </div>

          {result && (
            <pre className="text-2xs font-mono bg-bg-tertiary p-2 rounded whitespace-pre-wrap text-text-secondary max-h-32 overflow-auto">
              {result}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          {retry3way && (
            <button
              className="btn btn-secondary flex items-center gap-1"
              onClick={handleRetry3way}
              disabled={busy}
              title={t('dialogs.applyPatch3wayHint')}
            >
              <GitMerge size={12} />
              {t('dialogs.applyPatch3wayRetry')}
            </button>
          )}
          <button className="btn btn-primary" onClick={handleApply} disabled={busy}>
            {busy ? <Loader size={13} className="spin" /> : <Check size={13} />}
            {checkOnly ? t('dialogs.checkPatch') : t('dialogs.applyPatchButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
