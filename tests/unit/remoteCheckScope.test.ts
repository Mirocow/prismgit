/**
 * scopeRemoteCheckPaths — the favorites-only background poll scope.
 *
 * User report: «Опять приложение PrismGit стало неимоверно тупить... Давай
 * сделаем что фетч в фоне выполняется только у избранных
 * репозиториев/проектов (так и нагрузку снизим)» — the periodic remote
 * check must only touch starred repos (+ the currently open repo); 'all'
 * restores the legacy full-list behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { scopeRemoteCheckPaths } from '../../src/hooks/useRemotePolling';
import { useRepositoryStore } from '../../src/stores/repositoryStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const meta = (path: string, favorite: boolean) =>
  ({ path, name: path.split('/').pop() ?? path, favorite }) as never;

describe('scopeRemoteCheckPaths', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: {}, theme: 'dark', loading: false });
    useRepositoryStore.setState({
      repos: [],
      currentRepo: null,
      metadata: {},
      remoteChecks: {},
      checkingRemotes: false,
      loading: false,
      error: null,
    });
  });

  it('defaults to favorites-only: non-favorite repos are excluded', () => {
    useRepositoryStore.setState({
      currentRepo: { path: '/cur', name: 'cur', lastOpened: 0 },
      metadata: { '/fav': meta('/fav', true), '/plain': meta('/plain', false) },
    });
    const out = scopeRemoteCheckPaths(['/fav', '/plain', '/other', '/cur']);
    expect(out).toEqual(['/fav', '/cur']);
  });

  it('always includes the currently open repo (even unstarred)', () => {
    useRepositoryStore.setState({
      currentRepo: { path: '/cur', name: 'cur', lastOpened: 0 },
      metadata: { '/cur': meta('/cur', false) },
    });
    expect(scopeRemoteCheckPaths(['/cur', '/x'])).toEqual(['/cur']);
  });

  it('returns EMPTY when no favorites are known yet (metadata not loaded)', () => {
    // Checking NOTHING beats hammering EVERY repo — the exact background
    // load this scope exists to prevent. The next tick after metadata
    // lands covers the favorites.
    useRepositoryStore.setState({ currentRepo: null, metadata: {} });
    expect(scopeRemoteCheckPaths(['/a', '/b'])).toEqual([]);
  });

  it('scope=all restores the legacy full-list behavior', () => {
    useSettingsStore.setState({ settings: { repoRemoteCheckScope: 'all' }, theme: 'dark', loading: false });
    useRepositoryStore.setState({
      currentRepo: null,
      metadata: { '/fav': meta('/fav', true) },
    });
    expect(scopeRemoteCheckPaths(['/a', '/b', '/fav'])).toEqual(['/a', '/b', '/fav']);
  });

  it('no favorites at all → only the current repo is polled', () => {
    useRepositoryStore.setState({
      currentRepo: { path: '/cur', name: 'cur', lastOpened: 0 },
      metadata: { '/a': meta('/a', false), '/b': meta('/b', false) },
    });
    expect(scopeRemoteCheckPaths(['/a', '/b', '/cur'])).toEqual(['/cur']);
  });
});
