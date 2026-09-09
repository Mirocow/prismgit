# Testing

SmartGit Electron uses [Vitest](https://vitest.dev/) with [Testing Library](https://testing-library.com/) for testing.

## Test Structure

```
tests/
├── setup.ts                          # Global setup, mocks
├── unit/                             # Pure function tests
│   ├── utils.test.ts                 # cn, formatDate, status colors
│   ├── gitflow.test.ts               # Git-Flow engine
│   ├── conflictParser.test.ts        # Conflict marker parsing
│   ├── diffParser.test.ts            # Unified diff parsing
│   ├── languageDetection.test.ts     # File extension → language
│   ├── repositoryStore.test.ts       # Repository state management
│   ├── settingsStore.test.ts         # Settings + theme persistence
│   └── toastStore.test.ts            # Toast notifications
├── integration/                      # Service tests with mocks
│   └── gitService.test.ts            # Git operations via mocked simple-git
└── components/                       # React component tests
    ├── DiffViewer.test.tsx           # Diff rendering, view modes, selection
    ├── ToastContainer.test.tsx       # Toast display and dismissal
    └── WelcomeScreen.test.tsx        # Welcome screen content
```

## Running Tests

```bash
# Run all tests once
make test
# or: npm test

# Watch mode (re-runs on file change)
make test:watch
# or: npm run test:watch

# With coverage report
make test:coverage
# or: npm run test:coverage

# Interactive UI mode
make test:ui
# or: npm run test:ui
```

## Coverage

Coverage is configured in `vitest.config.ts` with thresholds:

| Metric | Threshold |
|--------|-----------|
| Statements | 60% |
| Branches | 50% |
| Functions | 60% |
| Lines | 60% |

Coverage includes:
- `src/lib/**` — utilities and business logic
- `src/stores/**` — Zustand stores
- `electron/services/**` — Git, GitHub, storage services

Coverage reports are written to `./coverage/` in text, JSON, HTML, and LCOV formats.

## Test Setup

### Global Setup (`tests/setup.ts`)

- Configures `@testing-library/jest-dom` matchers
- Mocks `window.smartgit` API for renderer tests
- Mocks `localStorage`, `matchMedia`, `IntersectionObserver`, `ResizeObserver`
- Mocks `navigator.clipboard`
- Cleans up after each test

### Mocking window.smartgit

All tests have access to a mocked `window.smartgit` API:

```typescript
// In tests, you can access mocks:
window.smartgit.git.status.mockResolvedValue({ ... });
window.smartgit.settings.getAll.mockResolvedValue({ theme: 'dark' });
```

## Writing Tests

### Unit Tests

Test pure functions in isolation:

```typescript
import { describe, it, expect } from 'vitest';
import { formatDate } from '../../src/lib/utils';

describe('formatDate', () => {
  it('formats "just now" for recent dates', () => {
    const now = new Date().toISOString();
    expect(formatDate(now)).toBe('just now');
  });

  it('formats minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatDate(date.toISOString())).toBe('5m ago');
  });
});
```

### Component Tests

Test React components with Testing Library:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiffViewer } from '../../src/components/DiffViewer';

describe('DiffViewer', () => {
  it('renders file path', () => {
    const diff = createMockDiff({ newPath: 'test.ts' });
    render(<DiffViewer diff={diff} />);
    expect(screen.getByText('test.ts')).toBeInTheDocument();
  });

  it('switches to split view', () => {
    const diff = createMockDiff();
    render(<DiffViewer diff={diff} />);
    fireEvent.click(screen.getByText('Split'));
    expect(screen.getAllByText('line1').length).toBeGreaterThan(0);
  });
});
```

### Store Tests

Test Zustand stores with mocked API:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('../../src/lib/api', () => ({
  api: { settings: { getAll: vi.fn(), set: vi.fn() } },
}));

import { api } from '../../src/lib/api';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ theme: 'dark', settings: {} });
  });

  it('loads settings from API', async () => {
    vi.mocked(api.settings.getAll).mockResolvedValue({ theme: 'light' });
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().theme).toBe('light');
  });
});
```

### Integration Tests

Test services with mocked external dependencies:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGit = { status: vi.fn(), add: vi.fn(), commit: vi.fn() };
vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGit),
  simpleGit: vi.fn(() => mockGit),
}));

import * as gitService from '../../electron/services/git';

describe('gitService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns structured status', async () => {
    mockGit.status.mockResolvedValue({
      not_added: [], conflicted: [], files: [],
      ahead: 0, behind: 0, current: 'main',
      isClean: () => true,
    });
    const result = await gitService.status('/repo');
    expect(result.current).toBe('main');
  });
});
```

## Test Categories

### Unit Tests (tests/unit/)

- **utils.test.ts** — `cn`, `formatDate`, `truncateMiddle`, `shortHash`, status color functions
- **gitflow.test.ts** — Git-Flow engine: `detectGitFlowConfig`, `startFeature`, `finishFeature`, `startRelease`, `finishRelease`, `startHotfix`, `finishHotfix`, `listFlowBranches`
- **conflictParser.test.ts** — `parseConflicts`, `buildResolvedContent`, `hasConflicts`, `countConflicts`
- **diffParser.test.ts** — `parseDiff`, `countDiffStats`, `isBinaryDiff`
- **languageDetection.test.ts** — file extension to language mapping for syntax highlighting
- **repositoryStore.test.ts** — `loadRepos`, `openRepository`, `closeRepository`, `removeRepo`
- **settingsStore.test.ts** — `loadSettings`, `setSetting`, `toggleTheme`, `applyTheme`
- **toastStore.test.ts** — `show`, `dismiss`, convenience methods, auto-dismiss

### Integration Tests (tests/integration/)

- **gitService.test.ts** — tests all Git service functions with mocked `simple-git`:
  - `isRepo`, `status`, `add`, `commit`, `push`
  - `branches`, `remotes`, `tags`
  - `extractRepoInfo` (GitHub/GitLab/Bitbucket detection)
  - LFS operations

### Component Tests (tests/components/)

- **DiffViewer.test.tsx** — loading state, binary file, badges, line counts, view modes, hunk collapse
- **ToastContainer.test.tsx** — toast types, detail, dismissal
- **WelcomeScreen.test.tsx** — title, buttons, keyboard hint

## Best Practices

1. **Test behavior, not implementation** — use Testing Library queries
2. **Mock at the boundaries** — mock `window.smartgit`, `simple-git`, not internal modules
3. **One assertion per test** when possible
4. **Descriptive test names** — describe what the function/feature does
5. **Use `data-testid`** sparingly — prefer text queries
6. **Clean up** — `afterEach(() => cleanup())` is automatic via setup
7. **Fake timers** for time-dependent tests: `vi.useFakeTimers()`

## CI Integration

```bash
# In CI pipeline:
npm ci
npm run typecheck
npm test
npm run build
```

The `make ci` target runs: `install-ci` → `check` (typecheck + lint) → `build`.
