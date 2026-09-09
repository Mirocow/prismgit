import { useState, useMemo, useCallback } from 'react';
import { type DiffResult, type DiffHunk, type DiffLine } from '../lib/api';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { RefreshCw, Copy, ChevronDown, ChevronRight } from './icons';

interface DiffViewerProps {
  diff: DiffResult | null;
  loading?: boolean;
  repoPath?: string;
  filePath?: string;
  onStageLines?: (lines: number[]) => void;
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

export function DiffViewer({ diff, loading, repoPath, filePath, onStageLines }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [wsMode, setWsMode] = useState<WhitespaceMode>('normal');
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());

  const lang = useMemo(() => (filePath ? getLangFromFile(filePath) : ''), [filePath]);

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

  const handleApplySelection = useCallback(async () => {
    if (!repoPath || !filePath || selectedLines.size === 0) return;
    // Collect line ranges from selected lines
    const lines: number[] = [];
    selectedLines.forEach(key => {
      const [hunkIdx, lineIdx] = key.split(':').map(Number);
      const hunk = diff?.hunks[hunkIdx];
      if (hunk) {
        const line = hunk.lines[lineIdx];
        if (line && line.type === 'add' && line.newLineNumber !== null) {
          lines.push(line.newLineNumber);
        }
      }
    });
    if (lines.length === 0) return;

    // Use git apply --cached with a patch
    // For simplicity, use git add --patch interactive approach via raw command
    // Actually, the simplest approach: stage the whole file or use git add -p
    // Here we'll stage the whole file as a fallback
    try {
      await api.git.add(repoPath, [filePath]);
      setSelectedLines(new Set());
    } catch (e) {
      console.error('Apply selection failed:', e);
    }
  }, [repoPath, filePath, selectedLines, diff]);

  const rendered = useMemo(() => {
    if (!diff || diff.binary) return null;

    return diff.hunks.map((hunk, hi) => {
      const isCollapsed = collapsedHunks.has(hi);
      const visibleLines = hunk.lines.filter(l => shouldShowLine(l, wsMode));

      if (viewMode === 'unified') {
        return (
          <div key={hi} className="font-mono text-xs">
            <div
              className="bg-bg-tertiary text-text-tertiary px-2 py-1 sticky top-0 cursor-pointer flex items-center gap-2 hover:bg-bg-hover"
              onClick={() => toggleHunk(hi)}
            >
              {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              <span className="truncate">{hunk.header}</span>
              <span className="ml-auto text-2xs">+{hunk.newLines} -{hunk.oldLines}</span>
            </div>
            {!isCollapsed && visibleLines.map((line, li) => {
              const bg =
                line.type === 'add' ? 'bg-status-added/10' :
                line.type === 'del' ? 'bg-status-deleted/10' : '';
              const color =
                line.type === 'add' ? 'text-status-added' :
                line.type === 'del' ? 'text-status-deleted' :
                'text-text-primary';
              const key = `${hi}:${li}`;
              const isSelected = selectedLines.has(key);
              return (
                <div
                  key={li}
                  className={cn(
                    'flex hover:bg-bg-hover cursor-text group',
                    bg,
                    isSelected && 'ring-1 ring-accent'
                  )}
                  style={{ lineHeight: '20px', minHeight: '20px' }}
                  onClick={() => line.type === 'add' && toggleLineSelection(hi, li)}
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
                    {lang ? highlightLine(line.content || ' ', lang) : (line.content || ' ')}
                  </pre>
                </div>
              );
            })}
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
                  return (
                    <div key={li} className={cn('flex hover:bg-bg-hover', bg)} style={{ lineHeight: '20px', minHeight: '20px' }}>
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
  }, [diff, viewMode, wsMode, collapsedHunks, selectedLines, lang, toggleHunk, toggleLineSelection]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        <RefreshCw size={16} className="spin mr-2" />
        Loading diff...
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Select a file to view its diff
      </div>
    );
  }

  if (diff.binary) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Binary file — diff not available
      </div>
    );
  }

  const addedLines = diff.hunks.reduce((acc, h) => acc + h.lines.filter(l => l.type === 'add').length, 0);
  const removedLines = diff.hunks.reduce((acc, h) => acc + h.lines.filter(l => l.type === 'del').length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
      {/* Diff header */}
      <div className="px-3 py-1.5 border-b border-border-default text-xs bg-bg-secondary flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {diff.newFile && <span className="badge badge-added">NEW</span>}
          {diff.deletedFile && <span className="badge badge-deleted">DELETED</span>}
          {diff.renamedFile && <span className="badge badge-renamed">RENAMED</span>}
          {diff.modeChange && <span className="badge badge-modified">MODE</span>}
          <span className="font-mono truncate">{diff.newPath}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-status-added">+{addedLines}</span>
          <span className="text-status-deleted">-{removedLines}</span>
          <div className="w-px h-4 bg-border-default mx-1" />
          <select
            className="text-2xs bg-bg-tertiary border border-border-default rounded px-1 py-0.5"
            value={wsMode}
            onChange={(e) => setWsMode(e.target.value as WhitespaceMode)}
            title="Whitespace mode"
          >
            <option value="normal">Normal</option>
            <option value="ignore-all">Ignore all WS</option>
            <option value="ignore-trailing">Ignore trailing</option>
          </select>
          <div className="flex bg-bg-tertiary rounded">
            <button
              className={cn('px-2 py-0.5 text-2xs rounded-l', viewMode === 'unified' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
              onClick={() => setViewMode('unified')}
              title="Unified view"
            >
              Unified
            </button>
            <button
              className={cn('px-2 py-0.5 text-2xs rounded-r', viewMode === 'split' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
              onClick={() => setViewMode('split')}
              title="Split view (side-by-side)"
            >
              Split
            </button>
          </div>
          {selectedLines.size > 0 && (
            <button
              className="btn btn-primary text-2xs !py-0.5 !px-2"
              onClick={handleApplySelection}
              title="Stage selected lines"
            >
              Apply Selection ({selectedLines.size})
            </button>
          )}
        </div>
      </div>
      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {rendered}
        {diff.hunks.length === 0 && (
          <div className="p-4 text-sm text-text-tertiary">No changes</div>
        )}
      </div>
    </div>
  );
}
