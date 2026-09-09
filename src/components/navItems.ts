import { GitBranch, GitCommit, GitPullRequest, History, Tag, Package, FolderTree, RotateCcw, FileText, Search, CloudDownload, Filter } from './icons';

/**
 * Single source of truth for the app navigation.
 * Used by the Sidebar AND the Command Palette (Ctrl+K) so both stay in sync.
 */
export interface NavItem {
  path: string;
  label: string;
  icon: typeof GitBranch;
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/changes', label: 'Changes', icon: GitCommit, group: 'Working Tree' },
  { path: '/history', label: 'History', icon: History, group: 'Working Tree' },
  { path: '/diff', label: 'Diff', icon: FileText, group: 'Working Tree' },
  { path: '/annotate', label: 'Annotate', icon: FileText, group: 'Working Tree' },
  { path: '/investigate', label: 'Investigate', icon: Search, group: 'Working Tree' },
  { path: '/blame', label: 'Blame', icon: FileText, group: 'Working Tree' },
  { path: '/journal', label: 'Journal', icon: RotateCcw, group: 'Working Tree' },
  { path: '/gitflow', label: 'Git-Flow', icon: GitBranch, group: 'Workflows' },
  { path: '/bisect', label: 'Bisect', icon: Filter, group: 'Workflows' },
  { path: '/pulls', label: 'Pull Requests', icon: GitPullRequest, group: 'Workflows' },
  { path: '/reviews', label: 'Reviews', icon: GitPullRequest, group: 'Workflows' },
  { path: '/branches', label: 'Branches', icon: GitBranch, group: 'Refs' },
  { path: '/tags', label: 'Tags', icon: Tag, group: 'Refs' },
  { path: '/remotes', label: 'Remotes', icon: CloudDownload, group: 'Refs' },
  { path: '/worktrees', label: 'Worktrees', icon: FolderTree, group: 'Refs' },
  { path: '/reflog', label: 'Reflog', icon: RotateCcw, group: 'Refs' },
  { path: '/stashes', label: 'Stashes', icon: GitPullRequest, group: 'Refs' },
  { path: '/submodules', label: 'Submodules', icon: Package, group: 'Refs' },
  { path: '/lfs', label: 'Git LFS', icon: Package, group: 'Refs' },
];

/**
 * Quick-navigation shortcuts (Ctrl+1..9). Pages not listed here are still
 * reachable via the sidebar or the Command Palette.
 */
export const NAV_SHORTCUTS: Record<string, string> = {
  '/changes': 'Ctrl+1',
  '/history': 'Ctrl+2',
  '/diff': 'Ctrl+3',
  '/branches': 'Ctrl+4',
  '/tags': 'Ctrl+5',
  '/stashes': 'Ctrl+6',
  '/remotes': 'Ctrl+7',
  '/journal': 'Ctrl+8',
  '/investigate': 'Ctrl+9',
};
