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
});
