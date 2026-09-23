/**
 * In-container e2e sanity check for the reset→incoming fix.
 * Uses the REAL src modules (incomingCommits, gitGraph) against a scratch
 * git repo that reproduces the user's `git reset --hard` scenario, without
 * needing the electron binary (vitest integration suites need it; this
 * doesn't).
 *
 * Run: npx tsx scripts/verify-reset-incoming.ts   (from repo root)
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { incomingRevListArgs, parseRevList } from '../src/lib/incomingCommits';
import { computeGraph } from '../src/lib/gitGraph';

const ROOT = path.join(os.tmpdir(), 'prismgit-verify-reset');
const shell = (cmd: string, cwd: string) =>
  execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = path.join(ROOT, 'empty-config');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

shell('git init -q --bare origin.git', ROOT);
shell(`git clone -q ${path.join(ROOT, 'origin.git')} work`, ROOT);
const work = path.join(ROOT, 'work');
shell('git config user.name "Ivan Testov"', work);
shell('git config user.email "ivan@test.dev"', work);

for (let i = 1; i <= 6; i++) {
  fs.writeFileSync(path.join(work, 'file.txt'), `line ${i}\n`);
  shell('git add file.txt', work);
  shell(`git commit -q -m "base ${i}"`, work);
}
shell('git push -q -u origin HEAD:main', work);
// The clone's default branch name may be 'master' — we pushed to remote
// 'main', so rename the local branch to match.
if (shell('git symbolic-ref --short HEAD', work) !== 'main') shell('git branch -q -m main', work);

// ── User's action: hard reset 3 back; remote keeps all 6 ────────────────────
shell('git reset -q --hard HEAD~3', work);
// Contamination: a backup branch (common after resets / on busy repos).
shell('git branch backup origin/main', work);

// 1) Incoming set via the FIXED helper (what HistoryPage now calls)
const scope = { mode: 'head+upstream' as const, currentBranch: 'main', upstream: 'origin/main' };
const args = incomingRevListArgs(scope);
const incoming = parseRevList(shell(`git ${args.join(' ')}`, work));
console.log('incoming args:', args.join(' '));
console.log('incoming size:', incoming.size, incoming.size === 3 ? '✓ (3 remote-only commits)' : '✗ FAIL');

// 2) The OLD global computation — must be contaminated (documents the bug)
const oldArgs = ['rev-list', '--remotes', '--not', '--branches'];
const oldIncoming = parseRevList(shell(`git ${oldArgs.join(' ')}`, work));
console.log('old global set size:', oldIncoming.size, oldIncoming.size === 0 ? '✓ (contaminated by backup — this was the bug)' : '✗ unexpected');

// 3) Graph layout sanity: post-reset log (main + origin/main) with the
//    incoming flags → rows 0-2 flagged incoming, main at row 3.
const logFmt = '%H%x00%h%x00%P%x00%p%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00%D';
const raw = shell(
  `git log -50 --pretty=format:${logFmt}%x1e --date=iso-strict --decorate=full --topo-order main origin/main`,
  work,
);
type Entry = { hash: string; parents: string[]; refs: string[]; subject: string };
const entries: Entry[] = raw
  .split('\x1e')
  .map((chunk) => chunk.replace(/^\n/, ''))
  .filter(Boolean)
  .map((chunk) => {
    const f = chunk.split('\x00');
    return {
      hash: f[0], parents: (f[2] || '').split(' ').filter(Boolean), refs: (f[12] || '').split(', ').filter(Boolean), subject: f[10],
    };
  });

const layout = computeGraph(entries as any);
const flagged = layout.rows.filter((r) => r.node && incoming.has(r.node.entry.hash));
const mainRow = layout.rows.findIndex((r) => r.node?.entry.refs.some((x) => x.includes('refs/heads/main')));
console.log('graph rows:', layout.rows.length, '| incoming-flagged rows:', flagged.length, flagged.length === 3 ? '✓' : '✗ FAIL');
console.log('main row index:', mainRow, mainRow === 3 ? '✓ (below the 3 incoming rows)' : '✗ FAIL');
console.log('row0 refs:', entries[0].refs.join(', '), entries[0].refs.some((r) => r.includes('refs/remotes/origin/main')) ? '✓ origin/main at tip' : '✗ FAIL');

const ok = incoming.size === 3 && oldIncoming.size === 0 && flagged.length === 3 && mainRow === 3;
console.log(ok ? '\nALL CHECKS PASSED' : '\nCHECKS FAILED');
process.exit(ok ? 0 : 1);
