import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CherryPickStateBanner } from '../../src/components/CherryPickStateBanner';

// Pure component: everything comes via props — no API / store mocks needed.

const onContinue = vi.fn();
const onSkip = vi.fn();
const onCommitEmpty = vi.fn();
const onAbort = vi.fn();

function renderBanner(overrides: Partial<Parameters<typeof CherryPickStateBanner>[0]> = {}) {
  const props = {
    commit: '8962174c9225524cd57921f1150428aead800f21',
    subject: 'feat: recyclable page',
    empty: false,
    onContinue,
    onSkip,
    onCommitEmpty,
    onAbort,
    ...overrides,
  };
  return render(<CherryPickStateBanner {...props} />);
}

describe('CherryPickStateBanner — "The working tree is in cherry-picking-state."', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the SmartGit state message with the picked commit (short hash + subject)', () => {
    renderBanner();
    expect(screen.getByTestId('cherry-pick-banner')).toHaveTextContent(
      'The working tree is in cherry-picking-state.'
    );
    expect(screen.getByTestId('cherry-pick-commit')).toHaveTextContent('8962174');
    expect(screen.getByTestId('cherry-pick-commit')).toHaveTextContent('feat: recyclable page');
  });

  it('offers Continue / Skip / Abort but NOT Commit Empty for a normal pick', () => {
    renderBanner({ empty: false });
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Commit Empty' })).toBeNull();
    // git hint about empty pick is hidden too
    expect(screen.queryByTestId('cherry-pick-empty-hint')).toBeNull();
  });

  it('shows the empty-pick hint + Commit Empty action when the pick is empty', () => {
    renderBanner({ empty: true });
    expect(screen.getByTestId('cherry-pick-empty-hint')).toHaveTextContent(
      'The previous cherry-pick is now empty'
    );
    expect(screen.getByRole('button', { name: 'Commit Empty' })).toBeTruthy();
  });

  it('dispatches the matching callbacks when actions are clicked', () => {
    renderBanner({ empty: true });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Commit Empty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abort' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onCommitEmpty).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('disables all actions while an operation is busy', () => {
    renderBanner({ busy: true, empty: true });
    for (const name of ['Continue', 'Commit Empty', 'Skip', 'Abort']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('handles a missing subject gracefully (detached/mid-cleanup state)', () => {
    renderBanner({ subject: '' });
    expect(screen.getByTestId('cherry-pick-commit').textContent).not.toContain('— “');
  });
});
