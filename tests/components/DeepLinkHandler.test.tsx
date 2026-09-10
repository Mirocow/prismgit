/**
 * Component tests for DeepLinkHandler.
 *
 * The handler must:
 *   - apply query params (?file=..., ?branch=...) to the global selection store,
 *   - strip the query from the URL afterwards (replace),
 *   - remember the target page as PENDING when no repository is open (cold start),
 *   - do nothing when the location has no query.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { DeepLinkHandler } from '../../src/components/DeepLinkHandler';
import { useSelectionStore } from '../../src/stores/selectionStore';
import { useRepositoryStore } from '../../src/stores/repositoryStore';
import {
  takePendingDeepLinkPage,
  clearPendingDeepLinkPage,
} from '../../src/lib/deepLinks';

/** Renders the current router location as JSON for assertions. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{JSON.stringify({ path: location.pathname, search: location.search })}</div>;
}

function getLoc(): { path: string; search: string } {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const el = document.querySelector('[data-testid="loc"]')!;
  return JSON.parse(el.textContent || '{}');
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <DeepLinkHandler />
      <Routes>
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DeepLinkHandler', () => {
  beforeEach(() => {
    useSelectionStore.getState().clearAll();
    clearPendingDeepLinkPage();
    // Make sure no repo is open (cold-start semantics)
    useRepositoryStore.setState({ currentRepo: null });
  });

  afterEach(() => {
    clearPendingDeepLinkPage();
  });

  it('applies file + branch params to the selection store', () => {
    renderAt('/history?file=src%2FApp.tsx&branch=main');
    const s = useSelectionStore.getState();
    expect(s.selectedFilePath).toBe('src/App.tsx');
    expect(s.pathFilter).toBe('src/App.tsx');
    expect(s.selectedBranch).toBe('main');
  });

  it('strips the query from the URL after applying', () => {
    renderAt('/history?file=a.ts');
    expect(getLoc()).toEqual({ path: '/history', search: '' });
  });

  it('stashes the page as pending when no repo is open', () => {
    renderAt('/blame?file=README.md');
    expect(takePendingDeepLinkPage()).toBe('/blame');
  });

  it('does not stash a pending page when a repo IS open', () => {
    useRepositoryStore.setState({ currentRepo: { path: '/tmp/repo', name: 'repo' } as never });
    renderAt('/history?file=a.ts');
    expect(takePendingDeepLinkPage()).toBeNull();
  });

  it('no-op on a query-less location', () => {
    renderAt('/changes');
    expect(getLoc()).toEqual({ path: '/changes', search: '' });
    const s = useSelectionStore.getState();
    expect(s.selectedFilePath).toBeNull();
    expect(s.selectedBranch).toBeNull();
    expect(takePendingDeepLinkPage()).toBeNull();
  });

  it('invalid param values are dropped, navigation still happens', () => {
    renderAt('/history?commit=not-a-hash&branch=main');
    const s = useSelectionStore.getState();
    expect(s.selectedCommitHash).toBeNull();
    expect(s.selectedBranch).toBe('main');
    expect(getLoc()).toEqual({ path: '/history', search: '' });
  });
});
