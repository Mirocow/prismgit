import { useMemo } from 'react';
import { type DiffResult } from '../lib/api';
import { cn } from '../lib/utils';

interface DiffViewerProps {
  diff: DiffResult | null;
  loading?: boolean;
}

export function DiffViewer({ diff, loading }: DiffViewerProps) {
  const rendered = useMemo(() => {
    if (!diff || diff.binary) return null;
    return diff.hunks.map((hunk, hi) => (
      <div key={hi} className="font-mono text-xs">
        <div className="bg-bg-tertiary text-text-tertiary px-2 py-1 sticky top-0">
          {hunk.header}
        </div>
        {hunk.lines.map((line, li) => {
          const bg =
            line.type === 'add'
              ? 'bg-status-added/10'
              : line.type === 'del'
              ? 'bg-status-deleted/10'
              : '';
          const color =
            line.type === 'add'
              ? 'text-status-added'
              : line.type === 'del'
              ? 'text-status-deleted'
              : 'text-text-primary';
          return (
            <div
              key={li}
              className={cn('flex hover:bg-bg-hover', bg)}
              style={{ lineHeight: '20px', minHeight: '20px' }}
            >
              <span className="w-12 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle">
                {line.oldLineNumber ?? ''}
              </span>
              <span className="w-12 flex-shrink-0 text-right pr-2 text-text-tertiary select-none border-r border-border-subtle">
                {line.newLineNumber ?? ''}
              </span>
              <span
                className={cn('w-6 flex-shrink-0 text-center select-none', color)}
                style={{ fontWeight: 'bold' }}
              >
                {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
              </span>
              <pre
                className={cn('flex-1 pl-2 whitespace-pre-wrap break-all', color)}
                style={{ fontFamily: 'inherit' }}
              >
                {line.content || ' '}
              </pre>
            </div>
          );
        })}
      </div>
    ));
  }, [diff]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
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
        Binary file - diff not available
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-bg-primary">
      <div className="px-3 py-2 border-b border-border-default text-xs text-text-secondary bg-bg-secondary">
        {diff.newFile && <span className="badge badge-added mr-2">NEW</span>}
        {diff.deletedFile && <span className="badge badge-deleted mr-2">DELETED</span>}
        {diff.renamedFile && <span className="badge badge-renamed mr-2">RENAMED</span>}
        <span className="font-mono">{diff.newPath}</span>
      </div>
      {rendered}
      {diff.hunks.length === 0 && (
        <div className="p-4 text-sm text-text-tertiary">No changes</div>
      )}
    </div>
  );
}
