import type { ComponentType } from 'react';

/**
 * Reusable EmptyState — a single component for ALL empty-list placeholders.
 *
 * MED-1: empty states on different pages looked inconsistent (StashesPage
 * and TagsPage had a full `.empty-state` block with an icon + title +
 * description; BranchesPage rendered a single `<div>` with two words;
 * HistoryPage rendered "Loading..." or "No commits match" as plain text).
 *
 * This component wraps the existing `.empty-state` / `.empty-state-icon`
 * / `.empty-state-title` / `.empty-state-desc` / `.empty-state-action`
 * CSS classes so the visual look stays identical across every page,
 * and adds an optional primary action button.
 *
 * Usage:
 *   <EmptyState
 *     icon={GitBranch}
 *     title={t('branches.empty')}
 *     description={t('branches.emptyHint')}
 *     action={{ label: t('branches.newButton'), onClick: () => setShowNewDialog(true) }}
 *   />
 *
 * The `icon` prop accepts any component-shaped SVG icon from ./icons
 * (its props are inferred — typically accepts `size` and `className`).
 */
export interface EmptyStateProps {
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** Bold one-line title — required (otherwise the empty state is unhelpful). */
  title: string;
  /** Subtitle / hint — optional, max ~320px wide per CSS. */
  description?: string;
  /** Primary CTA button — optional. */
  action?: {
    label: string;
    onClick: () => void;
    /** Disable the CTA (e.g. when a git operation is in progress). */
    disabled?: boolean;
  };
  /** Compact mode (smaller padding) — for inline panels vs. full pages. */
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: EmptyStateProps) {
  return (
    <div className={compact ? 'empty-state !py-8' : 'empty-state'} role="status">
      {Icon && <Icon size={48} className="empty-state-icon" />}
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
      {action && (
        <div className="empty-state-action">
          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
