import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BranchTrackingIndicator } from '../../src/components/BranchTrackingIndicator';

describe('Task 6 BranchTrackingIndicator', () => {
  it('renders an SVG with role=img', () => {
    const { container } = render(<BranchTrackingIndicator tracking={true} upstreamName="origin/main" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    const wrapper = container.querySelector('[role="img"]');
    expect(wrapper).toBeTruthy();
  });

  it('shows tracking tooltip when tracking=true', () => {
    render(<BranchTrackingIndicator tracking={true} upstreamName="origin/main" />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('title')).toContain('Tracking origin/main');
  });

  it('shows no-upstream tooltip when tracking=false', () => {
    render(<BranchTrackingIndicator tracking={false} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('title')).toContain('No upstream');
    expect(wrapper.getAttribute('title')).toContain('push -u');
  });

  it('defaults to tracking=origin/remote when upstreamName omitted but tracking=true', () => {
    render(<BranchTrackingIndicator tracking={true} />);
    const wrapper = screen.getByRole('img');
    expect(wrapper.getAttribute('title')).toContain('Tracking remote');
  });

  it('renders without crashing for both tracking states', () => {
    expect(() => render(<BranchTrackingIndicator tracking={true} />)).not.toThrow();
    expect(() => render(<BranchTrackingIndicator tracking={false} />)).not.toThrow();
  });
});
