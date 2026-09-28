import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from '../../src/stores/toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('show', () => {
    it('adds a toast to the list', () => {
      useToastStore.getState().show('success', 'Test message');

      const state = useToastStore.getState();
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].type).toBe('success');
      expect(state.toasts[0].message).toBe('Test message');
    });

    it('generates unique IDs', () => {
      useToastStore.getState().show('info', 'First');
      useToastStore.getState().show('info', 'Second');

      const state = useToastStore.getState();
      expect(state.toasts).toHaveLength(2);
      expect(state.toasts[0].id).not.toBe(state.toasts[1].id);
    });

    it('accepts detail', () => {
      useToastStore.getState().show('error', 'Error', 'Detailed error message');

      const state = useToastStore.getState();
      expect(state.toasts[0].detail).toBe('Detailed error message');
    });

    it('auto-dismisses after duration', () => {
      useToastStore.getState().show('info', 'Will disappear', undefined, 3000);

      expect(useToastStore.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(3000);

      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('does not auto-dismiss when duration is 0', () => {
      useToastStore.getState().show('info', 'Persistent', undefined, 0);

      vi.advanceTimersByTime(10000);

      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('dismiss', () => {
    it('removes toast by id', () => {
      useToastStore.getState().show('info', 'Toast 1');
      useToastStore.getState().show('info', 'Toast 2');

      const id = useToastStore.getState().toasts[0].id;
      useToastStore.getState().dismiss(id);

      const state = useToastStore.getState();
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].message).toBe('Toast 2');
    });

    it('does nothing for non-existent id', () => {
      useToastStore.getState().show('info', 'Toast');
      useToastStore.getState().dismiss(99999);

      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('convenience methods', () => {
    it('success creates success toast', () => {
      useToastStore.getState().success('Success!');
      expect(useToastStore.getState().toasts[0].type).toBe('success');
    });

    it('error creates error toast', () => {
      useToastStore.getState().error('Failed!');
      expect(useToastStore.getState().toasts[0].type).toBe('error');
    });

    it('info creates info toast', () => {
      useToastStore.getState().info('Info');
      expect(useToastStore.getState().toasts[0].type).toBe('info');
    });

    it('warning creates warning toast', () => {
      useToastStore.getState().warning('Warning');
      expect(useToastStore.getState().toasts[0].type).toBe('warning');
    });
  });

  // ── Flood protection (user report: >10 identical "Merge in progress"
  //    toasts on one screen after switching Diff → Branches mid-merge). ──
  describe('flood protection', () => {
    it('replaces an identical toast shown within the dedupe window (no stacking)', () => {
      for (let i = 0; i < 10; i++) {
        useToastStore.getState().error('Merge in progress', 'Finish it first on the Changes page');
      }
      const state = useToastStore.getState();
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0].message).toBe('Merge in progress');
    });

    it('keeps DIFFERENT messages (dedupe is content-based, not a global mute)', () => {
      useToastStore.getState().error('Merge in progress', 'hint A');
      useToastStore.getState().error('Merge in progress', 'hint B');
      useToastStore.getState().warning('Merge in progress', 'hint A'); // different type
      const state = useToastStore.getState();
      expect(state.toasts).toHaveLength(3);
    });

    it('stacks again after the dedupe window has elapsed', () => {
      useToastStore.getState().show('error', 'Merge in progress', undefined, 6000);
      // Simulate the window passing: age the existing toast beyond 2s.
      const aged = useToastStore.getState().toasts[0];
      useToastStore.setState({
        toasts: [{ ...aged, shownAt: aged.shownAt - 5_000 }],
      });
      useToastStore.getState().show('error', 'Merge in progress', undefined, 6000);
      expect(useToastStore.getState().toasts).toHaveLength(2);
    });

    it('caps concurrent toasts at 5, dropping the OLDEST', () => {
      for (let i = 0; i < 8; i++) {
        useToastStore.getState().show('info', `Message ${i}`);
      }
      const state = useToastStore.getState();
      expect(state.toasts).toHaveLength(5);
      // The newest five survive; the oldest three are dropped.
      expect(state.toasts[0].message).toBe('Message 3');
      expect(state.toasts[4].message).toBe('Message 7');
    });
  });
});
