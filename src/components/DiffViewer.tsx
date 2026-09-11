import { useState, useMemo, useCallback, useRef } from 'react';
import { type DiffResult, type DiffHunk, type DiffLine } from '../lib/api';
import { api } from '../lib/api';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { cn } from '../lib/utils';
import { RefreshCw, Copy, ChevronDown, ChevronRight, Download, Loader } from './icons';
import { wordDiff, type WordSegment } from '../lib/wordDiff';
import { useI18n } from '../lib/i18n';

interface DiffViewerProps {
  diff: DiffResult | null;
  loading?: boolean;
  repoPath?: string;
  filePath?: string;
  /** Which diff is being displayed: unstaged (index→worktree, stageable), staged (HEAD→index, unstageable) or commit (read-only). */
  mode?: 'unstaged' | 'staged' | 'commit';
  /** Called after partial staging/unstaging so the parent can refresh the status. */
  onStaged?: () => void;
  /** SmartGit Manual: Force Compare callback — when provided, a "Force Compare" button
   * appears for files exceeding the maxFileSize threshold. The parent should call
   * api.git.forceCompare(...) and pass the result back as the new `diff` prop. */
  onForceCompare?: () => void;
}

type ViewMode = 'unified' | 'split';
type WhitespaceMode = 'normal' | 'ignore-all' | 'ignore-trailing';

// Minimal syntax highlighting for common languages
const KEYWORDS: Record<string, string[]> = {
  ts: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'import', 'export', 'from', 'default', 'extends', 'implements', 'public', 'private', 'protected', 'readonly', 'static', 'async', 'await', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield', 'this', 'super', 'null', 'undefined', 'true', 'false'],
  js: ['const', 'let', 'var', 'function', 'class', 'import', 'export', 'from', 'default', 'extends', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield', 'this', 'super', 'null', 'undefined', 'true', 'false'],
  py: ['def', 'class', 'import', 'from', 'as', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'self'],
  go: ['func', 'var', 'const', 'type', 'struct', 'interface', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'fallthrough', 'go', 'defer', 'select', 'chan', 'map', 'make', 'new', 'nil', 'true', 'false'],
  rs: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'as', 'return', 'if', 'else', 'for', 'while', 'loop', 'break', 'continue', 'match', 'true', 'false', 'Some', 'None', 'Ok', 'Err'],
  java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'static', 'final', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'throw', 'throws', 'try', 'catch', 'finally', 'import', 'package', 'this', 'super', 'null', 'true', 'false'],
  c: ['int', 'long', 'short', 'char', 'float', 'double', 'void', 'unsigned', 'signed', 'const', 'static', 'extern', 'register', 'volatile', 'struct', 'union', 'enum', 'typedef', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'goto', 'sizeof', '#include', '#define', '#ifndef', '#ifdef', '#endif'],
  cpp: ['int', 'long', 'short', 'char', 'float', 'double', 'void', 'unsigned', 'signed', 'const', 'static', 'extern', 'struct', 'class', 'public', 'private', 'protected', 'virtual', 'override', 'namespace', 'using', 'template', 'typename', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'try', 'catch', 'throw', 'true', 'false', 'nullptr'],
  sh: ['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'export', 'local', 'readonly', 'unset', 'shift', 'source', 'alias'],
  yml: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
  json: ['true', 'false', 'null'],
};

function getLangFromFile(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py', go: 'go', rs: 'rs', java: 'java', kt: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cxx: 'cpp',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    yml: 'yml', yaml: 'yml',
    json: 'json',
  };
  return map[ext] || '';
}

function highlightLine(content: string, lang: string): React.ReactNode {
  if (!lang || !KEYWORDS[lang]) return content;

  // Tokenize: strings, comments, numbers, keywords
  const tokens: React.ReactNode[] = [];
  let remaining = content;
  let keyCounter = 0;

  const patterns: { regex: RegExp; className: string }[] = [
    // Comments (// ... and /* ... */ and # ...)
    { regex: /^(\/\/.*|#.*)/, className: 'text-comment' },
    { regex: /^(\/\*[\s\S]*?\*\/)/, className: 'text-comment' },
    // Strings (single, double, backtick)
    { regex: /^("(?:[^"\\]|\\.)*")/, className: 'text-string' },
    { regex: /^('(?:[^'\\]|\\.)*')/, className: 'text-string' },
    { regex: /^(`(?:[^`\\]|\\.)*`)/, className: 'text-string' },
    // Numbers
    { regex: /^\b(\d+\.?\d*)\b/, className: 'text-number' },
  ];

  while (remaining.length > 0) {
    let matched = false;
    for (const { regex, className } of patterns) {
      const m = remaining.match(regex);
      if (m) {
        tokens.push(<span key={keyCounter++} className={className}>{m[0]}</span>);
        remaining = remaining.substring(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Try keyword
      const kwRegex = new RegExp(`^\\b(${KEYWORDS[lang].join('|')})\\b`);
      const kwMatch = remaining.match(kwRegex);
      if (kwMatch) {
        tokens.push(<span key={keyCounter++} className="text-keyword">{kwMatch[0]}</span>);
        remaining = remaining.substring(kwMatch[0].length);
      } else {
        // Take one char
        tokens.push(<span key={keyCounter++}>{remaining[0]}</span>);
        remaining = remaining.substring(1);
      }
    }
  }
  return tokens;
}

function shouldShowLine(line: DiffLine, wsMode: WhitespaceMode): boolean {
  if (wsMode === 'normal') return true;
  if (wsMode === 'ignore-all' && line.content.trim() === '') return false;
  if (wsMode === 'ignore-trailing' && line.content === line.content.trimEnd() === false) return true;
  return true;
}

export function DiffViewer({ diff, loading, repoPath, filePath, mode = 'commit', onStaged, onForceCompare }: DiffViewerProps) {
  const toast = useToastActions();
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [wsMode, setWsMode] = useState<WhitespaceMode>('normal');
  // Lazy loading: show first N lines per hunk, expand on demand
  const [expandedHunks, setExpandedHunks] = useState<Set<number>>(new Set());
  const MAX_LINES_PER_HUNK = 100;
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [useWordDiff, setUseWordDiff] = useState(true);
  const [savingBlob, setSavingBlob] = useState(false);
  // SmartGit manual: Compact mode — hides sections of the file which are unchanged
  const [compactMode, setCompactMode] = useState(false);
  // SmartGit manual: current hunk index for prev/next navigation
  const [currentHunkIdx, setCurrentHunkIdx] = useState(0);
  const diffScrollRef = useRef<HTMLDivElement>(null);

  const lang = useMemo(() => (filePath ? getLangFromFile(filePath) : ''), [filePath]);

  /**
   * Find the paired line for word-diff: for a 'del' line, look at the next line;
   * if it's 'add', they form a pair. For 'add' lines, look at previous.
   */
  const findPairedLine = useCallback((lines: DiffLine[], idx: number): DiffLine | null => {
    const line = lines[idx];
    if (!line) return null;
    if (line.type === 'del') {
      // Look at the next line(s) — skip other 'del' lines
      for (let i = idx + 1; i < lines.length; i++) {
        if (lines[i].type === 'add') return lines[i];
        if (lines[i].type === 'context' || lines[i].type === 'hunk-header') return null;
      }
    } else if (line.type === 'add') {
      // Look at previous line(s)
      for (let i = idx - 1; i >= 0; i--) {
        if (lines[i].type === 'del') return lines[i];
        if (lines[i].type === 'context' || lines[i].type === 'hunk-header') return null;
      }
    }
    return null;
  }, []);

  /**
   * Pre-compute word-diff segments ONCE per diff/hunk content (NOT per render).
   * Previously `renderLineWithWordDiff` was called inside `rendered` useMemo
   * which depended on `selectedLines` — so EVERY line click triggered
   * wordDiff() re-computation for ALL visible lines. wordDiff is O(m·n) LCS
   * and allocates a Uint32Array up to 2MB per call. For a 1000-line diff this
   * was 1000 wordDiff() calls on every click = 1-5s of frozen UI.
   *
   * Now: wordDiff is computed once and cached by line identity. Clicking a
   * line only triggers a cheap JSX re-render (Set.has lookup) — no LCS.
   */
  const wordDiffCache = useMemo(() => {
    if (!diff || !useWordDiff) return null;
    // Key: `${hunkIdx}:${lineIdx}` → WordSegment[] for that line
    const cache = new Map<string, { segs: WordSegment[]; isDel: boolean }>();
    diff.hunks.forEach((hunk, hi) => {
      hunk.lines.forEach((line, li) => {
        if (line.type !== 'add' && line.type !== 'del') return;
        const paired = findPairedLine(hunk.lines, li);
        if (!paired) return;
        const content = line.content || '';
        const oldContent = line.type === 'del' ? content : (paired.content || '');
        const newContent = line.type === 'add' ? content : (paired.content || '');
        const { old: oldSegs, new: newSegs } = wordDiff(oldContent, newContent);
        cache.set(`${hi}:${li}`, {
          segs: line.type === 'del' ? oldSegs : newSegs,
          isDel: line.type === 'del',
        });
      });
    });
    return cache;
  }, [diff, useWordDiff, findPairedLine]);

  /**
   * Render a diff line with word-level highlighting.
   * Reads from `wordDiffCache` instead of recomputing — see comment above.
   */
  const renderLineWithWordDiff = useCallback(
    (line: DiffLine, pairedLine: DiffLine | null, hunkIdx: number, lineIdx: number): React.ReactNode => {
      const content = line.content || ' ';
      if (!useWordDiff || !pairedLine) {
        return lang ? highlightLine(content, lang) : content;
      }
      const cached = wordDiffCache?.get(`${hunkIdx}:${lineIdx}`);
      if (!cached) {
        return lang ? highlightLine(content, lang) : content;
      }
      return cached.segs.map((seg, i) => {
        if (seg.kind === 'equal') {
          return <span key={i}>{seg.text}</span>;
        }
        // Highlight added/removed word with a stronger background — theme-aware via CSS variables
        const highlightClass = seg.kind === 'added'
          ? 'rounded-sm'
          : 'rounded-sm line-through';
        const highlightStyle = seg.kind === 'added'
          ? { backgroundColor: 'var(--diff-added-word)' }
          : { backgroundColor: 'var(--diff-removed-word)' };
        return <span key={i} className={highlightClass} style={highlightStyle}>{seg.text}</span>;
      });
    },
    [useWordDiff, lang, wordDiffCache]
  );

  const toggleHunk = useCallback((idx: number) => {
    setCollapsedHunks(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleLineSelection = useCallback((hunkIdx: number, lineIdx: number) => {
    const key = `${hunkIdx}:${lineIdx}`;
    setSelectedLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * Real partial staging: convert the selected lines into contiguous ranges and
   * stage (unstaged mode) or unstage (staged mode) exactly those lines via
   * git apply --cached. Mixed add+del hunks are staged as a whole (same as git add -p).
   */
  const handleApplySelection = useCallback(async () => {
    if (!repoPath || !filePath || selectedLines.size === 0) return;
    if (mode === 'commit') return;
    const nums: number[] = [];
    selectedLines.forEach(key => {
      const [hunkIdx, lineIdx] = key.split(':').map(Number);
      const line = diff?.hunks[hunkIdx]?.lines[lineIdx];
      if (!line) return;
      if (line.type === 'add' && line.newLineNumber !== null) nums.push(line.newLineNumber);
      else if (line.type === 'del' && line.oldLineNumber !== null) nums.push(line.oldLineNumber);
    });
    if (nums.length === 0) return;
    // Group into contiguous inclusive ranges for the stageLines API
    const sorted = [...new Set(nums)].sort((a, b) => a - b);
    const ranges: { start: number; end: number }[] = [];
    for (const n of sorted) {
      const last = ranges[ranges.length - 1];
      if (last && n === last.end + 1) last.end = n;
      else ranges.push({ start: n, end: n });
    }
    try {
      if (mode === 'staged') {
        await api.git.unstageLines(repoPath, filePath, ranges);
        toast.success(sorted.length === 1 ? t('diff.unstagedLine', { count: sorted.length }) : t('diff.unstagedLines', { count: sorted.length }));
      } else {
        await api.git.stageLines(repoPath, filePath, ranges);
        toast.success(sorted.length === 1 ? t('diff.stagedLine', { count: sorted.length }) : t('diff.stagedLines', { count: sorted.length }));
      }
      setSelectedLines(new Set());
      onStaged?.();
    } catch (e) {
      toast.error(t('diff.partialStageFailed'), String(e));
    }
  }, [repoPath, filePath, selectedLines, diff, mode, onStaged, toast, t]);

  /** Save the HEAD version of a binary file to disk (git show HEAD:path via showBuffer). */
  const handleSaveBlob = useCallback(async () => {
    if (!repoPath || !filePath) return;
    setSavingBlob(true);
    try {
      const buf = await api.git.showBuffer(repoPath, ['HEAD:' + filePath]);
      // Normalize to a plain Uint8Array<ArrayBuffer> for the Blob constructor
      const bytes = Uint8Array.from(buf as unknown as ArrayLike<number>);
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop() || 'blob';
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('diff.blobSaved', { name: filePath.split('/').pop() ?? '', bytes: bytes.length }));
    } catch (e) {
      toast.error(t('diff.blobSaveFailed'), String(e));
    } finally {
      setSavingBlob(false);
    }
  }, [repoPath, filePath, toast, t]);

  const rendered = useMemo(() => {
    if (!diff || diff.binary) return null;

    return diff.hunks.map((hunk, hi) => {
      const isCollapsed = collapsedHunks.has(hi);
      // SmartGit manual: Compact mode — hide unchanged context lines,
      // show only add/del/hunk-header lines. This makes large diffs much
      // easier to scan (like SmartGit's compact mode).
      let visibleLines = hunk.lines.filter(l => shouldShowLine(l, wsMode));
      if (compactMode) {
        visibleLines = visibleLines.filter(l => l.type !== 'context');
      }

      if (viewMode === 'unified') {
        return (
          <div key={hi} id={`hunk-${hi}`} className="font-mono text-xs">
            <div
              className="bg-bg-tertiary text-text-secondary px-3 py-1.5 sticky top-0 cursor-pointer flex items-center gap-2 hover:bg-bg-hover border-b border-border-subtle"
              onClick={() => toggleHunk(hi)}
            >
              {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              <span className="truncate font-mono text-2xs text-text-tertiary">{hunk.header}</span>
              <span className="ml-auto flex items-center gap-2 text-2xs">
                <span className="text-status-added font-medium">+{hunk.newLines}</span>
                <span className="text-status-deleted font-medium">-{hunk.oldLines}</span>
              </span>
            </div>
            {!isCollapsed && (() => {
              const isExpanded = expandedHunks.has(hi);
              const linesToShow = isExpanded ? visibleLines : visibleLines.slice(0, MAX_LINES_PER_HUNK);
              const hasMore = !isExpanded && visibleLines.length > MAX_LINES_PER_HUNK;
              return (
                <>
                  {linesToShow.map((line, li) => {
                    const bg =
                      line.type === 'add' ? 'bg-status-added/10' :
                      line.type === 'del' ? 'bg-status-deleted/10' : '';
                    const color =
                      line.type === 'add' ? 'text-status-added' :
                      line.type === 'del' ? 'text-status-deleted' :
                      'text-text-primary';
                    const key = `${hi}:${li}`;
                    const isSelected = selectedLines.has(key);
                    const paired = findPairedLine(visibleLines, li);
              return (
                <div
                  key={li}
                  className={cn(
                    'flex hover:bg-bg-hover cursor-pointer group',
                    bg,
                    isSelected && 'ring-1 ring-accent'
                  )}
                  style={{ lineHeight: '20px', minHeight: '20px' }}
                  onClick={() => (line.type === 'add' || line.type === 'del') && toggleLineSelection(hi, li)}
                >
                  <span className="w-12 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle group-hover:bg-bg-hover">
                    {line.oldLineNumber ?? ''}
                  </span>
                  <span className="w-12 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle group-hover:bg-bg-hover">
                    {line.newLineNumber ?? ''}
                  </span>
                  <span
                    className={cn('w-6 flex-shrink-0 text-center select-none font-bold', color)}
                  >
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                  </span>
                  <pre
                    className={cn('flex-1 pl-2 whitespace-pre-wrap break-all', color)}
                    style={{ fontFamily: 'inherit' }}
                  >
                    {renderLineWithWordDiff(line, paired, hi, li)}
                  </pre>
                </div>
              );
            })}
                  {hasMore && (
                    <div
                      className="flex items-center justify-center py-1 text-2xs text-accent cursor-pointer hover:bg-accent-muted border-b border-border-subtle"
                      onClick={() => setExpandedHunks(prev => {
                        const next = new Set(prev);
                        next.add(hi);
                        return next;
                      })}
                    >
                      ▼ {t('diff.showMoreLines', { count: visibleLines.length - MAX_LINES_PER_HUNK })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        );
      }

      // Split view: side by side
      return (
        <div key={hi} className="font-mono text-xs">
          <div
            className="bg-bg-tertiary text-text-tertiary px-2 py-1 sticky top-0 cursor-pointer flex items-center gap-2 hover:bg-bg-hover"
            onClick={() => toggleHunk(hi)}
          >
            {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            <span className="truncate">{hunk.header}</span>
          </div>
          {!isCollapsed && (
            <div className="flex">
              {/* Left: old */}
              <div className="flex-1 border-r border-border-default">
                {visibleLines.map((line, li) => {
                  if (line.type === 'add') {
                    return (
                      <div key={li} className="flex hover:bg-bg-hover" style={{ lineHeight: '20px', minHeight: '20px' }}>
                        <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none">{line.oldLineNumber ?? ''}</span>
                        <pre className="flex-1 pl-2 whitespace-pre-wrap text-text-tertiary" style={{ fontFamily: 'inherit', background: 'var(--diff-added-line)' }}> </pre>
                      </div>
                    );
                  }
                  const bg = line.type === 'del' ? 'bg-status-deleted/10' : '';
                  const color = line.type === 'del' ? 'text-status-deleted' : 'text-text-primary';
                  const key = `${hi}:${li}`;
                  const isSelected = selectedLines.has(key);
                  return (
                    <div
                      key={li}
                      className={cn('flex hover:bg-bg-hover cursor-pointer', bg, isSelected && 'ring-1 ring-accent')}
                      style={{ lineHeight: '20px', minHeight: '20px' }}
                      onClick={() => line.type === 'del' && toggleLineSelection(hi, li)}
                    >
                      <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none">{line.oldLineNumber ?? ''}</span>
                      <pre className={cn('flex-1 pl-2 whitespace-pre-wrap', color)} style={{ fontFamily: 'inherit' }}>{line.content || ' '}</pre>
                    </div>
                  );
                })}
              </div>
              {/* Right: new */}
              <div className="flex-1">
                {visibleLines.map((line, li) => {
                  if (line.type === 'del') {
                    return (
                      <div key={li} className="flex hover:bg-bg-hover" style={{ lineHeight: '20px', minHeight: '20px' }}>
                        <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none">{line.newLineNumber ?? ''}</span>
                        <pre className="flex-1 pl-2 whitespace-pre-wrap text-text-tertiary" style={{ fontFamily: 'inherit', background: 'var(--diff-removed-line)' }}> </pre>
                      </div>
                    );
                  }
                  const bg = line.type === 'add' ? 'bg-status-added/10' : '';
                  const color = line.type === 'add' ? 'text-status-added' : 'text-text-primary';
                  const key = `${hi}:${li}`;
                  const isSelected = selectedLines.has(key);
                  return (
                    <div
                      key={li}
                      className={cn('flex hover:bg-bg-hover cursor-pointer group', bg, isSelected && 'ring-1 ring-accent')}
                      style={{ lineHeight: '20px', minHeight: '20px' }}
                      onClick={() => line.type === 'add' && toggleLineSelection(hi, li)}
                    >
                      <span className="w-10 flex-shrink-0 text-right pr-2 text-text-tertiary select-none group-hover:bg-bg-hover">{line.newLineNumber ?? ''}</span>
                      <pre className={cn('flex-1 pl-2 whitespace-pre-wrap', color)} style={{ fontFamily: 'inherit' }}>
                        {lang ? highlightLine(line.content || ' ', lang) : (line.content || ' ')}
                      </pre>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      );
    });
  }, [diff, viewMode, wsMode, collapsedHunks, selectedLines, lang, toggleHunk, toggleLineSelection, useWordDiff, renderLineWithWordDiff, findPairedLine]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        <RefreshCw size={16} className="spin mr-2" />
        {t('diff.loading')}
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        {t('diff.selectFile')}
      </div>
    );
  }

  if (diff.binary) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary text-sm gap-3">
        <div>{t('diff.binary')}</div>
        {repoPath && filePath && (
          <button className="btn btn-secondary text-xs" onClick={handleSaveBlob} disabled={savingBlob}>
            {savingBlob ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
            {t('diff.saveFromHead')}
          </button>
        )}
        {onForceCompare && (
          <button
            className="btn btn-secondary text-xs"
            title={t('diff.forceCompareTooltip')}
            onClick={onForceCompare}
          >
            <RefreshCw size={12} /> {t('diff.forceCompare')}
          </button>
        )}
      </div>
    );
  }

  const addedLines = diff.hunks.reduce((acc, h) => acc + h.lines.filter(l => l.type === 'add').length, 0);
  const removedLines = diff.hunks.reduce((acc, h) => acc + h.lines.filter(l => l.type === 'del').length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* Diff header */}
      <div className="px-3 py-2 border-b border-border-default text-xs bg-bg-secondary flex items-center justify-between flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {diff.newFile && <span className="badge badge-added">{t('diff.badgeNew')}</span>}
          {diff.deletedFile && <span className="badge badge-deleted">{t('diff.badgeDeleted')}</span>}
          {diff.renamedFile && <span className="badge badge-renamed">{t('diff.badgeRenamed')}</span>}
          {diff.modeChange && <span className="badge badge-modified">{t('diff.badgeMode')}</span>}
          <span className="font-mono truncate text-text-primary">{diff.newPath}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-status-added font-medium">+{addedLines}</span>
          <span className="text-status-deleted font-medium">-{removedLines}</span>
          {diff.hunks.length > 1 && (
            <>
              <div className="w-px h-4 bg-border-default mx-1" />
              <span className="text-2xs text-text-tertiary">
                {collapsedHunks.size > 0
                  ? t('diff.hunksCount', { visible: diff.hunks.length - collapsedHunks.size, total: diff.hunks.length })
                  : t('diff.hunksCountAll', { count: diff.hunks.length })}
              </span>
              <button
                className="icon-btn !w-5 !h-5"
                title={t('diff.collapseAll')}
                onClick={() => {
                  const all = new Set(diff.hunks.map((_, i) => i));
                  setCollapsedHunks(collapsedHunks.size === diff.hunks.length ? new Set() : all);
                }}
              >
                {collapsedHunks.size === diff.hunks.length ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            </>
          )}
          <div className="w-px h-4 bg-border-default mx-1" />
          <select
            className="text-2xs bg-bg-tertiary border border-border-default rounded px-1.5 py-0.5"
            value={wsMode}
            onChange={(e) => setWsMode(e.target.value as WhitespaceMode)}
            title={t('diff.wsModeTooltip')}
          >
            <option value="normal">{t('diff.wsNormal')}</option>
            <option value="ignore-all">{t('diff.wsIgnoreAll')}</option>
            <option value="ignore-trailing">{t('diff.wsIgnoreTrailing')}</option>
          </select>
          <button
            className={cn('px-2 py-0.5 text-2xs rounded border transition-colors', useWordDiff
              ? 'bg-accent text-text-inverse border-accent'
              : 'bg-bg-tertiary text-text-secondary border-border-default hover:bg-bg-hover')}
            onClick={() => setUseWordDiff(!useWordDiff)}
            title={t('diff.wordDiffTooltip')}
          >
            {t('diff.wordDiffButton')}
          </button>
          {/* SmartGit manual: Compact mode — hide unchanged sections */}
          <button
            className={cn('px-2 py-0.5 text-2xs rounded border transition-colors', compactMode
              ? 'bg-accent text-text-inverse border-accent'
              : 'bg-bg-tertiary text-text-secondary border-border-default hover:bg-bg-hover')}
            onClick={() => setCompactMode(!compactMode)}
            title={t('diff.compactTooltip')}
          >
            {t('diff.compact')}
          </button>
          {/* SmartGit manual: prev/next hunk navigation arrows */}
          {diff.hunks.length > 1 && (
            <div className="flex items-center gap-0.5">
              <button
                className="icon-btn !w-5 !h-5"
                title={t('diff.prevHunk')}
                onClick={() => {
                  const prev = Math.max(0, currentHunkIdx - 1);
                  setCurrentHunkIdx(prev);
                  document.getElementById(`hunk-${prev}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                disabled={currentHunkIdx === 0}
              >
                <ChevronRight size={11} className="rotate-180" />
              </button>
              <span className="text-2xs text-text-tertiary">
                {currentHunkIdx + 1}/{diff.hunks.length}
              </span>
              <button
                className="icon-btn !w-5 !h-5"
                title={t('diff.nextHunk')}
                onClick={() => {
                  const next = Math.min(diff.hunks.length - 1, currentHunkIdx + 1);
                  setCurrentHunkIdx(next);
                  document.getElementById(`hunk-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                disabled={currentHunkIdx === diff.hunks.length - 1}
              >
                <ChevronRight size={11} />
              </button>
            </div>
          )}
          <div className="flex bg-bg-tertiary rounded overflow-hidden border border-border-default">
            <button
              className={cn('px-2.5 py-0.5 text-2xs transition-colors', viewMode === 'unified' ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
              onClick={() => setViewMode('unified')}
              title={t('diff.unifiedViewTooltip')}
            >
              {t('diff.unified')}
            </button>
            <button
              className={cn('px-2.5 py-0.5 text-2xs transition-colors border-l border-border-default', viewMode === 'split' ? 'bg-accent text-text-inverse' : 'text-text-secondary hover:bg-bg-hover')}
              onClick={() => setViewMode('split')}
              title={t('diff.splitViewTooltip')}
            >
              {t('diff.splitButton')}
            </button>
          </div>
          {selectedLines.size > 0 && repoPath && mode !== 'commit' && (
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={handleApplySelection}
              title={mode === 'staged'
                ? t('diff.unstageSelectionTooltip')
                : t('diff.stageSelectionTooltip')}
            >
              {mode === 'staged' ? t('diff.unstage') : t('toolbar.stage')} {t('diff.selectionCount', { count: selectedLines.size })}
            </button>
          )}
        </div>
      </div>
      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {rendered}
        {diff.hunks.length === 0 && (
          <div className="p-4 text-sm text-text-tertiary">{t('diff.noChanges')}</div>
        )}
      </div>
    </div>
  );
}
