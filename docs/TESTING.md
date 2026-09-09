# Testing

SmartGit Electron uses [Vitest](https://vitest.dev/) with [Testing Library](https://testing-library.com/) for testing.

## Strategy Overview

A four-layer test pyramid — every layer answers a different question, so a bug
is caught by the cheapest layer that can see it:

| Layer | Location | What it verifies | Speed | When it runs |
|-------|----------|------------------|-------|--------------|
| **Unit** | `tests/unit/` | Pure logic: parsers, stores, utilities | ~1–2 s | Every `npm test` |
| **Component** | `tests/components/` | React components in isolation with mocked `window.smartgit` | ~1 s | Every `npm test` |
| **Integration** | `tests/integration/` | `electron/services/git.ts` against **real git repositories** — the whole IPC service layer without Electron | ~10–20 s | Every `npm test` |
| **E2E** | manual / CDP driver | The real Electron app under xvfb: boot, pages, toolbars, dialogs, console errors | ~1–2 min | Before releases / after large UI changes |

## Test Structure

```
tests/
├── setup.ts                          # Global setup, mocks
├── unit/                             # Pure function tests
│   ├── utils.test.ts                 # cn, formatDate, status colors
│   ├── gitflow.test.ts               # Git-Flow engine
│   ├── conflictParser.test.ts        # Conflict marker parsing
│   ├── diffParser.test.ts            # Unified diff parsing
│   ├── wordDiff.test.ts              # Word-level diff
│   ├── gitGraph.test.ts              # Commit graph layout
│   ├── graphAncestry.test.ts         # Graph ancestry resolution
│   ├── branchTree.test.ts            # Branch tree compression
│   ├── fileTree.test.ts              # File tree builder + filterFiles
│   ├── languageDetection.test.ts     # File extension → language
│   ├── useLazyList.test.ts           # Virtualized list hook
│   ├── repositoryMetadata.test.ts    # Repo metadata extraction
│   ├── repositoryStore.test.ts       # Repository state management
│   ├── settingsStore.test.ts         # Settings + theme persistence
│   ├── toolbarStore.test.ts          # Shared toolbar groups (both toolbars)
│   ├── selectionStore.test.ts        # Global cross-page selection state
│   └── toastStore.test.ts            # Toast notifications
├── integration/                      # Service tests against real git
│   ├── gitService.workflows.test.ts  # Self-contained: full workflow families
│   ├── gitService.real.test.ts       # Fixture repo (scripts/setup-test-repo.sh)
│   ├── comprehensive.test.ts         # Manual test plan blocks 1–8
│   └── ollama-code.test.ts           # Big-repo performance fixture
└── components/                       # React component tests
    ├── DiffViewer.test.tsx           # Diff rendering, view modes, selection
    ├── ToastContainer.test.tsx       # Toast display and dismissal
    └── WelcomeScreen.test.tsx        # Welcome screen content
```

## Running Tests

```bash
# Run all tests once (unit + component + integration)
make test
# or: npm test

# Only unit + component tests (fast loop)
npm run test:unit

# Only integration tests (real git)
npm run test:integration

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

## The Verify Gate (pre-push hook)

```bash
npm run verify           # typecheck + ALL tests + production build
npm run hooks:install    # activate the pre-push hook (one time per clone)
```

`scripts/git-hooks/pre-push` runs `npm run verify` **before every push**, so a
push with failing typecheck, tests, or build is aborted — global changes
physically cannot land without passing the whole gate.

- Install once per clone: `npm run hooks:install` (sets `core.hooksPath`).
- Emergency bypass (use sparingly): `SMARTGIT_SKIP_VERIFY=1 git push`.

## Coverage

Coverage is configured in `vitest.config.ts` with thresholds:

| Metric | Threshold |
|--------|-----------|
| Statements | 50% |
| Branches | 50% |
| Functions | 55% |
| Lines | 50% |

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
    expect(useSettingsStore.getState().theme).toBe('dark' === 'dark' ? 'light' : 'dark');
  });
});
```

### Integration Tests

Integration tests run the REAL `gitService` against real git repositories —
no mocking of `simple-git`. Two flavors:

**Self-contained suites** (`gitService.workflows.test.ts`) build their own
disposable environment inside `beforeAll` — a working repo plus a bare remote
in a tmpdir — so they run on any machine and in CI without setup scripts:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as gitService from '../../electron/services/git';
import { execFileSync } from 'child_process';

function g(args: string[], cwd: string) {   // raw git for fixture/verification
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeAll(async () => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'smartgit-wf-'));
  fs.mkdirSync(REMOTE = path.join(ROOT, 'remote.git'), { recursive: true });
  fs.mkdirSync(REPO = path.join(ROOT, 'main'), { recursive: true });
  await gitService.init(REMOTE, true);          // bare remote
  await gitService.init(REPO, false);
  g(['config', 'user.email', 'wf-test@example.com'], REPO);  // repo-local config
  g(['config', 'user.name', 'Workflow Test'], REPO);
  g(['config', 'core.editor', 'true'], REPO);   // non-interactive rebase/merge
  await gitService.addRemote(REPO, 'origin', REMOTE);
}, 60_000);
```

**Fixture-based suites** (`gitService.real.test.ts`, `comprehensive.test.ts`,
`ollama-code.test.ts`) read prepared fixture repos; run
`scripts/setup-test-repo.sh` / `scripts/setup-ollama-code-fixture.sh` once if
the fixtures are missing.

### Integration test conventions (hard-learned)

- `beforeAll` MUST be `async` and `await` every gitService call — un-awaited
  promises race the fixture setup and fail with confusing `spawn git ENOENT`.
- `status()` returns simple-git field names: `not_added` (untracked),
  `modified` (unstaged tracked), `staged` (index entries), `conflicted`.
  There is no `unstaged` field.
- `git.commit(array)` means *multiple `-m` flags* in simple-git — never pass
  git flags (like `--amend`) through `commit()`; use `git.raw([...])`.
- Interactive-rebase tricks (custom `sequence.editor`) are blocked by
  simple-git unless you create a dedicated
  `simpleGit({ unsafe: { allowUnsafeEditor: true } })` instance.
- `git stash push` does not touch untracked files without
  `--include-untracked`.

## Test Categories

### Unit Tests (tests/unit/)

- **utils.test.ts** — `cn`, `formatDate`, `truncateMiddle`, `shortHash`, status color functions
- **gitflow.test.ts** — Git-Flow engine: `detectGitFlowConfig`, `startFeature`, `finishFeature`, `startRelease`, `finishRelease`, `startHotfix`, `finishHotfix`, `listFlowBranches`
- **conflictParser.test.ts** — `parseConflicts`, `buildResolvedContent`, `hasConflicts`, `countConflicts`
- **diffParser.test.ts** — `parseDiff`, `countDiffStats`, `isBinaryDiff`
- **wordDiff.test.ts** — word-level intra-line diff
- **gitGraph.test.ts** / **graphAncestry.test.ts** — commit graph lane layout and ancestry resolution
- **branchTree.test.ts** / **fileTree.test.ts** — chain-compression tree builders, `filterFiles`
- **languageDetection.test.ts** — file extension to language mapping for syntax highlighting
- **useLazyList.test.ts** — virtualization windowing
- **repositoryMetadata.test.ts** — repo metadata extraction
- **repositoryStore.test.ts** — `loadRepos`, `openRepository`, `closeRepository`, `removeRepo`
- **settingsStore.test.ts** — `loadSettings`, `setSetting`, `toggleTheme`, `applyTheme`
- **toolbarStore.test.ts** — shared toolbar groups: defaults, `setGroup`, `setGroups` (drag-reorder/reset), localStorage persistence and migration
- **selectionStore.test.ts** — global cross-page selection: commit/branch/file/tag/stash selectors, multi-branch toggle, status filters, `colWidths`, `clearAll`
- **toastStore.test.ts** — `show`, `dismiss`, convenience methods, auto-dismiss

### Integration Tests (tests/integration/)

- **gitService.workflows.test.ts** — self-contained suite (own repo + bare remote), 36 tests over the workflow families:
  - reset: soft / mixed / hard / keep + `resetFile`
  - rebase: clean / conflict+continue / skip / abort
  - merge: `--ff-only` rejection / squash / `strategy=ours` / conflict+`continueMerge` / `mergeTree` preview
  - stash: push / apply / pop / drop / branch / include-untracked
  - remote sync: push -u / pull / fetch / fetchAll / aheadBehind / pushTag / deleteTag(remote)
  - misc: `findCommit`, `checkoutFile`, `ignore`/`isIgnored`, `editCommitMessage`, `clean`, worktrees CRUD, bisect, config, `stageLines`/`unstageLines`, `splitCommit` (full split cycle), reflog, init/clone
- **gitService.real.test.ts** — fixture repo (run `scripts/setup-test-repo.sh`)
- **comprehensive.test.ts** — manual test plan blocks 1–8 as automated scenarios
- **ollama-code.test.ts** — big-repo fixture (1200+ commits, 600+ tags): log/tags/blame performance, N+1 checks

### Component Tests (tests/components/)

- **DiffViewer.test.tsx** — loading state, binary file, badges, line counts, view modes, hunk collapse
- **ToastContainer.test.tsx** — toast types, detail, dismissal
- **WelcomeScreen.test.tsx** — title, buttons, keyboard hint

## What Is Intentionally Not Automated Here

- Real Electron window interactions (native context menus, drag-and-drop).
  Those were verified with the CDP driver approach — revive it from
  commit `f1de064` (`scripts/ui-driver.mjs`, `scripts/ui-scenarios.mjs`)
  when a UI regression sweep is needed.
- Network-dependent operations (GitHub auth, real HTTPS remotes).
  The suites use a local bare remote as `origin` instead.

## Best Practices

1. **Test behavior, not implementation** — use Testing Library queries
2. **Mock at the boundaries** — mock `window.smartgit`, not internal modules;
   for gitService use real git, not mocks
3. **One assertion per test** when possible
4. **Descriptive test names** — describe what the function/feature does
5. **Use `data-testid`** sparingly — prefer text queries
6. **Clean up** — `afterEach(() => cleanup())` is automatic via setup;
   integration suites remove their tmpdirs in `afterAll`
7. **Fake timers** for time-dependent tests: `vi.useFakeTimers()`

## CI Integration

```bash
# In CI pipeline:
npm ci
npm run verify   # typecheck + test + build in one gate
```

`npm run verify` is exactly what the pre-push hook runs locally, so CI and
local pushes enforce the same quality bar.
