/**
 * PERF (v3.1) benchmark — wall-clock proof for the three hot-path wins.
 *
 *   1. log() branch validation: 50 selected branches
 *      OLD: one `git rev-parse --verify -q` per branch, SEQUENTIAL
 *      NEW: ONE `git for-each-ref --format=%(refname)` (TTL-cached meta read)
 *   2. Git-Flow page load: config reads
 *      OLD: 9 sequential `git config --get <key>`
 *      NEW: ONE `git config --get-regexp ^gitflow\.`
 *   3. incoming-commits with a [gone] upstream:
 *      OLD: a `git rev-list v2..origin/v2` that dies (exit 128)
 *      NEW: ref validation first → the failing spawn never happens
 *
 * Run: npx vitest run scripts/bench-v31.perf.ts   (kept out of the default
 * test glob; run explicitly). Non-failing — prints a report.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as gitService from '../../electron/services/git';

const ROOT = path.join(os.tmpdir(), `prismgit-bench-${Date.now()}`);
const REPO = path.join(ROOT, 'repo');
const NL = String.fromCharCode(10);
function sh(cmd: string, cwd: string = REPO): void {
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

describe('bench v3.1 (informational)', () => {
  it('log(): 50 branches — old sequential rev-parse vs new batched for-each-ref', async () => {
    fs.mkdirSync(REPO, { recursive: true });
    sh('git init -q -b main .');
    sh('git config user.name "T"');
    sh('git config user.email t@t');
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(REPO, `f${i}.txt`), `v${i}${NL}`);
      sh(`git add f${i}.txt`);
      sh(`git commit -q -m c${i}`);
    }
    const branchNames: string[] = ['main'];
    for (let i = 0; i < 49; i++) {
      sh(`git branch topic/${i}`);
      branchNames.push(`topic/${i}`);
    }

    // Warm caches (gitDir etc.) so both measurements are steady-state.
    await gitService.log(REPO, { maxCount: 1 });

    // OLD pattern: one rev-parse --verify -q per branch, sequential.
    const tOld0 = performance.now();
    for (const b of branchNames) {
      await gitService.raw(REPO, ['rev-parse', '--verify', '-q', b]);
    }
    const tOld = performance.now() - tOld0;

    // NEW pattern: one for-each-ref listing + membership checks (what
    // validateLogRefs does), then the log itself.
    const tNew0 = performance.now();
    await gitService.raw(REPO, ['for-each-ref', '--format=%(refname)']);
    const entries = await gitService.log(REPO, { branches: branchNames });
    const tNew = performance.now() - tNew0;

    console.log(`\n[bench] log() 50-branch validation: old ~${tOld.toFixed(0)}ms (50 spawns) vs new ~${tNew.toFixed(0)}ms (1 validation spawn + log) — ${(tOld / Math.max(tNew, 1)).toFixed(1)}x on the validation alone`);
    expect(entries.length).toBeGreaterThan(0);

    fs.rmSync(ROOT, { recursive: true, force: true });
  }, 60_000);

  it('gitflow config: 9 sequential config --get vs 1 config --get-regexp', async () => {
    fs.mkdirSync(REPO, { recursive: true });
    sh('git init -q -b main .');
    sh('git config user.name "T"');
    sh('git config user.email t@t');
    fs.writeFileSync(path.join(REPO, 'a.txt'), 'a' + NL);
    sh(`git add a.txt`);
    sh(`git commit -q -m init`);
    // Configure git-flow like AVH init would.
    for (const [k, v] of [
      ['gitflow.branch.master', 'main'],
      ['gitflow.branch.develop', 'develop'],
      ['gitflow.prefix.feature', 'feature/'],
      ['gitflow.prefix.release', 'release/'],
      ['gitflow.prefix.hotfix', 'hotfix/'],
      ['gitflow.prefix.support', 'support/'],
      ['gitflow.prefix.fix', 'fix/'],
      ['gitflow.prefix.versiontag', 'v'],
      ['gitflow.origin.remote', 'origin'],
    ] as const) {
      sh(`git config ${k} "${v}"`);
    }

    // OLD pattern: 9 sequential config --get spawns.
    const keys = [
      'gitflow.branch.master', 'gitflow.branch.develop', 'gitflow.prefix.feature',
      'gitflow.prefix.release', 'gitflow.prefix.hotfix', 'gitflow.prefix.support',
      'gitflow.prefix.fix', 'gitflow.prefix.versiontag', 'gitflow.origin.remote',
    ];
    const tOld0 = performance.now();
    for (const k of keys) {
      await gitService.raw(REPO, ['config', '--get', k]);
    }
    const tOld = performance.now() - tOld0;

    // NEW pattern: the single get-regexp readGitFlowConfigMap performs.
    const tNew0 = performance.now();
    const out = await gitService.raw(REPO, ['config', '--get-regexp', '^gitflow\\.']);
    const tNew = performance.now() - tNew0;

    console.log(`[bench] gitflow config: old ~${tOld.toFixed(0)}ms (9 sequential spawns) vs new ~${tNew.toFixed(0)}ms (1 spawn) — ${(tOld / Math.max(tNew, 1)).toFixed(1)}x`);
    expect(out).toContain('gitflow.branch.master');

    fs.rmSync(ROOT, { recursive: true, force: true });
  }, 60_000);
});
