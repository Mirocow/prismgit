/**
 * v3.9 pins — state memory, favorites ordering, poll pause, wide splitter.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── 1. navHistoryStore — Back/Forward remembers tool STATE ─────────────────
import { useNavHistoryStore } from '../../src/stores/navHistoryStore';
import { useSelectionStore } from '../../src/stores/selectionStore';

describe('navHistoryStore v3.9 — state memory', () => {
  beforeEach(() => {
    useNavHistoryStore.getState().reset();
    useSelectionStore.getState().clearAll();
  });

  it('back() restores the target entry\'s snapshot (selected commit + filters)', () => {
    const nav = useNavHistoryStore.getState();
    // Visit History with a commit selected (cross-tool jump pattern:
    // mark → set selection → navigate).
    nav.markCrossToolJump();
    useSelectionStore.setState({ selectedCommitHash: 'aaa', pathFilter: 'src/a.ts' });
    nav.push('/history');
    // Then a NEW cross-tool jump to Blame — the History entry's snapshot
    // must NOT be polluted with the Blame state.
    nav.markCrossToolJump();
    useSelectionStore.setState({ selectedCommitHash: 'bbb', selectedFilePath: 'src/b.ts', pathFilter: null });
    nav.push('/blame');
    expect(useSelectionStore.getState().selectedFilePath).toBe('src/b.ts');
    // Back → the History entry remembers commit aaa + the file filter.
    const loc = nav.back();
    expect(loc).toBe('/history');
    const sel = useSelectionStore.getState();
    expect(sel.selectedCommitHash).toBe('aaa');
    expect(sel.pathFilter).toBe('src/a.ts');
  });

  it('a NON-jump navigation refreshes the outgoing entry (hotkey switch keeps the last state)', () => {
    const nav = useNavHistoryStore.getState();
    nav.markCrossToolJump();
    useSelectionStore.setState({ selectedCommitHash: 'h1' });
    nav.push('/history');
    // The user selects a DIFFERENT commit while ON History, then switches
    // tools via a hotkey — NO mark → the outgoing entry refreshes to h2.
    useSelectionStore.setState({ selectedCommitHash: 'h2' });
    nav.push('/blame');
    nav.back();
    expect(useSelectionStore.getState().selectedCommitHash).toBe('h2');
  });

  it('forward() returns to the state the user left on the later entry', () => {
    const nav = useNavHistoryStore.getState();
    nav.push('/history');
    useSelectionStore.setState({ selectedFilePath: null, selectedCommitHash: 'x1' });
    nav.push('/blame');
    useSelectionStore.setState({ selectedFilePath: 'f.ts', selectedCommitHash: 'x2' });
    nav.back();
    nav.forward();
    const sel = useSelectionStore.getState();
    expect(sel.selectedCommitHash).toBe('x2');
    expect(sel.selectedFilePath).toBe('f.ts');
  });

  it('a fresh push captures the CURRENT selection into the new entry (cross-tool jumps)', () => {
    useSelectionStore.setState({ selectedCommitHash: 'zz' });
    const nav = useNavHistoryStore.getState();
    nav.push('/diff');
    nav.push('/changes'); // leave /diff — snapshot refreshed
    const loc = nav.back();
    expect(loc).toBe('/diff');
    expect(useSelectionStore.getState().selectedCommitHash).toBe('zz');
  });
});

// ── 2. favoriteToolsStore — Settings-orderable favorites ───────────────────
import { useFavoriteToolsStore, DEFAULT_FAVORITE_TOOLS } from '../../src/stores/favoriteToolsStore';

describe('favoriteToolsStore v3.9 — ordering', () => {
  beforeEach(() => {
    useFavoriteToolsStore.getState().setOrder([...DEFAULT_FAVORITE_TOOLS]);
    localStorage.clear();
  });

  it('move() reorders and the subscriber persists to localStorage', () => {
    useFavoriteToolsStore.getState().move('/history', -1);
    expect(useFavoriteToolsStore.getState().favorites[0]).toBe('/history');
    const saved = JSON.parse(localStorage.getItem('prismgit-favorite-tools') || '[]');
    expect(saved[0]).toBe('/history');
  });

  it('move() at the edges is a no-op; toggleFavorite adds/removes', () => {
    const before = useFavoriteToolsStore.getState().favorites.slice();
    useFavoriteToolsStore.getState().move(before[0], -1);
    expect(useFavoriteToolsStore.getState().favorites).toEqual(before);
    useFavoriteToolsStore.getState().move(before[before.length - 1], 1);
    expect(useFavoriteToolsStore.getState().favorites).toEqual(before);
    useFavoriteToolsStore.getState().toggleFavorite('/stashes');
    expect(useFavoriteToolsStore.getState().favorites).toContain('/stashes');
    useFavoriteToolsStore.getState().toggleFavorite('/stashes');
    expect(useFavoriteToolsStore.getState().favorites).not.toContain('/stashes');
  });
});

// ── 3. repositoryStore — remote poll pause ────────────────────────────────
import { useRepositoryStore } from '../../src/stores/repositoryStore';

describe('repositoryStore v3.9 — remotePollingPaused', () => {
  it('defaults false and toggles via setRemotePollingPaused', () => {
    expect(useRepositoryStore.getState().remotePollingPaused).toBe(false);
    useRepositoryStore.getState().setRemotePollingPaused(true);
    expect(useRepositoryStore.getState().remotePollingPaused).toBe(true);
    useRepositoryStore.getState().setRemotePollingPaused(false);
    expect(useRepositoryStore.getState().remotePollingPaused).toBe(false);
  });
});

// ── 4. customThemeCss readableOn — the contrast-fix source ─────────────────
import { readableOn } from '../../src/lib/customThemeCss';

describe('readableOn (theme contrast fix)', () => {
  it('picks dark text on light colors, light text on dark colors', () => {
    expect(readableOn('#ffffff')).toBe('#1a1c20');
    expect(readableOn('#f2ae49')).toBe('#1a1c20');
    expect(readableOn('#111318')).toBe('#ffffff');
    expect(readableOn('#399ee6')).toBe('#ffffff');
    expect(readableOn('garbage')).toBe('#ffffff');
  });
});
