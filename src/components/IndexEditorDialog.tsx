import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, RefreshCw, ArrowRight, ArrowLeft, Pencil, Save, Loader } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type StatusResult, type DiffHunk } from '../lib/api';
import { parseDiff } from '../lib/diffParser';
import { cn } from '../lib/utils';

/**
 * SmartGit "Index Editor" (Local | Index Editor): a three-pane view of
 * HEAD / Index / Working Tree for one file. Hunks and individual line
 * selections can be moved between the Index and the Working Tree, and the
 * Index/Working Tree contents can be edited directly (the HEAD pane is
 * read-only, exactly like SmartGit).
 */

interface PaneContent {
  text: string;
  error?: string;
}

type PaneKey = 'head' | 'index' | 'wt';

export function IndexEditorDialog({ filePath, onClose }: { filePath?: string | null; onClose: () => void }) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState<string>(filePath || '');
  const [head, setHead] = useState<PaneContent>({ text: '' });
  const [index, setIndex] = useState<PaneContent>({ text: '' });
  const [wt, setWt] = useState<PaneContent>({ text: '' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // line selection per editable pane (1-based, inclusive)
  const [sel, setSel] = useState<{ index: [number, number] | null; wt: [number, number] | null }>({ index: null, wt: null });
  // direct editing state
  const [editing, setEditing] = useState<Record<'index' | 'wt', boolean>>({ index: false, wt: false });
  const [draft, setDraft] = useState<{ index: string; wt: string }>({ index: '', wt: '' });
  const [unstagedHunks, setUnstagedHunks] = useState<DiffHunk[]>([]);
  const [stagedHunks, setStagedHunks] = useState<DiffHunk[]>([]);
  const lastClick = useRef<{ pane: 'index' | 'wt'; line: number } | null>(null);

  const loadFileList = useCallback(async () => {
    const status: StatusResult = await api.git.status(repo.path);
    const set = new Set<string>();
    for (const f of status.files) set.add(f.path);
    if (status.renamed) for (const r of status.renamed) set.add(r.to);
    const list = Array.from(set).sort();
    setFiles(list);
    setFile((cur) => (cur && list.includes(cur) ? cur : filePath && list.includes(filePath) ? filePath : list[0] ?? ''));
  }, [repo.path, filePath]);

  const loadPanes = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    try {
      const [headRes, idxRes, wtRes, unstagedRaw, stagedRaw] = await Promise.all([
        api.git.showFile(repo.path, 'HEAD', file).catch((e) => ({ text: '', error: String(e) })),
        api.git.showFile(repo.path, '', file).catch((e) => ({ text: '', error: String(e) })),
        api.fs.readFile(`${repo.path}/${file}`).catch(() => ({ text: '' })),
        api.git.raw(repo.path, ['diff', '-U3', '--no-color', '--', file]).catch(() => ''),
        api.git.raw(repo.path, ['diff', '--cached', '-U3', '--no-color', '--', file]).catch(() => ''),
      ]);
      const asPane = (r: unknown): PaneContent =>
        typeof r === 'object' && r !== null && 'text' in r
          ? { text: String((r as { text: string }).text ?? ''), error: (r as { error?: string }).error }
          : { text: String(r ?? '') };
      setHead(asPane(headRes));
      setIndex(asPane(idxRes));
      setWt(asPane(wtRes));
      setUnstagedHunks(parseDiff(String(unstagedRaw)).hunks);
      setStagedHunks(parseDiff(String(stagedRaw)).hunks);
      setSel({ index: null, wt: null });
      setEditing({ index: false, wt: false });
    } catch (e) {
      toast.error('Failed to load file versions', String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, file]);

  useEffect(() => { loadFileList(); }, [loadFileList]);
  useEffect(() => { loadPanes(); }, [loadPanes]);

  const lineCount = (t: string) => (t === '' ? 0 : t.split('\n').length);

  const handleLineClick = (pane: 'index' | 'wt', line: number, shift: boolean) => {
    if (shift && lastClick.current?.pane === pane) {
      const [a, b] = [lastClick.current.line, line].sort((x, y) => x - y);
      setSel((s) => ({ ...s, [pane]: [a, b] }));
    } else {
      lastClick.current = { pane, line };
      setSel((s) => ({ ...s, [pane]: [line, line] }));
    }
  };

  const stageSelection = async (pane: 'index' | 'wt') => {
    const range = sel[pane];
    if (!range || !file) return;
    setBusy(true);
    try {
      if (pane === 'wt') {
        // stage: unstaged diff ranges are in Working-Tree coordinates
        await api.git.stageLines(repo.path, file, [{ start: range[0], end: range[1] }]);
        toast.success(`Staged lines ${range[0]}–${range[1]} → Index`);
      } else {
        // unstage: staged diff ranges are in Index coordinates
        await api.git.unstageLines(repo.path, file, [{ start: range[0], end: range[1] }]);
        toast.success(`Unstaged lines ${range[0]}–${range[1]} → Working Tree`);
      }
      await loadPanes();
    } catch (e) {
      toast.error('Partial staging failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const stageHunk = async (hunk: DiffHunk, direction: 'stage' | 'unstage') => {
    setBusy(true);
    try {
      if (direction === 'stage') {
        // For a pure addition hunk at the end of the WT diff, the range in WT
        // coordinates is [newStart .. newStart+newLines-1]
        const start = hunk.newStart;
        const end = hunk.newStart + Math.max(hunk.newLines, 0) - 1;
        const ranges = end >= start ? [{ start, end }] : [];
        // Mixed/replace hunks: stage the whole hunk span (context included —
        // stageLines filters pure hunks by range overlap)
        await api.git.stageLines(repo.path, file, ranges.length ? ranges : [{ start: hunk.newStart, end: hunk.newStart }]);
        toast.success('Hunk staged → Index');
      } else {
        const start = hunk.newStart;
        const end = hunk.newStart + Math.max(hunk.newLines, 0) - 1;
        await api.git.unstageLines(repo.path, file, [{ start, end }]);
        toast.success('Hunk unstaged → Working Tree');
      }
      await loadPanes();
    } catch (e) {
      toast.error('Hunk operation failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePane = async (pane: 'index' | 'wt') => {
    setBusy(true);
    try {
      if (pane === 'index') {
        await api.git.setIndexContent(repo.path, file, draft.index);
        toast.success('Index content saved');
      } else {
        await api.fs.writeFile(`${repo.path}/${file}`, draft.wt);
        toast.success('Working Tree file saved');
      }
      setEditing((e) => ({ ...e, [pane]: false }));
      await loadPanes();
    } catch (e) {
      toast.error('Save failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const revertPaneToHead = async (pane: 'index' | 'wt') => {
    setBusy(true);
    try {
      if (pane === 'wt') {
        await api.git.checkoutFile(repo.path, file, 'HEAD');
        toast.success('Working Tree restored from HEAD');
      } else {
        await api.git.setIndexContent(repo.path, file, head.text);
        toast.success('Index restored from HEAD');
      }
      await loadPanes();
    } catch (e) {
      toast.error('Restore failed', String(e));
    } finally {
      setBusy(false);
    }
  };

  const paneDefs = useMemo(() => ([
    { key: 'head' as const, title: 'Repository (HEAD)', content: head, readOnly: true, hint: 'read-only' },
    { key: 'index' as const, title: 'Index', content: index, readOnly: false, hint: 'editable · staged' },
    { key: 'wt' as const, title: 'Working Tree', content: wt, readOnly: false, hint: 'editable' },
  ]), [head, index, wt]);

  const renderPane = (pane: (typeof paneDefs)[number]) => {
    const text = editing[pane.key as 'index' | 'wt'] ? draft[pane.key as 'index' | 'wt'] : pane.content.text;
    const lines = text === '' ? [] : text.split('\n');
    const isEditing = !pane.readOnly && editing[pane.key as 'index' | 'wt'];
    const selRange = sel[pane.key as 'index' | 'wt'];
    const hunksForPane = pane.key === 'wt' ? unstagedHunks : pane.key === 'index' ? stagedHunks : [];
    return (
      <div key={pane.key} className="flex-1 flex flex-col min-w-0 border-r border-border last:border-r-0">
        {/* Pane header */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-surface/60">
          <span className="text-xs font-semibold truncate">{pane.title}</span>
          <span className="text-2xs text-text-tertiary">{pane.readOnly ? pane.hint : `${lineCount(pane.content.text)} lines`}</span>
          <div className="flex-1" />
          {!pane.readOnly && (
            <>
              {isEditing ? (
                <button
                  onClick={() => savePane(pane.key as 'index' | 'wt')}
                  disabled={busy}
                  className="p-1 rounded hover:bg-surface-hover text-green-500"
                  title="Save this pane's content"
                >
                  {busy ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setDraft((d) => ({ ...d, [pane.key]: pane.content.text }));
                    setEditing((e) => ({ ...e, [pane.key]: true }));
                  }}
                  className="p-1 rounded hover:bg-surface-hover text-text-secondary"
                  title="Edit this pane's content directly"
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                onClick={() => revertPaneToHead(pane.key as 'index' | 'wt')}
                disabled={busy}
                className="p-1 rounded hover:bg-surface-hover text-text-secondary"
                title="Restore this pane from HEAD"
              >
                <RefreshCw size={13} />
              </button>
            </>
          )}
        </div>
        {/* Hunk chips */}
        {hunksForPane.length > 0 && !isEditing && (
          <div className="flex flex-wrap gap-1 px-2 py-1 border-b border-border bg-surface/30">
            {hunksForPane.slice(0, 12).map((h, i) => (
              <button
                key={i}
                onClick={() => stageHunk(h, pane.key === 'wt' ? 'stage' : 'unstage')}
                disabled={busy}
                className={cn(
                  'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-2xs border',
                  pane.key === 'wt'
                    ? 'border-green-500/40 text-green-500 hover:bg-green-500/10'
                    : 'border-blue-500/40 text-blue-400 hover:bg-blue-500/10'
                )}
                title={pane.key === 'wt' ? 'Stage this hunk → Index' : 'Unstage this hunk → Working Tree'}
              >
                {pane.key === 'wt' ? <ArrowRight size={10} /> : <ArrowLeft size={10} />}
                @{h.newStart}
              </button>
            ))}
          </div>
        )}
        {/* Selection actions */}
        {!pane.readOnly && selRange && !isEditing && (
          <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-accent/10">
            <span className="text-2xs">Lines {selRange[0]}–{selRange[1]} selected</span>
            <button
              onClick={() => stageSelection(pane.key as 'index' | 'wt')}
              disabled={busy}
              className="px-1.5 py-0.5 rounded text-2xs bg-accent text-accent-foreground hover:opacity-90"
            >
              {pane.key === 'wt' ? 'Stage selected → Index' : 'Unstage selected → Working Tree'}
            </button>
            <button onClick={() => setSel((s) => ({ ...s, [pane.key]: null }))} className="text-2xs text-text-tertiary hover:text-text-primary">
              clear
            </button>
          </div>
        )}
        {/* Content */}
        <div className="flex-1 overflow-auto mono text-2xs leading-[1.45]">
          {pane.content.error && !pane.readOnly ? (
            <div className="p-2 text-text-tertiary italic">{pane.key === 'index' ? '(not in index — file is new)' : pane.content.error}</div>
          ) : isEditing ? (
            <textarea
              value={draft[pane.key as 'index' | 'wt']}
              onChange={(e) => setDraft((d) => ({ ...d, [pane.key]: e.target.value }))}
              spellCheck={false}
              className="w-full h-full min-h-[200px] p-2 bg-surface focus:outline-none resize-none"
            />
          ) : (
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((ln, i) => {
                  const lineNo = i + 1;
                  const selected = selRange && lineNo >= selRange[0] && lineNo <= selRange[1];
                  return (
                    <tr
                      key={i}
                      className={cn(selected && 'bg-accent/20')}
                      onClick={(e) => !pane.readOnly && handleLineClick(pane.key as 'index' | 'wt', lineNo, e.shiftKey)}
                    >
                      <td className="select-none text-right pr-2 pl-2 text-text-tertiary/60 w-10 align-top">{lineNo}</td>
                      <td className="whitespace-pre align-top pr-2">{ln || ' '}</td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr><td className="p-2 text-text-tertiary italic" colSpan={2}>(empty)</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="panel w-full max-w-6xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dialog header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="text-sm font-semibold">Index Editor</span>
          <select
            value={file}
            onChange={(e) => setFile(e.target.value)}
            className="flex-1 max-w-md px-2 py-1 text-xs mono bg-surface border border-border rounded focus:outline-none focus:border-accent"
          >
            {files.length === 0 && <option value="">(no changed files)</option>}
            {files.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <span className="text-2xs text-text-tertiary hidden md:block">
            Click a line to select · Shift+click for a range · arrows stage/unstage hunks
          </span>
          <div className="flex-1" />
          <button onClick={loadPanes} className="p-1.5 rounded hover:bg-surface-hover" title="Reload (F5)">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-hover" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>
        {/* 3 panes */}
        <div className="flex flex-1 overflow-hidden">
          {paneDefs.map(renderPane)}
        </div>
      </div>
    </div>
  );
}
