import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from '../../src/components/ToastContainer';
import { useToastStore } from '../../src/stores/toastStore';

describe('A11Y-2 ToastContainer aria-live', () => {
  beforeEach(() => {
    // Clear toasts between tests.
    useToastStore.setState({ toasts: [] });
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an assertive region for error toasts', () => {
    useToastStore.getState().error('Push failed', 'remote rejected');
    render(<ToastContainer />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('renders an assertive region for warning toasts', () => {
    useToastStore.getState().warning('Rebase in progress');
    render(<ToastContainer />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
  });

  it('renders a polite status region for success toasts', () => {
    useToastStore.getState().success('Committed');
    render(<ToastContainer />);
    const status = screen.getByRole('status');
    expect(status).toBeTruthy();
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('renders a polite status region for info toasts', () => {
    useToastStore.getState().info('Up to date');
    render(<ToastContainer />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('prefixes toast text with severity for screen readers', () => {
    useToastStore.getState().error('Push failed');
    render(<ToastContainer />);
    // Severity prefix should appear in a sr-only span. Use a function
    // matcher because getByText's default matching is exact, and the
    // sr-only span's full text is just the prefix (no other content).
    const srOnly = screen.getByText((content, element) => {
      return element?.classList.contains('sr-only') === true && content.includes('Error');
    });
    expect(srOnly).toBeTruthy();
    // Visible toast message should still be present.
    expect(screen.getByText('Push failed')).toBeTruthy();
  });

  it('renders both regions when both severities are present', () => {
    useToastStore.getState().success('ok');
    useToastStore.getState().error('bad');
    render(<ToastContainer />);
    expect(screen.getAllByRole('alert').length + screen.getAllByRole('status').length).toBeGreaterThanOrEqual(2);
  });

  it('marks the icon as aria-hidden (icon is decorative; severity text carries the meaning)', () => {
    useToastStore.getState().info('hello');
    render(<ToastContainer />);
    const svg = document.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('dismiss button has accessible label', () => {
    useToastStore.getState().info('hello');
    render(<ToastContainer />);
    const button = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(button).toBeTruthy();
  });

  it('clicking dismiss removes the toast', () => {
    useToastStore.getState().info('hello');
    render(<ToastContainer />);
    expect(useToastStore.getState().toasts.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(useToastStore.getState().toasts.length).toBe(0);
  });
});
