import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from '../../src/components/ToastContainer';
import { useToastStore } from '../../src/stores/toastStore';

describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders nothing when no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders success toast', () => {
    useToastStore.getState().success('Operation succeeded');
    render(<ToastContainer />);
    expect(screen.getByText('Operation succeeded')).toBeInTheDocument();
  });

  it('renders error toast with detail', () => {
    useToastStore.getState().error('Operation failed', 'Detailed error');
    render(<ToastContainer />);
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
    expect(screen.getByText('Detailed error')).toBeInTheDocument();
  });

  it('renders warning toast', () => {
    useToastStore.getState().warning('Be careful');
    render(<ToastContainer />);
    expect(screen.getByText('Be careful')).toBeInTheDocument();
  });

  it('renders info toast', () => {
    useToastStore.getState().info('Information');
    render(<ToastContainer />);
    expect(screen.getByText('Information')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    useToastStore.getState().success('First');
    useToastStore.getState().error('Second');
    render(<ToastContainer />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('dismisses toast on X click', () => {
    useToastStore.getState().success('Dismissible');
    render(<ToastContainer />);
    expect(screen.getByText('Dismissible')).toBeInTheDocument();

    // Find and click the dismiss button
    const dismissButton = screen.getByRole('button');
    fireEvent.click(dismissButton);

    expect(screen.queryByText('Dismissible')).not.toBeInTheDocument();
  });
});

describe('toast error detail humanization', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('strips repeated "Error:" prefixes and stack frames', () => {
    useToastStore.getState().error('Push failed', 'Error: Error: push rejected\n    at IpcMain (electron/js2c)');
    const toast = useToastStore.getState().toasts[0];
    expect(toast.detail).toBe('Push rejected');
  });

  it('leaves plain multi-line git output readable', () => {
    const detail = 'To http://x/y.git\n ! [rejected] main -> main (fetch first)';
    useToastStore.getState().error('Push failed', detail);
    expect(useToastStore.getState().toasts[0].detail).toBe(detail);
  });
});
