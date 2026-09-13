import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../../src/components/EmptyState';

vi.mock('../../src/lib/i18n', () => ({ useI18n: () => ({ t: (k: string) => k, locale: 'en' }) }));

describe('MED-1 EmptyState component', () => {
  it('renders the title', () => {
    render(<EmptyState title="No items" />);
    expect(screen.getByText('No items')).toBeTruthy();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="Empty" description="Some hint" />);
    expect(screen.getByText('Empty')).toBeTruthy();
    expect(screen.getByText('Some hint')).toBeTruthy();
  });

  it('does not render a description node when description is omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const desc = container.querySelector('.empty-state-desc');
    expect(desc).toBeNull();
  });

  it('renders the action button when action is provided', () => {
    const action = { label: 'Create', onClick: () => {} };
    render(<EmptyState title="Empty" action={action} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });

  it('does not render an action button when action is omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const action = container.querySelector('.empty-state-action');
    expect(action).toBeNull();
  });

  it('fires the action onClick handler', () => {
    const onClick = vi.fn();
    const action = { label: 'Create', onClick };
    render(<EmptyState title="Empty" action={action} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the action button when action.disabled is true', () => {
    const action = { label: 'Create', onClick: () => {}, disabled: true };
    render(<EmptyState title="Empty" action={action} />);
    expect(screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders an icon when one is provided', () => {
    const Icon = (props: { size?: number; className?: string }) => (
      <svg data-testid="custom-icon" width={props.size} className={props.className} />
    );
    render(<EmptyState icon={Icon} title="Empty" />);
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
  });

  it('does not render an icon when icon is omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const icon = container.querySelector('.empty-state-icon');
    expect(icon).toBeNull();
  });

  it('applies the compact class when compact=true', () => {
    const { container } = render(<EmptyState title="Empty" compact />);
    const root = container.querySelector('.empty-state');
    expect(root?.className).toContain('!py-8');
  });

  it('adds role=status for screen-reader announcement', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });
});
