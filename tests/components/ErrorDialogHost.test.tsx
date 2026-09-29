/**
 * ErrorDialogHost — the store-driven centered error modal.
 *
 * User report: «При переключении на Remote ветку словил сообщение а не
 * диалоговое окно: Error: Не удалось переключить ветку Error invoking
 * remote method 'git:checkout': ...» — action failures are dialogs now.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDialogHost } from '../../src/components/ErrorDialogHost';
import { useErrorDialogStore } from '../../src/stores/errorDialogStore';

describe('ErrorDialogHost', () => {
  beforeEach(() => {
    useErrorDialogStore.setState({ open: false, title: '', message: '', detail: '' });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ErrorDialogHost />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title + message + detail after show()', () => {
    useErrorDialogStore.getState().show({
      title: 'Не удалось переключить ветку',
      message: 'git checkout failed',
      detail: "Error invoking remote method 'git:checkout': Error: fatal: a branch named 'main' already exists",
    });
    render(<ErrorDialogHost />);
    expect(screen.getByTestId('error-dialog-title').textContent).toBe('Не удалось переключить ветку');
    expect(screen.getByTestId('error-dialog-message').textContent).toBe('git checkout failed');
    // The Electron IPC boilerplate prefix is stripped for humans.
    expect(screen.getByTestId('error-dialog-detail').textContent).toContain("fatal: a branch named 'main' already exists");
    expect(screen.getByTestId('error-dialog-detail').textContent).not.toContain('Error invoking remote method');
  });

  it('flattens repeated Error: prefixes in the detail', () => {
    useErrorDialogStore.getState().show({ title: 'T', detail: 'Error: Error: push failed' });
    render(<ErrorDialogHost />);
    expect(screen.getByTestId('error-dialog-detail').textContent).toBe('Push failed');
  });

  it('hides the details block when there is no detail', () => {
    useErrorDialogStore.getState().show({ title: 'Just a title' });
    render(<ErrorDialogHost />);
    expect(screen.queryByTestId('error-dialog-detail')).not.toBeInTheDocument();
  });

  it('closes on the Close button', () => {
    useErrorDialogStore.getState().show({ title: 'T', detail: 'd' });
    render(<ErrorDialogHost />);
    fireEvent.click(screen.getByTestId('error-dialog-close'));
    expect(useErrorDialogStore.getState().open).toBe(false);
  });

  it('closes on Escape', () => {
    useErrorDialogStore.getState().show({ title: 'T', detail: 'd' });
    render(<ErrorDialogHost />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useErrorDialogStore.getState().open).toBe(false);
  });

  it('collapses long multi-line detail behind the details toggle', () => {
    useErrorDialogStore.getState().show({
      title: 'T',
      detail: 'first line\nsecond line\nthird line',
    });
    render(<ErrorDialogHost />);
    expect(screen.queryByTestId('error-dialog-detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('error-dialog-details-toggle'));
    expect(screen.getByTestId('error-dialog-detail')).toBeInTheDocument();
  });
});
