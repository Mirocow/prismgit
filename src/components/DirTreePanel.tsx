import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderGit, FolderGitOpen } from './icons';
import type { DirNode } from '../lib/api';
import { cn } from '../lib/utils';

interface DirTreePanelProps {
  repoName: string;
  branch: string | null;
  tree: DirNode[];
  loading: boolean;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  selectedDir: string | null;
  onSelectDir: (dir: string | null) => void;
  /** Changed-file count per directory path (every ancestor folder included). */
  changeCounts: Map<string, number>;
  /** Total number of changed files in the repository (for the root badge). */
  totalChanges: number;
}

/** Small rounded counter shown next to folders that contain changed files. */
function ChangeBadge({ count }: { count: number }) {
  return (
    <span
      className="ml-auto flex-shrink-0 min-w-[16px] text-center rounded-full bg-accent-muted text-accent text-2xs font-semibold px-1 leading-4"
      title={`${count} changed file${count === 1 ? '' : 's'}`}
    >
      {count}
    </span>
  );
}

const ROOT_KEY = '__repo_root__';

function DirRows({
  node,
  depth,
  expanded,
  onToggleExpand,
  selectedDir,
  onSelectDir,
  changeCounts,
}: {
  node: DirNode;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  selectedDir: string | null;
  onSelectDir: (dir: string | null) => void;
  changeCounts: Map<string, number>;
}) {
  const open = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const selected = selectedDir === node.path;
  const changeCount = changeCounts.get(node.path) ?? 0;
  const hasChanges = changeCount > 0;
  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 h-[22px] pr-2 cursor-pointer text-xs',
          selected ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        )}
        style={{ paddingLeft: 4 + depth * 13 }}
        onClick={() => onSelectDir(node.path)}
        title={node.path}
      >
        {hasChildren ? (
          <button
            className="w-4 h-4 grid place-items-center rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.path);
            }}
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        {open ? (
          <FolderOpen
            size={12}
            className={cn('flex-shrink-0', hasChanges ? 'text-accent' : 'text-text-tertiary')}
          />
        ) : (
          <Folder
            size={12}
            className={cn('flex-shrink-0', hasChanges ? 'text-accent' : 'text-text-tertiary')}
          />
        )}
        <span className={cn('truncate', hasChanges && 'text-accent font-semibold')}>
          {node.name}
        </span>
        {hasChanges && <ChangeBadge count={changeCount} />}
      </div>
      {open &&
        hasChildren &&
        node.children.map((child) => (
          <DirRows
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            selectedDir={selectedDir}
            onSelectDir={onSelectDir}
            changeCounts={changeCounts}
          />
        ))}
    </>
  );
}

/**
 * SmartGit-style directory tree for the Changes page: the repository as root
 * (with its branch), expandable folders beneath it. Selecting a folder scopes
 * the file list; selecting the repository root shows everything.
 */
export function DirTreePanel(p: DirTreePanelProps) {
  const rootOpen = p.expanded.has(ROOT_KEY);
  return (
    <div className="py-0.5 select-none">
      <div
        className={cn(
          'flex items-center gap-1 h-[22px] pl-1 pr-1 cursor-pointer text-xs',
          p.selectedDir === null ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        )}
        onClick={() => p.onSelectDir(null)}
        title="Show all changed files"
      >
        <button
          className="w-4 h-4 grid place-items-center rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleExpand(ROOT_KEY);
          }}
          title={rootOpen ? 'Collapse' : 'Expand'}
        >
          {rootOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {rootOpen ? <FolderGitOpen size={13} className="text-accent flex-shrink-0" /> : <FolderGit size={13} className="text-accent flex-shrink-0" />}
        <span className="truncate font-medium">{p.repoName}</span>
        <span className="text-text-tertiary truncate">
          ({p.loading && p.branch === null ? '?' : p.branch ?? 'HEAD'})
        </span>
        {p.totalChanges > 0 && <ChangeBadge count={p.totalChanges} />}
      </div>

      {rootOpen &&
        (p.loading && p.tree.length === 0 ? (
          <div className="pl-7 py-1 text-2xs text-text-tertiary">Loading...</div>
        ) : p.tree.length === 0 ? (
          <div className="pl-7 py-1 text-2xs text-text-tertiary">No folders</div>
        ) : (
          p.tree.map((node) => (
            <DirRows
              key={node.path}
              node={node}
              depth={1}
              expanded={p.expanded}
              onToggleExpand={p.onToggleExpand}
              selectedDir={p.selectedDir}
              onSelectDir={p.onSelectDir}
              changeCounts={p.changeCounts}
            />
          ))
        ))}
    </div>
  );
}

export { ROOT_KEY };
