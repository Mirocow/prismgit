/**
 * Integration: repository group CRUD in storage.ts
 *
 * storage.ts instantiates SimpleStore at module load; SimpleStore isolates its
 * JSON file via PRISMGIT_USER_DATA — so we point it at a temp dir BEFORE the
 * dynamic import, giving the test a pristine, throwaway store.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-groups-'));
process.env.PRISMGIT_USER_DATA = userData;

// Dynamic import — must run AFTER PRISMGIT_USER_DATA is set.
const storage = await import('../../electron/services/storage');

function makeRepoAt(repoPath: string) {
  execSync(`git init -q -b main "${repoPath}"`, { stdio: 'ignore' });
  storage.addRepo({ path: repoPath, name: path.basename(repoPath) });
  return repoPath;
}

describe('storage — repository groups (tree with drag & drop support)', () => {
  it('starts with an empty group list', () => {
    expect(storage.getRepoGroups()).toEqual([]);
  });

  it('creates a root group and validates the name', () => {
    const g = storage.createRepoGroup('Work');
    expect(g.name).toBe('Work');
    expect(g.parentId).toBeNull();
    expect(g.expanded).toBe(true);
    expect(storage.getRepoGroups()).toHaveLength(1);

    expect(() => storage.createRepoGroup('   ')).toThrow(/empty/i);
    expect(() => storage.createRepoGroup('', 'nonexistent')).toThrow();
    expect(() => storage.createRepoGroup('X', 'nonexistent')).toThrow(/not found/i);
  });

  it('creates subgroups under an existing parent', () => {
    const work = storage.getRepoGroups().find((g) => g.name === 'Work')!;
    const sub = storage.createRepoGroup('Clients', work.id);
    expect(sub.parentId).toBe(work.id);
  });

  it('renames groups', () => {
    const work = storage.getRepoGroups().find((g) => g.name === 'Work')!;
    storage.renameRepoGroup(work.id, 'Work Stuff');
    expect(storage.getRepoGroups().find((g) => g.id === work.id)!.name).toBe('Work Stuff');
    expect(() => storage.renameRepoGroup(work.id, '  ')).toThrow(/empty/i);
    expect(() => storage.renameRepoGroup('ghost', 'X')).toThrow(/not found/i);
  });

  it('assigns repos to groups and back to root', () => {
    const repoA = makeRepoAt(path.join(userData, 'repo-a'));
    const work = storage.getRepoGroups().find((g) => g.name === 'Work Stuff')!;

    storage.setRepoGroup(repoA, work.id);
    expect(storage.getRepos().find((r) => r.path === repoA)!.groupId).toBe(work.id);

    storage.setRepoGroup(repoA, null);
    expect(storage.getRepos().find((r) => r.path === repoA)!.groupId).toBeNull();

    expect(() => storage.setRepoGroup('/ghost/path', null)).toThrow(/not found/i);
    expect(() => storage.setRepoGroup(repoA, 'ghost-group')).toThrow(/not found/i);
  });

  it('rejects moving a group into itself or its own subtree', () => {
    const work = storage.getRepoGroups().find((g) => g.name === 'Work Stuff')!;
    const clients = storage.getRepoGroups().find((g) => g.name === 'Clients')!;

    // Clients under Work is fine (sibling move target check happens elsewhere)
    storage.moveRepoGroup(clients.id, null);
    expect(storage.getRepoGroups().find((g) => g.id === clients.id)!.parentId).toBeNull();

    expect(() => storage.moveRepoGroup(work.id, work.id)).toThrow(/itself/i);
    // Recreate: work > clients, then try clients' parent chain loop
    storage.moveRepoGroup(clients.id, work.id);
    expect(() => storage.moveRepoGroup(work.id, clients.id)).toThrow(/own subtree/i);
    expect(() => storage.moveRepoGroup('ghost', null)).toThrow(/not found/i);
  });

  it('isDescendantGroup detects subtree membership (incl. corrupt cycles)', () => {
    const groups = storage.getRepoGroups();
    const work = groups.find((g) => g.name === 'Work Stuff')!;
    const clients = groups.find((g) => g.name === 'Clients')!;
    expect(storage.isDescendantGroup(groups, work.id, clients.id)).toBe(true);
    expect(storage.isDescendantGroup(groups, clients.id, work.id)).toBe(false);
    // Corrupt data must not hang: a -> b -> a
    const corrupt = [
      { id: 'a', name: 'A', parentId: 'b', order: 1, createdAt: 1 },
      { id: 'b', name: 'B', parentId: 'a', order: 2, createdAt: 2 },
    ];
    expect(storage.isDescendantGroup(corrupt, 'a', 'b')).toBe(true);
    expect(storage.isDescendantGroup(corrupt, 'b', 'a')).toBe(true);
  });

  it('deleting a group promotes child groups AND repos to the parent level', () => {
    // Build: g1 > g2 with repo-b inside g2 and repo-c directly inside g1
    const g1 = storage.createRepoGroup('DelParent');
    const g2 = storage.createRepoGroup('DelChild', g1.id);
    const repoB = makeRepoAt(path.join(userData, 'repo-b'));
    const repoC = makeRepoAt(path.join(userData, 'repo-c'));
    storage.setRepoGroup(repoB, g2.id);
    storage.setRepoGroup(repoC, g1.id);

    storage.deleteRepoGroup(g1.id);

    const remaining = storage.getRepoGroups();
    expect(remaining.find((g) => g.id === g1.id)).toBeUndefined();
    // g2 (child group) promoted to root — still exists, now top-level
    expect(remaining.find((g) => g.id === g2.id)!.parentId).toBeNull();
    // repo inside g2 stays in g2 (g2 was not destroyed, just promoted)
    expect(storage.getRepos().find((r) => r.path === repoB)!.groupId).toBe(g2.id);
    // repo directly inside g1 is promoted to root
    expect(storage.getRepos().find((r) => r.path === repoC)!.groupId).toBeNull();
    // deleting twice is a no-op
    expect(() => storage.deleteRepoGroup(g1.id)).not.toThrow();
  });

  it('persists expanded state per group', () => {
    const g = storage.createRepoGroup('Collapsible');
    storage.setRepoGroupExpanded(g.id, false);
    expect(storage.getRepoGroups().find((x) => x.id === g.id)!.expanded).toBe(false);
    storage.setRepoGroupExpanded(g.id, true);
    expect(storage.getRepoGroups().find((x) => x.id === g.id)!.expanded).toBe(true);
    // Unknown id — silent no-op
    expect(() => storage.setRepoGroupExpanded('ghost', true)).not.toThrow();
  });
});
