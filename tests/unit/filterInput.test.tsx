import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FilterInput } from '../../src/components/FilterInput';

describe('MED-2 FilterInput component', () => {
  it('renders an input with the given placeholder', () => {
    render(<FilterInput value="" onChange={() => {}} placeholder="Filter branches" />);
    expect(screen.getByPlaceholderText('Filter branches')).toBeTruthy();
  });

  it('displays the provided value', () => {
    render(<FilterInput value="feat" onChange={() => {}} placeholder="Filter" />);
    const input = screen.getByPlaceholderText('Filter') as HTMLInputElement;
    expect(input.value).toBe('feat');
  });

  it('calls onChange synchronously when debounceMs is 0 (default)', () => {
    const onChange = vi.fn();
    render(<FilterInput value="" onChange={onChange} placeholder="F" />);
    const input = screen.getByPlaceholderText('F');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('debounces onChange calls by the given delay', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterInput value="" onChange={onChange} placeholder="F" debounceMs={250} />);
    const input = screen.getByPlaceholderText('F');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    // Not yet called — debounce active.
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('abc');
    vi.useRealTimers();
  });

  it('renders the regex toggle button when onToggleRegex is provided', () => {
    const onToggle = vi.fn();
    render(
      <FilterInput
        value=""
        onChange={() => {}}
        placeholder="F"
        isRegex={false}
        onToggleRegex={onToggle}
        regexTitle="Toggle regex"
      />,
    );
    const button = screen.getByRole('button', { name: '.*' });
    expect(button).toBeTruthy();
    expect(button.getAttribute('title')).toBe('Toggle regex');
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('does NOT render the regex toggle when onToggleRegex is omitted', () => {
    const { container } = render(<FilterInput value="" onChange={() => {}} placeholder="F" />);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('calls onToggleRegex when the .* button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <FilterInput
        value=""
        onChange={() => {}}
        placeholder="F"
        isRegex={false}
        onToggleRegex={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '.*' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('marks the regex button as aria-pressed when isRegex is true', () => {
    render(
      <FilterInput
        value=""
        onChange={() => {}}
        placeholder="F"
        isRegex={true}
        onToggleRegex={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: '.*' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('applies the active class when isRegex is true', () => {
    const { container } = render(
      <FilterInput
        value=""
        onChange={() => {}}
        placeholder="F"
        isRegex={true}
        onToggleRegex={() => {}}
      />,
    );
    const button = container.querySelector('button');
    expect(button?.className).toContain('border-accent');
    expect(button?.className).toContain('bg-accent-muted');
  });

  it('syncs local state when parent value changes externally (clear button)', () => {
    const { rerender } = render(<FilterInput value="hello" onChange={() => {}} placeholder="F" />);
    const input = screen.getByPlaceholderText('F') as HTMLInputElement;
    expect(input.value).toBe('hello');
    // Parent clears the value.
    rerender(<FilterInput value="" onChange={() => {}} placeholder="F" />);
    expect(input.value).toBe('');
  });

  it('exposes the aria-label', () => {
    render(<FilterInput value="" onChange={() => {}} placeholder="F" ariaLabel="Filter branches by name" />);
    expect(screen.getByLabelText('Filter branches by name')).toBeTruthy();
  });
});
