/**
 * Integration — the merged `ls-files -v` index scan against REAL git.
 *
 * The Changes page repo-open effect now runs ONE `git ls-files -v` instead
 * of `ls-files` + `ls-files -v` (two full index walks). The parser is
 * unit-tested against hand-written samples; THIS file pins it against the
 * tag letters a real git binary actually emits after `git update-index
 * --assume-unchanged / --skip-worktree` — the flags the feature exists to
 * display. If a future git changes tag spelling, this test catches it
 * before the UI silently stops marking those files.
 *
 * Also pins the fs:exists-style gating precondition for the submodule
 * loader: a repo without .gitmodules makes `git submodule summary` produce
 * nothing — the cheap fs check the renderer substitutes is equivalent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';
import { parseLsFilesV, LS_FILES_V_ARGS } from '../../src/lib/changesIndexScan';

const ROOT = path.join(os.tmpdir(), 'prismgit-repos', 'index-scan');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('merged ls-files -v scan (real git)', () => {
  let work: string;

  beforeAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    process.env.GIT_CONFIG_GLOBAL = path.join(ROOT, 'empty-gitconfig');
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

    shell('git init -q -b main work', ROOT);
    work = path.join(ROOT, 'work');
    shell('git config user.name "Ivan Testov"', work);
    shell('git config user.email "ivan@test.dev"', work);
    for (const f of ['normal.txt', 'frozen.txt', 'skippy.txt', 'nested/deep.txt']) {
      fs.mkdirSync(path.join(work, path.dirname(f)), { recursive: true });
      fs.writeFileSync(path.join(work, f), `${f}\n`);
    }
    shell('git add -A', work);
    shell('git commit -q -m base', work);
    // Real index flags — the exact states the Changes page must display.
    shell('git update-index --assume-unchanged frozen.txt', work);
    shell('git update-index --skip-worktree skippy.txt', work);
  });

  afterAll(() => {
    delete process.env.GIT_CONFIG_GLOBAL;
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('one raw call returns the -v listing real git produces', async () => {
    const out = await gitService.raw(work, [...LS_FILES_V_ARGS]);
    expect(out).toContain('frozen.txt');
    expect(out).toContain('skippy.txt');
  });

  it('parseLsFilesV classifies real assume-unchanged / skip-worktree tags', async () => {
    const out = await gitService.raw(work, [...LS_FILES_V_ARGS]);
    const scan = parseLsFilesV(out);
    // git emits 'h' for cached+assume-unchanged and 'S' for skip-worktree.
    expect(scan.assumeUnchanged).toEqual(['frozen.txt']);
    expect(scan.skipped).toEqual(['skippy.txt']);
    expect(scan.trackedTotal).toBe(4);
    expect(scan.trackedFiles).toContain('nested/deep.txt');
  });

  it('stripped-tag list equals the plain `git ls-files` output (merge parity)', async () => {
    const [verbose, plain] = await Promise.all([
      gitService.raw(work, [...LS_FILES_V_ARGS]),
      gitService.raw(work, ['ls-files']),
    ]);
    const plainList = plain.split('\n').filter(Boolean);
    const scan = parseLsFilesV(verbose);
    // Paths identical (order may differ between invocations — compare as sets).
    expect(new Set(scan.trackedFiles)).toEqual(new Set(plainList));
    expect(scan.trackedTotal).toBe(plainList.length);
  });

  it('submodule gate: repo without .gitmodules → summary output is empty (fs check equivalent)', async () => {
    // `git submodule summary` on a repo without .gitmodules prints nothing.
    const out = await gitService.raw(work, ['submodule', 'summary']);
    expect(out.trim()).toBe('');
    expect(fs.existsSync(path.join(work, '.gitmodules'))).toBe(false);
  });
});
