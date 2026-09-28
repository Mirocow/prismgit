import { GitBranch, GitCommit, GitPullRequest, History, Tag, Package, RotateCcw, FileText, Search, Filter, Recycle, Sparkles } from './icons';
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
 * Task 29 — REMOVED:
 *   - Remotes → merged into Branches. The Branches page already had the
 *     per-remote groups with fetch/configure/rename/remove/properties
 *     context menus; it now also owns "Fetch All (prune)" and the
 *     Add-Remote entry point (header button + menu:remoteAdd event).
 *     A separate Remotes tool duplicated that surface with a second
 *     mental model — one ref view is enough.
 *
 * NOTE: labels and descriptions are translated via the standalone `t()`
 * function from `../lib/i18n`. They are evaluated on EVERY navItems() call
 * (per render), so the sidebar / command palette / help banner follow the
 * active locale immediately — including the async initLocaleFromSettings()
 * restore at startup. Before this, the labels were frozen at module-load
 * time and a RU-profile first launch showed an ENGLISH sidebar until a
 * manual refresh (caught by the counters E2E — aria-label="Changes" while
 * every page header was already «Изменения»).
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

/**
 * Fresh nav model for the CURRENT locale — call inside render (consumers all
 * subscribe via useI18n(), so a locale change re-renders and re-evaluates).
 * Do NOT cache the result in a module-level variable: that re-freezes it.
 */
export function navItems(): NavItem[] {
  return [
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
}

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
  '/reflog': 'Ctrl+8',
  '/search': 'Ctrl+9',
};

/** Map path → description (current locale) for pages that have one. */
export function navDescriptions(): Record<string, string> {
  const items = navItems();
  return Object.fromEntries(
    items.filter((item) => item.description).map((item) => [item.path, item.description!])
  );
}
