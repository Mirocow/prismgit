# Contributing

## Development Setup

### Prerequisites

- Node.js 18+ and npm
- Git installed and available in PATH
- Docker 20+ (for multi-platform builds)

### Installation

```bash
git clone <repo-url>
cd smartgit-electron
make install
```

### Development

```bash
make dev          # start dev server with HMR
make typecheck    # TypeScript check
make test         # run tests
make lint         # lint
```

## Project Structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design.

```
electron/         # Main process (Node.js)
src/              # Renderer process (React)
tests/            # Test suite (Vitest)
docs/             # Documentation
```

## Coding Standards

### TypeScript

- Strict mode enabled
- No `any` types — use `unknown` and type guard
- All function parameters and returns must be typed
- Use interfaces for object shapes, types for unions

### React

- Functional components only (no class components)
- Hooks for state and side effects
- `useCallback` for event handlers passed to children
- `useMemo` for expensive computations
- Lazy-load pages with `React.lazy` + `Suspense`

### State Management (Zustand)

- One store per domain (repository, git, settings, auth, toast)
- Actions defined in the store, not in components
- Selectors for derived state

### CSS

- Tailwind utility classes for layout and styling
- CSS variables for theme colors (in `globals.css`)
- No inline styles except for dynamic values (colors from JS)
- Custom component classes (`.btn`, `.icon-btn`, `.panel`) for reuse

### Icons

- Use custom SVG icons from `src/components/icons.tsx`
- Do NOT add icon libraries (lucide-react, etc.)
- Each icon is a functional component accepting `size` prop

## Adding a New Page

1. Create `src/pages/MyPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';

export function MyPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastStore();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <span className="text-sm font-medium">My Page</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* content */}
      </div>
    </div>
  );
}
```

2. Add to `src/App.tsx`:

```tsx
const MyPage = lazy(() => import('./pages/MyPage').then(m => ({ default: m.MyPage })));

// In Routes:
<Route path="/my-page" element={<MyPage />} />
```

3. Add to sidebar in `src/components/Sidebar.tsx`:

```tsx
{ path: '/my-page', label: 'My Page', icon: MyIcon, group: 'Working Tree' },
```

4. Write tests in `tests/components/MyPage.test.tsx`

## Adding a New Git Operation

1. Add type to `electron/types/git-api.ts`:

```typescript
git.newOperation(repoPath: string, arg: string): Promise<ResultType>;
```

2. Implement in `electron/services/git.ts`:

```typescript
export async function newOperation(repoPath: string, arg: string): Promise<ResultType> {
  const git = getGit(repoPath);
  const result = await git.raw(['new-command', arg]);
  return parseResult(result);
}
```

3. Register IPC handler in `electron/ipc/git.ts`:

```typescript
ipcMain.handle('git:newOperation', (_e, p: string, a: string) => gitService.newOperation(p, a));
```

4. Expose in `electron/preload.ts`:

```typescript
newOperation: (repoPath: string, arg: string) => ipcRenderer.invoke('git:newOperation', repoPath, arg),
```

5. Use in renderer:

```typescript
const result = await api.git.newOperation(repo.path, 'value');
```

6. Write tests in `tests/integration/gitService.test.ts`

## Testing

### Test Structure

```
tests/
├── setup.ts                    # Global setup, mocks
├── unit/                       # Pure function tests
│   ├── utils.test.ts
│   ├── gitflow.test.ts
│   ├── conflictParser.test.ts
│   ├── diffParser.test.ts
│   ├── languageDetection.test.ts
│   ├── repositoryStore.test.ts
│   ├── settingsStore.test.ts
│   └── toastStore.test.ts
├── integration/                # Service tests with mocks
│   └── gitService.test.ts
└── components/                 # React component tests
    ├── DiffViewer.test.tsx
    ├── ToastContainer.test.tsx
    └── WelcomeScreen.test.tsx
```

### Running Tests

```bash
make test              # run all tests once
make test:watch        # watch mode
make test:coverage     # with coverage report
```

### Writing Tests

**Unit tests** — test pure functions in isolation:

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../../src/lib/myModule';

describe('myFunction', () => {
  it('does the right thing', () => {
    expect(myFunction('input')).toBe('output');
  });
});
```

**Component tests** — test React components with Testing Library:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyComponent } from '../../src/components/MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

**Integration tests** — test services with mocked dependencies:

```typescript
import { describe, it, expect, vi } from 'vitest';
vi.mock('simple-git', () => ({ /* mock */ }));
import * as gitService from '../../electron/services/git';

describe('gitService', () => {
  it('calls git correctly', async () => {
    const result = await gitService.status('/repo');
    expect(result).toBeDefined();
  });
});
```

### Coverage Thresholds

- Statements: 60%
- Branches: 50%
- Functions: 60%
- Lines: 60%

## Git Commit Guidelines

Use conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

Examples:
```
feat(diff): add side-by-side view mode
fix(conflict): use :1/:2/:3 stages for 3-way merge
docs(api): document all Git operations
test(utils): add tests for formatDate
```

## Pull Request Process

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make changes and add tests
3. Ensure all tests pass: `make test`
4. Ensure typecheck passes: `make typecheck`
5. Ensure build passes: `make build`
6. Commit with conventional commit message
7. Push and create pull request

## Docker Build

All production builds happen in Docker:

```bash
make docker-all      # all platforms
make docker-linux    # Linux
make docker-win      # Windows (via Wine)
make docker-mac      # macOS
```

See [DOCKER-BUILD.md](./DOCKER-BUILD.md) for details.

## Release Process

1. Update version: `make bump-version BUMP_VERSION=patch|minor|major`
2. Update [CHANGELOG.md](./CHANGELOG.md)
3. Commit: `git commit -am "chore: release v1.2.3"`
4. Build all platforms: `make docker-all`
5. Verify artifacts: `make release-check`
6. Tag: `git tag v1.2.3 && git push --tags`
