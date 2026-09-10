import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderGit, FolderGitOpen } from './icons';
import type { DirNode } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

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
  const { t } = useI18n();
  return (
    <span
      className="ml-auto flex-shrink-0 min-w-[18px] text-center rounded-full bg-accent-muted text-accent text-2xs font-bold px-1.5 leading-[14px]"
      title={count === 1 ? t('changes.changedFileCountOne', { count }) : t('changes.changedFileCountMany', { count })}
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
  const { t } = useI18n();
  const open = expanded.has(node.path);
  const hasChildren = node.children.length > 0;
  const selected = selectedDir === node.path;
  const changeCount = changeCounts.get(node.path) ?? 0;
  const hasChanges = changeCount > 0;
  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 h-[24px] pr-2 cursor-pointer text-xs transition-colors',
          selected ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onSelectDir(node.path)}
        title={node.path}
      >
        {hasChildren ? (
          <button
            className="w-4 h-4 grid place-items-center rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover flex-shrink-0 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.path);
            }}
            title={open ? t('changes.collapse') : t('changes.expand')}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        {open ? (
          <FolderOpen
            size={13}
            className={cn('flex-shrink-0', hasChanges ? 'text-accent' : 'text-text-tertiary')}
          />
        ) : (
          <Folder
            size={13}
            className={cn('flex-shrink-0', hasChanges ? 'text-accent' : 'text-text-tertiary')}
          />
        )}
        <span className={cn('truncate', hasChanges && 'text-accent font-semibold')}>{node.name}</span>
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
  const { t } = useI18n();
  const rootOpen = p.expanded.has(ROOT_KEY);
  return (
    <div className="py-1 select-none">
      <div
        className={cn(
          'flex items-center gap-1 h-[26px] pl-2 pr-1 cursor-pointer text-xs transition-colors',
          p.selectedDir === null ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        )}
        onClick={() => p.onSelectDir(null)}
        title={t('changes.showAllChanged')}
      >
        <button
          className="w-4 h-4 grid place-items-center rounded-sm text-text-tertiary hover:text-text-primary hover:bg-bg-hover flex-shrink-0 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleExpand(ROOT_KEY);
          }}
          title={rootOpen ? t('changes.collapse') : t('changes.expand')}
        >
          {rootOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {rootOpen ? <FolderGitOpen size={14} className="text-accent flex-shrink-0" /> : <FolderGit size={14} className="text-accent flex-shrink-0" />}
        <span className="truncate font-semibold">{p.repoName}</span>
        <span className="text-text-tertiary truncate font-mono text-2xs">
          ({p.loading && p.branch === null ? '?' : p.branch ?? 'HEAD'})
        </span>
        {p.totalChanges > 0 && <ChangeBadge count={p.totalChanges} />}
      </div>

      {rootOpen &&
        (p.loading && p.tree.length === 0 ? (
          <div className="pl-8 py-1 text-2xs text-text-tertiary animate-pulse">{t('common.loading')}</div>
        ) : p.tree.length === 0 ? (
          <div className="pl-8 py-1 text-2xs text-text-tertiary">{t('changes.noFolders')}</div>
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
