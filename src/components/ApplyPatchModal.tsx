import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader, Check, X } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

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
  const repo = useRepositoryStore((s) => s.currentRepo);
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const toast = useToastStore();
  const [mode, setMode] = useState<Mode>('paste');
  const [patchFile, setPatchFile] = useState('');
  const [patchText, setPatchText] = useState('');
  const [checkOnly, setCheckOnly] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [index, setIndex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // The backend's applyPatch detects raw unified-diff content (paste mode) and
  // writes it to a temp file itself; file mode passes the path straight through.
  const handleApply = useCallback(async () => {
    if (!repo) return;
    if (mode === 'file' && !patchFile.trim()) {
      toast.warning('Patch file path is required');
      return;
    }
    if (mode === 'paste' && !patchText.trim()) {
      toast.warning('Patch content is required');
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
      const output = await api.git.applyPatch(repo.path, patchArg, options);
      const msg = checkOnly
        ? 'Patch applies cleanly (--check passed)'
        : 'Patch applied successfully';
      toast.success(msg);
      setResult(output || msg);
      if (!checkOnly) await refreshStatus(repo.path);
      onClose();
    } catch (e) {
      toast.error('Apply patch failed', String(e));
      setResult(String(e));
    } finally {
      setBusy(false);
    }
  }, [repo, mode, patchFile, patchText, checkOnly, reverse, index, toast, refreshStatus, onClose]);

  useEffect(() => {
    if (open) {
      setPatchFile('');
      setPatchText('');
      setCheckOnly(false);
      setReverse(false);
      setIndex(false);
      setResult(null);
      setMode('paste');
    }
  }, [open]);

  if (!open) return null;
  if (!repo) return null;

  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div className="panel w-[640px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-accent" />
            <h3 className="text-base font-medium">Apply Patch</h3>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Mode switch */}
          <div className="flex bg-bg-tertiary rounded overflow-hidden border border-border-default w-fit">
            <button
              className={cn('px-3 py-1 text-xs transition-colors', mode === 'paste' ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
              onClick={() => setMode('paste')}
            >
              Paste patch
            </button>
            <button
              className={cn('px-3 py-1 text-xs transition-colors border-l border-border-default', mode === 'file' ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
              onClick={() => setMode('file')}
            >
              Patch file
            </button>
          </div>

          {mode === 'paste' ? (
            <div>
              <label className="text-xs text-text-tertiary block mb-1">Patch content (unified diff)</label>
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
              <label className="text-xs text-text-tertiary block mb-1">Path to .diff/.patch file</label>
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
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="git apply --check — validate without applying">
              <input type="checkbox" checked={checkOnly} onChange={(e) => setCheckOnly(e.target.checked)} />
              Check only (--check)
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="git apply --reverse — undo the patch">
              <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
              Reverse (--reverse)
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" title="git apply --index — apply to the working tree AND the index (stages the result)">
              <input type="checkbox" checked={index} onChange={(e) => setIndex(e.target.checked)} />
              Apply to index (--index)
            </label>
          </div>

          {result && (
            <pre className="text-2xs font-mono bg-bg-tertiary p-2 rounded whitespace-pre-wrap text-text-secondary max-h-32 overflow-auto">
              {result}
            </pre>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleApply} disabled={busy}>
            {busy ? <Loader size={13} className="spin" /> : <Check size={13} />}
            {checkOnly ? 'Check Patch' : 'Apply Patch'}
          </button>
        </div>
      </div>
    </div>
  );
}
