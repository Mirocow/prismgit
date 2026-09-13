import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadProjectPrefs,
  saveProjectPrefs,
  clearProjectPrefs,
  type ProjectPrefs,
} from '../../src/lib/projectPrefs';

const REPO = '/tmp/test-repo-1';
const OTHER = '/tmp/test-repo-2';

describe('projectPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns {} when nothing saved', () => {
    expect(loadProjectPrefs(REPO)).toEqual({});
  });

  it('saves and loads a single field', () => {
    saveProjectPrefs(REPO, { commitMessageHistory: ['feat: x'] });
    expect(loadProjectPrefs(REPO).commitMessageHistory).toEqual(['feat: x']);
  });

  it('merges successive writes (does not clobber unrelated fields)', () => {
    saveProjectPrefs(REPO, { commitMessageHistory: ['feat: x'] });
    saveProjectPrefs(REPO, { favoriteTools: ['/changes'] });
    const prefs = loadProjectPrefs(REPO);
    expect(prefs.commitMessageHistory).toEqual(['feat: x']);
    expect(prefs.favoriteTools).toEqual(['/changes']);
  });

  it('isolates prefs per repository path', () => {
    saveProjectPrefs(REPO, { favoriteTools: ['/changes'] });
    saveProjectPrefs(OTHER, { favoriteTools: ['/history'] });
    expect(loadProjectPrefs(REPO).favoriteTools).toEqual(['/changes']);
    expect(loadProjectPrefs(OTHER).favoriteTools).toEqual(['/history']);
  });

  it('persists collapsedSidebarGroups round-trip', () => {
    const prefs: Partial<ProjectPrefs> = {
      collapsedSidebarGroups: ['Git Actions', 'Refs'],
    };
    saveProjectPrefs(REPO, prefs);
    const loaded = loadProjectPrefs(REPO);
    expect(loaded.collapsedSidebarGroups).toEqual(['Git Actions', 'Refs']);
  });

  it('clearProjectPrefs wipes only the targeted repo', () => {
    saveProjectPrefs(REPO, { favoriteTools: ['/changes'] });
    saveProjectPrefs(OTHER, { favoriteTools: ['/history'] });
    clearProjectPrefs(REPO);
    expect(loadProjectPrefs(REPO)).toEqual({});
    expect(loadProjectPrefs(OTHER).favoriteTools).toEqual(['/history']);
  });

  it('survives corrupt localStorage (returns {} instead of throwing)', () => {
    localStorage.setItem('prismgit-ui-prefs:' + REPO, '{not valid json');
    expect(loadProjectPrefs(REPO)).toEqual({});
  });
});
