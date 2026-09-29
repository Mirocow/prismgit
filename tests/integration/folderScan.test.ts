/**
 * Integration: recursive folder repository scan (v2.3).
 *
 * «Репозитории из папок должны добавляться рекурсивно — все, что есть в
 * папке и подпапках, образуя группы по названию папок».
 *
 * storage.ts instantiates SimpleStore at module load; SimpleStore isolates
 * its JSON file via PRISMGIT_USER_DATA — point it at a temp dir BEFORE the
 * dynamic import, giving the test a pristine, throwaway store.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-folderscan-'));
process.env.PRISMGIT_USER_DATA = userData;

// Dynamic import — must run AFTER PRISMGIT_USER_DATA is set.
const storage = await import('../../electron/services/storage');

function makeRepo(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git init -q -b main "${dir}"`, { stdio: 'ignore' });
  return dir;
}

/** Build a realistic folder-of-repos tree. */
const scanRoot = path.join(userData, 'dev');
const setup = {
  api: makeRepo(path.join(scanRoot, 'api')),
  web: makeRepo(path.join(scanRoot, 'web')),
  libsUi: makeRepo(path.join(scanRoot, 'libs', 'ui')),
  libsCore: makeRepo(path.join(scanRoot, 'libs', 'core')),
  toolsScripts: makeRepo(path.join(scanRoot, 'tools', 'scripts', 'gen')),
  // Depth-8 repo (a..g = 7 container levels + repo itself): found with the
  // default maxDepth=8, invisible to a maxDepth=3 scan.
  deep: makeRepo(path.join(scanRoot, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'repo-deep')),
};

// Noise that must NOT be scanned:
fs.mkdirSync(path.join(scanRoot, 'web', 'node_modules', 'pkg'), { recursive: true });
execSync(`git init -q -b main "${path.join(scanRoot, 'web', 'node_modules', 'pkg')}"`, { stdio: 'ignore' });
fs.mkdirSync(path.join(scanRoot, 'vendor', 'notarepo'), { recursive: true });

describe('storage — scanFolderForRepositories', () => {
  it('finds every repository in the folder and subfolders (recursive)', () => {
    const found = storage.scanFolderForRepositories(scanRoot);
    const names = found.map((r) => r.name).sort();
    expect(names).toEqual(['api', 'core', 'gen', 'repo-deep', 'ui', 'web']);
  });

  it('derives groupPath from CONTAINER folders (repo name is the leaf, not a group)', () => {
    const found = storage.scanFolderForRepositories(scanRoot);
    const byPath = new Map(found.map((r) => [r.path, r]));
    expect(byPath.get(setup.api)!.groupPath).toEqual([]);           // directly in root
    expect(byPath.get(setup.libsUi)!.groupPath).toEqual(['libs']);  // one level deep
    expect(byPath.get(setup.toolsScripts)!.groupPath).toEqual(['tools', 'scripts']);
  });

  it('does not descend into node_modules or found repositories', () => {
    const found = storage.scanFolderForRepositories(scanRoot);
    // node_modules/pkg WAS git-init'd but must be skipped.
    expect(found.some((r) => r.path.includes('node_modules'))).toBe(false);
  });

  it('caps the depth (maxDepth) to stay snappy on huge trees', () => {
    const found = storage.scanFolderForRepositories(scanRoot, { maxDepth: 3 });
    // repo-deep sits at depth 9 — beyond the cap.
    expect(found.some((r) => r.name === 'repo-deep')).toBe(false);
    // api/web are at depth 1 — within the cap.
    expect(found.some((r) => r.name === 'api')).toBe(true);
  });

  it('treats the picked root as a container: a repo root is found AND its subfolders scanned', () => {
    // scanRoot itself is not a repo — make a fresh one that IS.
    const repoRoot = path.join(userData, 'repo-root');
    makeRepo(repoRoot);
    makeRepo(path.join(repoRoot, 'nested', 'child'));
    const found = storage.scanFolderForRepositories(repoRoot);
    expect(found.map((r) => r.name).sort()).toEqual(['child', 'repo-root']);
    const root = found.find((r) => r.path === path.resolve(repoRoot))!;
    expect(root.groupPath).toEqual([]);
  });

  it('recognizes .git FILE (worktree/submodule shape) as a repository', () => {
    const wtParent = makeRepo(path.join(userData, 'wt-parent'));
    const wtDir = path.join(userData, 'wt-external');
    fs.mkdirSync(wtDir, { recursive: true });
    execSync(`git -C "${wtParent}" worktree add -q -b side "${wtDir}"`, { stdio: 'ignore' });
    // wtDir/.git is a FILE — the scanner must still count it.
    expect(fs.statSync(path.join(wtDir, '.git')).isFile()).toBe(true);
    const found = storage.scanFolderForRepositories(wtDir);
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe(path.resolve(wtDir));
  });

  it('does not follow symlinked directories (cycle guard)', () => {
    const loopRoot = path.join(userData, 'loop');
    makeRepo(path.join(loopRoot, 'real'));
    const link = path.join(loopRoot, 'real', 'back-to-root');
    try { fs.symlinkSync(loopRoot, link, 'dir'); } catch { /* platform without symlinks */ }
    // Without the guard this would recurse forever (or explode).
    const found = storage.scanFolderForRepositories(loopRoot);
    expect(found.filter((r) => r.name === 'real')).toHaveLength(1);
  });

  it('returns [] for a missing path or a file path', () => {
    expect(storage.scanFolderForRepositories(path.join(userData, 'nope'))).toEqual([]);
    const filePath = path.join(userData, 'plain.txt');
    fs.writeFileSync(filePath, 'x');
    expect(storage.scanFolderForRepositories(filePath)).toEqual([]);
  });
});

describe('storage — addFolderRepositories (groups by folder name)', () => {
  it('adds all repos and builds a group tree mirroring the folders', () => {
    const result = storage.addFolderRepositories(scanRoot);

    expect(result.added).toBe(6);
    expect(result.existing).toBe(0);
    expect(result.rootGroupName).toBe('dev');

    const repos = storage.getRepos();
    expect(repos.some((r) => r.path === setup.api)).toBe(true);
    expect(repos.some((r) => r.path === setup.deep)).toBe(true);

    // Group tree: dev → libs → (ui, core), dev → tools → scripts → gen
    const groups = storage.getRepoGroups();
    const dev = groups.find((g) => g.name === 'dev');
    expect(dev).toBeTruthy();
    expect(dev!.parentId).toBeNull();

    const libs = groups.find((g) => g.name === 'libs');
    expect(libs!.parentId).toBe(dev!.id);
    const scripts = groups.find((g) => g.name === 'scripts');
    expect(scripts!.parentId).toBe(groups.find((g) => g.name === 'tools')!.id);

    // Repos assigned to the mirroring groups:
    //  api/web → group dev; libs/ui → group libs; tools/.../gen → scripts.
    expect(repos.find((r) => r.path === setup.api)!.groupId).toBe(dev!.id);
    expect(repos.find((r) => r.path === setup.libsUi)!.groupId).toBe(libs!.id);
    expect(repos.find((r) => r.path === setup.toolsScripts)!.groupId).toBe(scripts!.id);
  });

  it('is IDEMPOTENT: re-adding the same folder reuses groups and counts existing repos', () => {
    const groupsBefore = storage.getRepoGroups().slice();
    const result = storage.addFolderRepositories(scanRoot);

    expect(result.added).toBe(0);
    expect(result.existing).toBe(6);
    // No duplicate groups with the same name+parent.
    const groupsAfter = storage.getRepoGroups();
    expect(groupsAfter).toHaveLength(groupsBefore.length);
    const signatures = new Set(groupsAfter.map((g) => `${g.parentId ?? 'root'}::${g.name}`));
    expect(signatures.size).toBe(groupsAfter.length);
  });

  it('a folder that is itself the ONLY repository is added without a wrapper group', () => {
    const solo = makeRepo(path.join(userData, 'solo-repo'));
    const result = storage.addFolderRepositories(solo);
    expect(result.added).toBe(1);
    expect(result.groupsCreated).toBe(0);
    const groups = storage.getRepoGroups().filter((g) => g.name === 'solo-repo');
    expect(groups).toHaveLength(0);
    expect(storage.getRepos().find((r) => r.path === solo)!.groupId).toBeNull();
  });

  it('preserves pinned/lastOpened of existing repos when re-adding (merge, not overwrite)', () => {
    storage.updateRepo(setup.api, { pinned: true });
    storage.addFolderRepositories(scanRoot);
    expect(storage.getRepos().find((r) => r.path === setup.api)!.pinned).toBe(true);
  });
});
