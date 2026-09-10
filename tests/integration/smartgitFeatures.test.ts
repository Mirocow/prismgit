/**
 * Integration tests — SmartGit feature set: Git Notes, Subtrees, Format Patch,
 * Edit Author, Verify/GC/Unreachable, Bugtraq config, Index Editor helpers,
 * LFS locks parsing (real git, real repos).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  noteCategories, notesList, notesAdd, notesRemove, notesShow,
  subtrees, subtreeAdd, subtreePull, subtreeSplit, subtreeRemove,
  formatPatch, editCommitAuthor, verifyDatabase, garbageCollect,
  unreachableCommits, bugtraqConfig, setIndexContent, showFile,
  log,
} from '../../electron/services/git.js';

let repoDir: string;
let subDir: string; // local repo used as subtree source

function sh(cmd: string, cwd = repoDir) {
  return execSync(cmd, { cwd, encoding: 'utf-8' });
}

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-smartgit-'));
  sh('git init -b main -q');
  sh('git config user.email t@t.t');
  sh('git config user.name T');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'base\nline2\nline3\n');
  sh('git add . && git commit -m "base commit" -q');
  sh('git commit --allow-empty -m "second commit" -q');

  // Subtree source repo
  subDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-subtree-'));
  execSync('git init -b main -q', { cwd: subDir });
  execSync('git config user.email s@s.s && git config user.name S', { cwd: subDir });
  fs.writeFileSync(path.join(subDir, 'lib.js'), 'export const x = 1;\n');
  execSync('git add . && git commit -m "subtree initial" -q', { cwd: subDir });
});

afterAll(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.rmSync(subDir, { recursive: true, force: true });
});

describe('Git Notes', () => {
  it('adds, lists, shows and removes notes; categories include defaults + config', async () => {
    const head = sh('git rev-parse HEAD').trim();
    await notesAdd(repoDir, 'commits', head, 'Build released on 2026-09-10');
    const shown = await notesShow(repoDir, 'commits', head);
    expect(shown).toContain('Build released on 2026-09-10');

    const list = await notesList(repoDir, 'commits');
    expect(list).toHaveLength(1);
    expect(list[0].commit).toBe(head);
    expect(list[0].note).toContain('Build released');

    // second note in custom category
    await notesAdd(repoDir, 'qa', head, 'State: Pass');
    const qa = await notesList(repoDir, 'qa');
    expect(qa).toHaveLength(1);

    // remove + verify gone
    await notesRemove(repoDir, 'commits', head);
    expect(await notesShow(repoDir, 'commits', head)).toBeNull();
    expect(await notesList(repoDir, 'commits')).toHaveLength(0);

    // categories: default + qa (auto-detected from refs/notes/qa)
    const cats = await noteCategories(repoDir);
    expect(cats.some((c) => c.ref === 'commits')).toBe(true);
    expect(cats.some((c) => c.ref === 'qa')).toBe(true);
  });

  it('reads configured smartgit-notes categories (ref + color)', async () => {
    sh('git config smartgit.notes.qa.ref qa');
    sh('git config smartgit.notes.qa.color 66CC66');
    const cats = await noteCategories(repoDir);
    const qa = cats.find((c) => c.id === 'qa');
    expect(qa).toBeTruthy();
    expect(qa!.ref).toBe('qa');
    expect(qa!.color).toBe('66CC66');
  });
});

describe('Subtrees', () => {
  let subRepo: string; // isolated repo — subtree operations move HEAD
  beforeAll(() => {
    subRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-subtree-main-'));
    execSync('git init -b main -q', { cwd: subRepo });
    execSync('git config user.email t@t.t && git config user.name T', { cwd: subRepo });
    fs.writeFileSync(path.join(subRepo, 'a.txt'), 'main repo\n');
    execSync('git add . && git commit -m "main base" -q', { cwd: subRepo });
  });
  afterAll(() => {
    fs.rmSync(subRepo, { recursive: true, force: true });
  });

  it('configures, adds, lists, pulls, splits and removes a subtree', async () => {
    expect(await subtrees(subRepo)).toHaveLength(0);
    await subtreeAdd(subRepo, { name: 'mylib', path: 'vendor/mylib', remote: 'suborigin', branch: 'main', squash: true, remoteUrl: subDir });
    const tree = execSync('ls vendor/mylib', { cwd: subRepo, encoding: 'utf-8' });
    expect(tree).toContain('lib.js');

    const list = await subtrees(subRepo);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'mylib', path: 'vendor/mylib', remote: 'suborigin', branch: 'main', squash: true });

    // upstream change → subtree pull brings it in
    fs.writeFileSync(path.join(subDir, 'lib2.js'), 'export const y = 2;\n');
    execSync('git add . && git commit -m "subtree update" -q', { cwd: subDir });
    await subtreePull(subRepo, 'mylib');
    expect(execSync('ls vendor/mylib', { cwd: subRepo, encoding: 'utf-8' })).toContain('lib2.js');

    // split extracts subtree commits to a local branch
    const branch = await subtreeSplit(subRepo, 'mylib', { rejoin: true });
    expect(branch).toBe('subtree/mylib');
    expect(execSync('git rev-parse --verify subtree/mylib', { cwd: subRepo, encoding: 'utf-8' })).toBeTruthy();

    await subtreeRemove(subRepo, 'mylib');
    expect(await subtrees(subRepo)).toHaveLength(0);
  });
});

describe('formatPatch', () => {
  it('writes patch files for a commit and a range', async () => {
    const outDir = path.join(os.tmpdir(), `prismgit-patch-${Date.now()}`);
    const files = await formatPatch(repoDir, { outputDir: outDir, commit: 'HEAD' });
    expect(files.length).toBe(1);
    const content = fs.readFileSync(files[0], 'utf-8');
    expect(content).toContain('From ');
    expect(content).toContain('Subject: [PATCH] second commit');

    const files2 = await formatPatch(repoDir, { outputDir: outDir, from: 'HEAD~1', to: 'HEAD' });
    expect(files2.length).toBeGreaterThanOrEqual(1);
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});

describe('editCommitAuthor', () => {
  it('changes the author of HEAD via amend', async () => {
    const head = sh('git rev-parse HEAD').trim();
    await editCommitAuthor(repoDir, head, 'New Author', 'new@author.io');
    const out = sh("git log -1 --format='%an|%ae'");
    expect(out.trim()).toBe('New Author|new@author.io');
    // message preserved
    expect(sh('git log -1 --format=%s').trim()).toBe('second commit');
  });
});

describe('verifyDatabase / garbageCollect / unreachableCommits', () => {
  it('runs fsck, gc and reports unreachable commits', async () => {
    const report = await verifyDatabase(repoDir);
    expect(report).not.toContain('fatal');

    const stats = await garbageCollect(repoDir);
    expect(stats).toContain('count:');

    // orphan commit → becomes unreachable
    const orphan = sh('git commit-tree HEAD^{tree} -m orphaned').trim();
    const unreachable = await unreachableCommits(repoDir);
    expect(unreachable.some((c) => c.hash === orphan && c.subject === 'orphaned')).toBe(true);
  });
});

describe('bugtraqConfig', () => {
  it('reads .gitbugtraq file with url/logregex', async () => {
    fs.writeFileSync(
      path.join(repoDir, '.gitbugtraq'),
      '[bugtraq "jira"]\n' +
      '\turl = https://jira.example.com/browse/%BUGID%\n' +
      '\tlogregex = "(PROJ-\\\\d+)"\n'
    );
    const cfg = await bugtraqConfig(repoDir);
    expect(cfg).toBeTruthy();
    expect(cfg!.url).toBe('https://jira.example.com/browse/%BUGID%');
    expect(cfg!.logregex).toContain('PROJ-');
  });

  it('reads [bugtraq] from .git/config when the file is absent', async () => {
    fs.rmSync(path.join(repoDir, '.gitbugtraq'));
    sh('git config bugtraq.url "https://bugs.example.com/%BUGID%"');
    sh('git config bugtraq.logregex "#(\\\\d+)"');
    const cfg = await bugtraqConfig(repoDir);
    expect(cfg).toBeTruthy();
    expect(cfg!.url).toBe('https://bugs.example.com/%BUGID%');
  });
});

describe('Index Editor helpers', () => {
  it('overwrites the index content of a file; showFile reads back versions', async () => {
    // staged version differs from HEAD
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'base\nline2\nCHANGED-IN-WT\n');
    sh('git add a.txt');
    await setIndexContent(repoDir, 'a.txt', 'base\nline2\nCHANGED-IN-INDEX\n');
    // ref '' → 'git show :<file>' (index version)
    const indexContent = await showFile(repoDir, '', 'a.txt');
    expect(indexContent).toContain('CHANGED-IN-INDEX');
    const headContent = await showFile(repoDir, 'HEAD', 'a.txt');
    expect(headContent).toContain('line3');
  });
});

describe('notesList output integration with log()', () => {
  it('notes survive on their commits and can be listed together with log entries', async () => {
    const entries = await log(repoDir, { maxCount: 10 });
    const head = entries[0];
    await notesAdd(repoDir, 'commits', head.hash, 'review: looks good', true);
    const list = await notesList(repoDir, 'commits');
    const found = list.find((n) => n.commit === head.hash);
    expect(found?.note).toBe('review: looks good');
  });
});
