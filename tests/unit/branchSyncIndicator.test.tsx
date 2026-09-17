/**
 * Tests for the BranchSyncIndicator component — the reusable plug
 * connected/disconnected indicator shared across all branch views
 * (BranchesPage row, HistoryPage picker, RefActionDialog, GlobalSearch).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BranchSyncIndicator,
} from '../../src/components/BranchSyncIndicator';

describe('BranchSyncIndicator', () => {
  it('renders nothing for remote branches (no sync concept)', () => {
    const { container } = render(
      <BranchSyncIndicator remote={true} tracking="origin/main" ahead={0} behind={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a dimmed disconnected plug for local branches with no tracking', () => {
    const { container } = render(
      <BranchSyncIndicator tracking={null} remote={false} />,
    );
    expect(container.querySelector('[role="img"]')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('title')).toContain('No upstream');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('No upstream');
  });

  it('renders a warning disconnected plug when gone=true', () => {
    render(<BranchSyncIndicator tracking="origin/main" gone={true} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('Upstream gone');
    expect(wrapper.getAttribute('title')).toContain('deleted');
  });

  it('renders a connected plug when in sync (ahead=0, behind=0)', () => {
    render(<BranchSyncIndicator tracking="origin/main" ahead={0} behind={0} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('In sync');
    expect(wrapper.getAttribute('title')).toContain('In sync');
    expect(wrapper.getAttribute('title')).toContain('origin/main');
  });

  it('renders a disconnected plug with "Out of sync" when ahead>0', () => {
    render(<BranchSyncIndicator tracking="origin/main" ahead={5} behind={0} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('Out of sync');
    expect(wrapper.getAttribute('title')).toContain('5 ahead');
  });

  it('renders a disconnected plug with "Out of sync" when behind>0', () => {
    render(<BranchSyncIndicator tracking="origin/main" ahead={0} behind={3} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('Out of sync');
    expect(wrapper.getAttribute('title')).toContain('3 behind');
  });

  it('renders a disconnected plug with both ahead and behind counts', () => {
    render(<BranchSyncIndicator tracking="origin/main" ahead={2} behind={1} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('title')).toContain('2 ahead');
    expect(wrapper.getAttribute('title')).toContain('1 behind');
  });

  it('treats undefined ahead/behind as 0 (in sync if tracking exists)', () => {
    render(<BranchSyncIndicator tracking="origin/main" />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('In sync');
  });

  it('renders without crashing for all combinations', () => {
    expect(() => render(<BranchSyncIndicator tracking="origin/main" ahead={0} behind={0} />)).not.toThrow();
    expect(() => render(<BranchSyncIndicator tracking="origin/main" ahead={5} behind={0} />)).not.toThrow();
    expect(() => render(<BranchSyncIndicator tracking="origin/main" gone={true} />)).not.toThrow();
    expect(() => render(<BranchSyncIndicator tracking={null} />)).not.toThrow();
    expect(() => render(<BranchSyncIndicator remote={true} />)).not.toThrow();
  });

  // ── `upstream` prop — used by non-current branches ────────────────────
  // branches() sets `tracking` only on the CURRENT branch (from git status)
  // and `upstream` on non-current branches (from for-each-ref). The indicator
  // must accept BOTH and use whichever is set — otherwise every non-current
  // branch with an upstream would show the dimmed "No upstream" plug.

  it('uses `upstream` when `tracking` is undefined (non-current branch)', () => {
    render(<BranchSyncIndicator upstream="origin/feature/x" ahead={0} behind={0} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('In sync');
    expect(wrapper.getAttribute('title')).toContain('origin/feature/x');
  });

  it('uses `upstream` for ahead state when tracking is undefined', () => {
    render(<BranchSyncIndicator upstream="origin/feature/x" ahead={3} behind={0} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('Out of sync');
    expect(wrapper.getAttribute('title')).toContain('3 ahead');
    expect(wrapper.getAttribute('title')).toContain('origin/feature/x');
  });

  it('uses `upstream` for behind state when tracking is undefined', () => {
    render(<BranchSyncIndicator upstream="origin/feature/x" ahead={0} behind={2} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('Out of sync');
    expect(wrapper.getAttribute('title')).toContain('2 behind');
  });

  it('uses `upstream` for gone state when tracking is undefined', () => {
    render(<BranchSyncIndicator upstream="origin/feature/x" gone={true} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('aria-label')).toBe('Upstream gone');
  });

  it('prefers `tracking` when both `tracking` and `upstream` are set', () => {
    render(
      <BranchSyncIndicator
        tracking="origin/tracking-ref"
        upstream="origin/upstream-ref"
        ahead={0}
        behind={0}
      />,
    );
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('title')).toContain('origin/tracking-ref');
    expect(wrapper.getAttribute('title')).not.toContain('origin/upstream-ref');
  });

  it('shows "No upstream" only when BOTH `tracking` and `upstream` are undefined', () => {
    // tracking=undefined, upstream=undefined → "No upstream"
    render(<BranchSyncIndicator />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('No upstream');
  });

  it('does NOT show "No upstream" when only `upstream` is set', () => {
    // tracking=undefined, upstream="origin/foo" → NOT "No upstream"
    render(<BranchSyncIndicator upstream="origin/foo" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toBe('No upstream');
  });
});
