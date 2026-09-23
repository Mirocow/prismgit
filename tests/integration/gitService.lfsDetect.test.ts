/**
 * detectLfsConfigured — false-positive regression (e2e-blocking).
 *
 * The app's git env (electron/services/git-env.ts) injects EMPTY
 * `filter.lfs.process/smudge/clean` + `core.hooksPath` GIT_CONFIG overrides
 * into EVERY git command (LFS smudge bypass). detectLfsConfigured's old
 * plain `git config --get-regexp '^filter\.lfs\.'` matched those env
 * entries on EVERY repository — so a repo with zero LFS traces reported
 * "LFS configured", the app popped the "Git LFS is configured but not
 * installed" modal on every repo open, and the modal's overlay
 * (z-[60], fixed inset-0) intercepted every click (the entire e2e suite
 * timed out on its first sidebar click).
 *
 * The fix scopes the config probes with --local (reads .git/config only,
 * immune to env overrides). These tests call the service directly, which
 * builds the same env the app runs with — so the regression is pinned at
 * the exact layer where it happened.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

const ROOT = path.join(os.tmpdir(), 'prismgit-repos', 'lfs-detect');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function initRepo(name: string): string {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  shell('git init -q -b main', dir);
  shell('git config user.name "Lfs T"', dir);
  shell('git config user.email "lfs@t.dev"', dir);
  return dir;
}

describe('detectLfsConfigured — env-override false positive', () => {
  beforeAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('clean repo with NO LFS traces → false (was true → spurious modal)', async () => {
    const repo = initRepo('clean');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
    shell('git add f.txt && git commit -q -m base', repo);
    // Sanity: no .gitattributes, no local filter.lfs, no hooks.
    expect(fs.existsSync(path.join(repo, '.gitattributes'))).toBe(false);

    // The service injects GIT_CONFIG_COUNT overrides (git-env.ts) — the
    // exact conditions under which the bug fired. Must stay FALSE.
    expect(await gitService.detectLfsConfigured(repo)).toBe(false);
  });

  it('.gitattributes with filter=lfs → true (real LFS repo still detected)', async () => {
    const repo = initRepo('attr');
    fs.writeFileSync(path.join(repo, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n');
    expect(await gitService.detectLfsConfigured(repo)).toBe(true);
  });

  it('.gitattributes WITHOUT lfs rules → false', async () => {
    const repo = initRepo('attr-plain');
    fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt text=auto\n');
    expect(await gitService.detectLfsConfigured(repo)).toBe(false);
  });

  it('local config filter.lfs.* (repo-scoped lfs install) → true', async () => {
    const repo = initRepo('localcfg');
    shell('git config --local filter.lfs.process "git-lfs filter-process"', repo);
    shell('git config --local filter.lfs.smudge "git-lfs smudge -- %f"', repo);
    expect(await gitService.detectLfsConfigured(repo)).toBe(true);
  });

  it('global-config-only filter.lfs (user-level install, no repo traces) → false', async () => {
    // Repo-level detection must not depend on the machine's global config:
    // a user-wide `git lfs install` says nothing about THIS repo.
    const repo = initRepo('globalcfg');
    // Simulate via GIT_CONFIG_GLOBAL (isolated temp file) — the service env
    // chain also passes this through, replicating a global-config machine.
    const globalFile = path.join(ROOT, 'global-with-lfs');
    fs.writeFileSync(globalFile, '[filter "lfs"]\n\tprocess = git-lfs filter-process\n');
    process.env.GIT_CONFIG_GLOBAL = globalFile;
    try {
      expect(await gitService.detectLfsConfigured(repo)).toBe(false);
    } finally {
      delete process.env.GIT_CONFIG_GLOBAL;
    }
  });

  it('LFS hook in .git/hooks → true', async () => {
    const repo = initRepo('hooks');
    const hooksDir = path.join(repo, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'post-checkout'), '#!/bin/sh\ngit lfs post-checkout "$@"\n');
    expect(await gitService.detectLfsConfigured(repo)).toBe(true);
  });
});
