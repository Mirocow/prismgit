import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  type CapturedError,
  buildErrorReport,
  formatErrorStack,
  persistError,
  loadPersistedError,
  clearPersistedError,
} from '../../src/components/ErrorReportDialog';

// Mock localStorage for the persist/load/clear tests.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

describe('formatErrorStack', () => {
  it('formats an Error instance', () => {
    const err = new Error('test error');
    err.stack = 'Error: test error\n    at foo (bar.ts:1:1)';
    const result = formatErrorStack(err);
    expect(result.message).toBe('test error');
    expect(result.stack).toContain('test error');
    expect(result.stack).toContain('at foo');
  });

  it('formats a string reason', () => {
    const result = formatErrorStack('just a string');
    expect(result.message).toBe('just a string');
    expect(result.stack).toBe('just a string');
  });

  it('formats an object with a message property', () => {
    const result = formatErrorStack({ message: 'obj error', code: 42 });
    expect(result.message).toBe('obj error');
    expect(result.stack).toContain('obj error');
    expect(result.stack).toContain('42');
  });

  it('falls back to String() for unknown types', () => {
    const result = formatErrorStack(42);
    expect(result.message).toBe('42');
    expect(result.stack).toBe('42');
  });

  it('handles an Error with no stack', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    const result = formatErrorStack(err);
    expect(result.message).toBe('no stack');
    expect(result.stack).toContain('no stack');
  });
});

describe('buildErrorReport', () => {
  const sampleError: CapturedError = {
    id: 'render-123-abc',
    timestamp: 1700000000000,
    kind: 'render',
    message: 'Cannot read properties of undefined',
    stack: 'Error: Cannot read properties of undefined\n    at Component (App.tsx:42:5)',
    componentStack: '\n    in Component\n    in App',
    context: 'Render error boundary',
    appVersion: '2.1.0',
    userAgent: 'Mozilla/5.0',
    repoPath: '/home/user/repo',
  };

  it('includes the error message in the report', () => {
    const report = buildErrorReport(sampleError);
    expect(report).toContain('Cannot read properties of undefined');
  });

  it('includes the stack trace in the report', () => {
    const report = buildErrorReport(sampleError);
    expect(report).toContain('at Component (App.tsx:42:5)');
  });

  it('includes the component stack when present', () => {
    const report = buildErrorReport(sampleError);
    expect(report).toContain('in Component');
    expect(report).toContain('in App');
  });

  it('includes the timestamp as ISO string', () => {
    const report = buildErrorReport(sampleError);
    expect(report).toContain(new Date(1700000000000).toISOString());
  });

  it('includes the app version when present', () => {
    const report = buildErrorReport(sampleError);
    expect(report).toContain('2.1.0');
  });

  it('includes the repo path when present', () => {
    const report = buildErrorReport(sampleError);
    expect(report).toContain('/home/user/repo');
  });

  it('works without optional fields', () => {
    const minimal: CapturedError = {
      id: 'uncaught-1',
      timestamp: 1700000000000,
      kind: 'uncaught',
      message: 'oops',
      stack: 'oops',
    };
    const report = buildErrorReport(minimal);
    expect(report).toContain('oops');
    expect(report).not.toContain('App version');
    expect(report).not.toContain('Repository');
  });
});

describe('error persistence (localStorage)', () => {
  beforeEach(() => {
    // Replace global localStorage with the mock.
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    localStorageMock.clear();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  it('persists and loads an error', () => {
    const err: CapturedError = {
      id: 'test-1',
      timestamp: 1700000000000,
      kind: 'uncaught',
      message: 'test',
      stack: 'Error: test',
    };
    persistError(err);
    const loaded = loadPersistedError();
    expect(loaded).toEqual(err);
  });

  it('returns null when no error is persisted', () => {
    expect(loadPersistedError()).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    localStorageMock.setItem('prismgit-last-error', 'not json{');
    expect(loadPersistedError()).toBeNull();
  });

  it('returns null for a parsed object missing required fields', () => {
    localStorageMock.setItem('prismgit-last-error', JSON.stringify({ foo: 'bar' }));
    expect(loadPersistedError()).toBeNull();
  });

  it('clears the persisted error', () => {
    const err: CapturedError = {
      id: 'test-2',
      timestamp: 1700000000000,
      kind: 'uncaught',
      message: 'test',
      stack: 'Error: test',
    };
    persistError(err);
    expect(loadPersistedError()).not.toBeNull();
    clearPersistedError();
    expect(loadPersistedError()).toBeNull();
  });
});
