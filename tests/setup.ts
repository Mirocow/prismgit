import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.smartgit API for renderer tests
const mockApi = {
  git: {
    status: vi.fn(),
    add: vi.fn(),
    addAll: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
    fetch: vi.fn(),
    log: vi.fn(),
    branches: vi.fn(),
    checkout: vi.fn(),
    diff: vi.fn(),
    raw: vi.fn(),
    isRepo: vi.fn(),
    extractRepoInfo: vi.fn(),
    revealInFileManager: vi.fn(),
    openFile: vi.fn(),
  },
  fs: {
    openDirectoryPicker: vi.fn(),
    openRepositoryPicker: vi.fn(),
    readFile: vi.fn(),
    pathBasename: vi.fn(),
    pathDirname: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(),
    getRepos: vi.fn(),
    addRepo: vi.fn(),
    removeRepo: vi.fn(),
    updateRepo: vi.fn(),
  },
  github: {
    authWithPAT: vi.fn(),
    getAuthState: vi.fn(),
    getRepositories: vi.fn(),
    listPullRequests: vi.fn(),
    createPullRequest: vi.fn(),
    logout: vi.fn(),
  },
  app: {
    getVersion: vi.fn().mockResolvedValue('4.0.0'),
    getPlatform: vi.fn().mockResolvedValue('linux'),
    openExternal: vi.fn(),
  },
  watcher: {
    start: vi.fn(),
    stop: vi.fn(),
    onChanged: vi.fn(() => () => {}),
  },
  contextMenu: {
    show: vi.fn(),
    onClick: vi.fn(() => () => {}),
  },
  clipboard: {
    writeText: vi.fn(),
  },
  events: {
    on: vi.fn(() => () => {}),
    off: vi.fn(),
  },
  window: {
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(),
    onMaximizeChange: vi.fn(() => () => {}),
  },
};

Object.defineProperty(window, 'smartgit', {
  value: mockApi,
  writable: true,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value.toString(); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn(),
    readText: vi.fn(),
  },
  writable: true,
});
