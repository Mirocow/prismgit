import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PushToDialog } from '../../src/components/BranchDialogs';

// Pure component: no API / store mocks needed — everything comes via props.

const submit = vi.fn();
const close = vi.fn();

function open(overrides: Partial<Parameters<typeof PushToDialog>[0]> = {}) {
  const props = {
    branchName: 'feature/auth',
    remotes: ['origin', 'mirror'],
    defaultRemote: 'origin',
    remoteBranches: ['origin/main', 'origin/develop', 'mirror/release'],
    hasUpstream: false,
    onSubmit: submit,
    onClose: close,
    ...overrides,
  };
  return render(<PushToDialog {...props} />);
}

describe('PushToDialog — "Push To..." remote + target branch choice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the target branch with the local name and preselects the default remote', () => {
    open();
    const select = screen.getByLabelText('Remote repository') as HTMLSelectElement;
    expect(select.value).toBe('origin');
    expect(select).toHaveTextContent('origin');
    expect(select).toHaveTextContent('mirror');

    const target = screen.getByLabelText('Target branch') as HTMLInputElement;
    expect(target.value).toBe('feature/auth');

    // New branch without upstream → "-u" pre-checked, force not
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(true); // Set upstream tracking (-u)
    expect(checkboxes[1].checked).toBe(false); // Force push
  });

  it('leaves -u unchecked when the branch already has an upstream', () => {
    open({ hasUpstream: true });
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(false);
  });

  it('submits remote + target + flags (same-name push)', () => {
    open({ hasUpstream: true });
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({
      remote: 'origin',
      targetBranch: 'feature/auth',
      setUpstream: false,
      force: false,
    });
  });

  it('lets the user pick another remote and another target branch (refspec local:target)', () => {
    open({ hasUpstream: true });
    fireEvent.change(screen.getByLabelText('Remote repository'), { target: { value: 'mirror' } });
    fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'main' } });
    // preview shows the full refspec
    expect(screen.getByTestId('push-to-cmd')).toHaveTextContent('git push mirror feature/auth:main');
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(submit).toHaveBeenCalledWith({
      remote: 'mirror',
      targetBranch: 'main',
      setUpstream: false,
      force: false,
    });
  });

  it('passes the force flag through to onSubmit', () => {
    open({ hasUpstream: true });
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByTestId('push-to-cmd')).toHaveTextContent('--force-with-lease');
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ force: true })
    );
  });

  it('blocks submission with an empty or invalid target branch', () => {
    open();
    fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: '   ' } });
    expect(screen.getByText('Target branch is required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(submit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'bad..name' } });
    expect(screen.getByText('Branch name contains invalid characters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(submit).not.toHaveBeenCalled();
  });

  it('suggests only branches of the selected remote as target candidates', () => {
    open();
    const datalist = document.getElementById('push-to-target-suggestions');
    expect(datalist).not.toBeNull();
    const options = Array.from(datalist!.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['main', 'develop']);

    // Switch the remote → suggestions switch to that remote's branches
    fireEvent.change(screen.getByLabelText('Remote repository'), { target: { value: 'mirror' } });
    const options2 = Array.from(datalist!.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options2).toEqual(['release']);
  });

  it('falls back to a free-text remote name input when no remotes are configured', () => {
    open({ remotes: [], defaultRemote: '' });
    const input = screen.getByPlaceholderText('origin') as HTMLInputElement;
    expect(input.value).toBe('origin');
    fireEvent.change(input, { target: { value: 'upstream' } });
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ remote: 'upstream' })
    );
  });

  it('calls onClose on Cancel and disables the Push button while busy', () => {
    const { unmount } = open({ busy: true });
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled();
    unmount();

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
