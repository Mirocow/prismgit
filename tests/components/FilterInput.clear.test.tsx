/**
 * v3.8 — FilterInput clear affordance (the «фильтр застрял» fix).
 *
 * The user's report: History/branches filters felt stuck because the text
 * search stayed active with no visible reset. FilterInput now shows a ✕
 * while it has text; click AND Esc both reset it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterInput } from '../../src/components/FilterInput';

describe('FilterInput v3.8 — clear button', () => {
  it('shows ✕ only with text; click resets, Esc resets while text is present', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterInput value="" onChange={onChange} placeholder="filter" clearTitle="Сбросить" />,
    );
    expect(screen.queryByTitle('Сбросить')).toBeNull();
    // Type → ✕ appears; Esc resets.
    const input = screen.getByPlaceholderText('filter') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    rerender(<FilterInput value="abc" onChange={onChange} placeholder="filter" clearTitle="Сбросить" />);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith('');
    // With text again, the ✕ click also resets.
    fireEvent.change(input, { target: { value: 'zz' } });
    fireEvent.click(screen.getByTitle('Сбросить'));
    expect(onChange).toHaveBeenLastCalledWith('');
    // Typing ('abc', 'zz') + the two resets = 4 emissions, all ending cleared.
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('clear cancels a pending debounce (no late onChange with stale text)', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterInput value="" onChange={onChange} placeholder="f" debounceMs={250} />,
    );
    const input = screen.getByPlaceholderText('f');
    fireEvent.change(input, { target: { value: 'xx' } });
    vi.advanceTimersByTime(100); // debounce pending
    rerender(<FilterInput value="xx" onChange={onChange} placeholder="f" debounceMs={250} />);
    fireEvent.click(screen.getByRole('button')); // the ✕
    expect(onChange).toHaveBeenCalledWith('');
    onChange.mockClear();
    vi.advanceTimersByTime(500); // the original debounce would have fired here
    expect(onChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
