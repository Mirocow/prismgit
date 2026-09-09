/**
 * CommitFileTree — tree view for commit files with collapsible folders.
 * Used in History detail panel as an alternative to the flat list view.
 */
import { ChevronDown, ChevronRight, Folder, FolderOpen, FileText } from './icons';
import type { CommitFile } from '../lib/api';
import { cn } from '../lib/utils';

interface TreeNode {
  name: string;
  path: string;
  isFile: boolean;
  file?: CommitFile;
  children: Map<string, TreeNode>;
}

function buildTree(files: CommitFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isFile: false, children: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    let cur = root;
    let curPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      curPath = curPath ? `${curPath}/${part}` : part;
      const isLast = i === parts.length - 1;
      if (!cur.children.has(part)) {
        cur.children.set(part, {
          name: part,
          path: curPath,
          isFile: isLast,
          file: isLast ? file : undefined,
          children: new Map(),
        });
      }
      cur = cur.children.get(part)!;
    }
  }
  return root;
}

interface CommitFileTreeProps {
  files: CommitFile[];
  expandedDirs: Set<string>;
  onToggleDir: (dir: string) => void;
  globalPathFilter?: string | null;
  onFileClick: (f: CommitFile) => void;
  onFileContextMenu: (e: React.MouseEvent, f: CommitFile) => void;
}

function renderNode(
  node: TreeNode,
  depth: number,
  expandedDirs: Set<string>,
  onToggleDir: (dir: string) => void,
  globalPathFilter: string | null,
  onFileClick: (f: CommitFile) => void,
  onFileContextMenu: (e: React.MouseEvent, f: CommitFile) => void,
): React.ReactNode {
  if (node.isFile && node.file) {
    const f = node.file;
    const isHighlighted = globalPathFilter === f.path || globalPathFilter === f.oldPath;
    return (
      <div
        key={node.path}
        className={cn(
          'flex items-center gap-1 text-2xs px-1 py-0.5 rounded hover:bg-bg-hover cursor-pointer group',
          isHighlighted && 'bg-accent-muted border-l-2 border-accent'
        )}
        style={{ paddingLeft: 4 + depth * 13 }}
        onClick={() => onFileClick(f)}
        onContextMenu={(e) => onFileContextMenu(e, f)}
        title={f.path}
      >
        <span className="font-mono font-bold w-3 text-center flex-shrink-0"
          style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>
          {f.status}
        </span>
        <FileText size={10} className="text-text-tertiary flex-shrink-0" />
        <span className={cn('flex-1 truncate font-mono text-text-secondary group-hover:text-text-primary',
          isHighlighted && 'text-accent font-medium')}>
          {node.name}
        </span>
        {!f.binary && (f.additions > 0 || f.deletions > 0) && (
          <span className="text-2xs flex-shrink-0">
            <span className="text-status-added">+{f.additions}</span>
            <span className="text-status-deleted ml-1">-{f.deletions}</span>
          </span>
        )}
      </div>
    );
  }

  // Folder node
  const isOpen = expandedDirs.has(node.path);
  const childNodes = Array.from(node.children.values()).sort((a, b) => {
    // Folders first, then files, alphabetically
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div key={node.path}>
      <div
        className="flex items-center gap-1 text-2xs px-1 py-0.5 cursor-pointer hover:bg-bg-hover"
        style={{ paddingLeft: 4 + depth * 13 }}
        onClick={() => onToggleDir(node.path)}
        title={node.path}
      >
        {isOpen ? <ChevronDown size={10} className="text-text-tertiary flex-shrink-0" /> : <ChevronRight size={10} className="text-text-tertiary flex-shrink-0" />}
        {isOpen ? <FolderOpen size={11} className="text-text-tertiary flex-shrink-0" /> : <Folder size={11} className="text-text-tertiary flex-shrink-0" />}
        <span className="flex-1 truncate text-text-secondary">{node.name}</span>
      </div>
      {isOpen && childNodes.map(child =>
        renderNode(child, depth + 1, expandedDirs, onToggleDir, globalPathFilter, onFileClick, onFileContextMenu)
      )}
    </div>
  );
}

export function CommitFileTree({
  files,
  expandedDirs,
  onToggleDir,
  globalPathFilter,
  onFileClick,
  onFileContextMenu,
}: CommitFileTreeProps) {
  if (files.length === 0) {
    return <div className="text-2xs text-text-tertiary">No files</div>;
  }

  const tree = buildTree(files);
  const rootNodes = Array.from(tree.children.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  // Auto-expand first level
  const effectiveExpanded = new Set(expandedDirs);
  for (const node of rootNodes) {
    if (!node.isFile) effectiveExpanded.add(node.path);
  }

  return (
    <div className="space-y-0.5">
      {rootNodes.map(node =>
        renderNode(node, 0, effectiveExpanded, onToggleDir, globalPathFilter ?? null, onFileClick, onFileContextMenu)
      )}
    </div>
  );
}
