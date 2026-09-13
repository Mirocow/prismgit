import { GitBranch, GitCommit, GitPullRequest, History, Tag, Package, RotateCcw, FileText, Search, CloudDownload, Filter, Recycle, Sparkles } from './icons';
import { t } from '../lib/i18n';

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
 *
 * NOTE: labels and descriptions are translated via the standalone `t()`
 * function from `../lib/i18n`. They are evaluated at module-load time
 * using the locale selected on app startup (saved in localStorage or
 * detected from navigator.language). If the user switches locale at
 * runtime via Settings, a refresh is required to update the nav labels.
 */
export interface NavItem {
  path: string;
  label: string;
  icon: typeof GitBranch;
  group: string;
  /** Short description shown as a help banner at the top of the page. */
  description?: string;
}

const GROUP_WORKING_TREE = () => t('nav.group.workingTree');
const GROUP_WORKFLOWS = () => t('nav.group.workflows');
const GROUP_AI = () => t('nav.group.ai');
const GROUP_REFS = () => t('nav.group.refs');

export const NAV_ITEMS: NavItem[] = [
  // === Working Tree ===
  { path: '/changes', label: t('nav.label.changes'), icon: GitCommit, group: GROUP_WORKING_TREE(),
    description: t('nav.desc.changes') },
  { path: '/history', label: t('nav.label.history'), icon: History, group: GROUP_WORKING_TREE(),
    description: t('nav.desc.history') },
  { path: '/diff', label: t('nav.label.diff'), icon: FileText, group: GROUP_WORKING_TREE(),
    description: t('nav.desc.diff') },
  { path: '/search', label: t('nav.label.search'), icon: Search, group: GROUP_WORKING_TREE(),
    description: t('nav.desc.search') },
  { path: '/blame', icon: FileText, label: t('nav.label.blame'), group: GROUP_WORKING_TREE(),
    description: t('nav.desc.blame') },

  // === Workflows ===
  { path: '/gitflow', label: t('nav.label.gitflow'), icon: GitBranch, group: GROUP_WORKFLOWS(),
    description: t('nav.desc.gitflow') },
  { path: '/bisect', label: t('nav.label.bisect'), icon: Filter, group: GROUP_WORKFLOWS(),
    description: t('nav.desc.bisect') },
  { path: '/pulls', label: t('nav.label.pulls'), icon: GitPullRequest, group: GROUP_WORKFLOWS(),
    description: t('nav.desc.pulls') },
  { path: '/reviews', label: t('nav.label.reviews'), icon: GitPullRequest, group: GROUP_WORKFLOWS(),
    description: t('nav.desc.reviews') },

  // === AI ===
  { path: '/ai-chat', label: t('nav.label.aiChat'), icon: Sparkles, group: GROUP_AI(),
    description: t('nav.desc.aiChat') },

  // === Refs ===
  { path: '/branches', label: t('nav.label.branches'), icon: GitBranch, group: GROUP_REFS(),
    description: t('nav.desc.branches') },
  { path: '/tags', label: t('nav.label.tags'), icon: Tag, group: GROUP_REFS(),
    description: t('nav.desc.tags') },
  { path: '/remotes', label: t('nav.label.remotes'), icon: CloudDownload, group: GROUP_REFS(),
    description: t('nav.desc.remotes') },
  { path: '/reflog', label: t('nav.label.reflog'), icon: RotateCcw, group: GROUP_REFS(),
    description: t('nav.desc.reflog') },
  { path: '/recyclable', label: t('nav.label.recyclable'), icon: Recycle, group: GROUP_REFS(),
    description: t('nav.desc.recyclable') },
  { path: '/stashes', label: t('nav.label.stashes'), icon: GitPullRequest, group: GROUP_REFS(),
    description: t('nav.desc.stashes') },
  { path: '/submodules', label: t('nav.label.submodules'), icon: Package, group: GROUP_REFS(),
    description: t('nav.desc.submodules') },
  { path: '/lfs', label: t('nav.label.lfs'), icon: Package, group: GROUP_REFS(),
    description: t('nav.desc.lfs') },
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
