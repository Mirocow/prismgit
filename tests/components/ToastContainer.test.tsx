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

describe('commit hash chip (Task 29: «В тоасте Коммит создан не отображается хеш комита»)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.clearAllTimers?.();
  });

  it('successCommit stores the hash and the longer 8s duration', () => {
    useToastStore.getState().successCommit('Коммит создан', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    const toast = useToastStore.getState().toasts[0];
    expect(toast.hash).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    expect(toast.type).toBe('success');
    expect(toast.duration).toBe(8000);
  });

  it('renders the short hash as a copyable chip next to the title', () => {
    useToastStore.getState().successCommit('Коммит создан', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0');
    render(<ToastContainer />);
    // shortHash default = 7 chars
    const chip = screen.getByText('a1b2c3d');
    expect(chip).toBeInTheDocument();
    expect(chip.closest('button')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0')
    );
  });

  it('does not render a chip for plain success toasts', () => {
    useToastStore.getState().success('Operation succeeded');
    render(<ToastContainer />);
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('copies the FULL hash when the chip is clicked', () => {
    const FULL = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: clipboardSpy } });
    useToastStore.getState().successCommit('Коммит создан', FULL);
    render(<ToastContainer />);
    fireEvent.click(screen.getByText('a1b2c3d'));
    expect(clipboardSpy).toHaveBeenCalledWith(FULL);
  });
});
