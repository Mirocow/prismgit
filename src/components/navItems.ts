import { GitBranch, GitCommit, GitPullRequest, History, Tag, Package, RotateCcw, FileText, Search, CloudDownload, Filter, Recycle, Sparkles } from './icons';

/**
 * Single source of truth for the app navigation.
 * Used by the Sidebar AND the Command Palette (Ctrl+K) so both stay in sync.
 *
 * REMOVED tools (consolidated into others):
 *   - Annotate → merged into History (History already has file filtering via
 *     globalPathFilter — clicking "View file history" in Changes navigates
 *     to History with the file filter set)
 *   - Journal → merged into Reflog (Reflog now has Journal's action-type
 *     filters + cherry-pick/reset actions)
 *   - Investigate → renamed to "Search" (grep-focused, rev-parse removed)
 *
 * Task 14 / 19 / 21 — REMOVED:
 *   - Worktrees → functionality moved into Branches page (the natural
 *     home; worktrees are per-branch anyway, so 'create worktree from
 *     this branch' now appears in the branch context menu).
 *   - Subtrees → removed entirely (subtree workflow is rarely used and
 *     outside the scope of a daily-driver Git GUI).
 *   - Notes → removed entirely (git notes are obscure; distributed
 *     reviews in /reviews already cover the 'metadata on a commit'
 *     use case with a richer UI).
 */
export interface NavItem {
  path: string;
  label: string;
  icon: typeof GitBranch;
  group: string;
  /** Short description shown as a help banner at the top of the page. */
  description?: string;
}

export const NAV_ITEMS: NavItem[] = [
  // === Working Tree ===
  { path: '/changes', label: 'Changes', icon: GitCommit, group: 'Working Tree',
    description: 'Staged and unstaged changes. Stage files, write a commit message, and commit. Right-click a file for more actions.' },
  { path: '/history', label: 'History', icon: History, group: 'Working Tree',
    description: 'Commit graph across all branches. Filter by author, date, path, or message. Select a commit to see its files and diff. Right-click for tag/branch/cherry-pick.' },
  { path: '/diff', label: 'Diff', icon: FileText, group: 'Working Tree',
    description: 'Compare any two refs (commits, branches, tags) or the working tree. Drag the splitter to resize the file list.' },
  { path: '/search', label: 'Search', icon: Search, group: 'Working Tree',
    description: 'Search file contents with git grep. Find TODOs, function definitions, or any text across tracked files.' },
  { path: '/blame', icon: FileText, label: 'Blame', group: 'Working Tree',
    description: 'Line-by-line attribution: who wrote each line of a file, and in which commit. Click a commit hash to jump to it in History.' },

  // === Workflows ===
  { path: '/gitflow', label: 'Git-Flow', icon: GitBranch, group: 'Workflows',
    description: 'Manage the Git-Flow branching model: feature, release, and hotfix branches. Start and finish each flow type.' },
  { path: '/bisect', label: 'Bisect', icon: Filter, group: 'Workflows',
    description: 'Binary search to find the commit that introduced a bug. Mark a commit as good or bad, and Git narrows the range.' },
  { path: '/pulls', label: 'Pull Requests', icon: GitPullRequest, group: 'Workflows',
    description: 'GitHub pull request integration. Requires a GitHub PAT (Settings → GitHub Integration). View, create, and open PRs.' },
  { path: '/reviews', label: 'Reviews', icon: GitPullRequest, group: 'Workflows',
    description: 'Distributed code reviews stored in git notes. Add comments to commits, files, and lines. Push/fetch to sync with teammates.' },

  // === AI ===
  { path: '/ai-chat', label: 'AI Chat', icon: Sparkles, group: 'AI',
    description: 'AI Assistant chat — ask about your repository, stage files, generate commit messages, and more. Conversation history is saved per-project.' },

  // === Refs ===
  { path: '/branches', label: 'Branches', icon: GitBranch, group: 'Refs',
    description: 'Create, checkout, merge, rename, and delete branches. Drag a branch onto another to merge. Ctrl+click to filter History. Right-click for worktree actions.' },
  { path: '/tags', label: 'Tags', icon: Tag, group: 'Refs',
    description: 'Create lightweight or annotated tags. Click a tag to jump to its commit in History.' },
  { path: '/remotes', label: 'Remotes', icon: CloudDownload, group: 'Refs',
    description: 'Add, remove, and rename remotes. Edit fetch/push URLs. Fetch from all remotes or preview remote refs.' },
  { path: '/reflog', label: 'Reflog', icon: RotateCcw, group: 'Refs',
    description: 'Reference log for HEAD and other refs. Shows every checkout, commit, merge, reset. Cherry-pick or reset to any entry.' },
  { path: '/recyclable', label: 'Recyclable', icon: Recycle, group: 'Refs',
    description: 'Unreachable reflog commits eligible for GC (default retention: 90 days). Recover by cherry-pick or branch creation, or expire them.' },
  { path: '/stashes', label: 'Stashes', icon: GitPullRequest, group: 'Refs',
    description: 'Saved stashes. Click a stash to view its diff (compared to its parent, not HEAD). Apply, pop, or drop.' },
  { path: '/submodules', label: 'Submodules', icon: Package, group: 'Refs',
    description: 'Manage git submodules: init, update, sync. View submodule status and commit hashes.' },
  { path: '/lfs', label: 'Git LFS', icon: Package, group: 'Refs',
    description: 'Large File Storage management. Track patterns, pull/push LFS objects, manage file locks, view tracked files with sizes.' },
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
  '/reflog': 'Ctrl+8',
  '/search': 'Ctrl+9',
};

/** Map path → description for pages that have one. */
export const NAV_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.filter((item) => item.description).map((item) => [item.path, item.description!])
);
