/**
 * Smart Views — preset filters for Graph view (SmartGit 24 feature)
 */

export interface SmartView {
  id: string;
  label: string;
  description: string;
  filter: {
    branch?: string;
    author?: string;
    path?: string;
    message?: string;
    since?: string;
    until?: string;
    limit?: number;
    showAll?: boolean;
    showRemote?: boolean;
    showStashes?: boolean;
    showTags?: boolean;
  };
}

export const SMART_VIEWS: SmartView[] = [
  {
    id: 'all',
    label: 'All Commits',
    description: 'Show all commits from all branches',
    filter: { showAll: true, limit: 500 },
  },
  {
    id: 'current-branch',
    label: 'Current Branch',
    description: 'Commits on the current branch only',
    filter: { limit: 200 },
  },
  {
    id: 'my-commits',
    label: 'My Commits',
    description: 'Commits authored by you',
    filter: { author: 'me', limit: 200 },
  },
  {
    id: 'recent',
    label: 'Recent (7 days)',
    description: 'Commits from the last 7 days',
    filter: { since: '7 days ago', limit: 200 },
  },
  {
    id: 'unpushed',
    label: 'Unpushed',
    description: 'Commits not yet pushed to remote',
    filter: { limit: 100 },
  },
  {
    id: 'merged',
    label: 'Merged',
    description: 'Merge commits only',
    filter: { message: '^Merge', limit: 100 },
  },
  {
    id: 'with-tags',
    label: 'Tagged Commits',
    description: 'Commits that have tags',
    filter: { showTags: true, limit: 100 },
  },
  {
    id: 'file-history',
    label: 'File History',
    description: 'Commits touching a specific file (set path filter)',
    filter: { path: '', limit: 200 },
  },
];

export function getSmartViewById(id: string): SmartView | undefined {
  return SMART_VIEWS.find(v => v.id === id);
}

export function applySmartView(view: SmartView, baseFilter: Record<string, unknown>): Record<string, unknown> {
  return { ...baseFilter, ...view.filter };
}
