/**
 * Task 24 continuation — edge-case verification of stashFiles / stashFileRawDiff
 * on a REAL git repository (not mocks):
 *
 *   1. Rename inside a stash (name-status "R100" two-path form)
 *   2. Binary tracked + binary untracked file in a stash
 *   3. Paths with spaces / quotes / unicode in a stash (incl. untracked)
 *   4. Multiple stashes (stash@{0} vs stash@{1} — hash must resolve per stash)
 *   5. Mixed stash: tracked + untracked together (--include-untracked)
 *
 * Run: npx tsx scripts/verify-stash-edge-cases.ts
 */
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-edge-'));
let failures = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function makeRepo(name: string): Promise<string> {
  const dir = path.join(ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@test.local');
  await git.addConfig('user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  await git.add('base.txt');
  await git.commit('init');
  return dir;
}

async function main() {
  const { stashFiles, stashFileRawDiff } = await import('../electron/services/git');

  // ── 1. Rename inside a stash ────────────────────────────────────────────
  console.log('\n[1] Rename in stash (staged rename via git mv)');
  {
    const dir = await makeRepo('rename');
    const git = simpleGit(dir);
    fs.writeFileSync(path.join(dir, 'old-name.txt'), 'hello\n');
    await git.add('old-name.txt');
    await git.commit('add file');
    await git.mv('old-name.txt', 'new-name.txt'); // staged rename → R in name-status
    await git.stash(['push', '-m', 'renamed']);
    const hash = (await git.raw(['rev-parse', 'stash@{0}'])).trim();
    const files = await stashFiles(dir, hash);
    const ren = files.find((f) => f.status.startsWith('R'));
    check('rename listed (R + oldPath)', !!ren && ren.path === 'new-name.txt' && ren.oldPath === 'old-name.txt',
      JSON.stringify(files));
    if (ren) {
      const raw = await stashFileRawDiff(dir, hash, ren.path);
      // One-sided pathspec makes git show the new side as "new file mode" —
      // same as `git stash show -- <file>`. What matters: full content present.
      check('rename raw diff has file content', raw.includes('+hello'), raw.slice(0, 200));
    }
  }

  // ── 2. Binary files ─────────────────────────────────────────────────────
  console.log('\n[2] Binary files in stash');
  {
    const dir = await makeRepo('binary');
    const git = simpleGit(dir);
    // tracked binary: commit it, then modify
    fs.writeFileSync(path.join(dir, 'tracked.bin'), Buffer.from([0, 1, 2, 3, 255]));
    await git.add('tracked.bin');
    await git.commit('bin');
    fs.writeFileSync(path.join(dir, 'tracked.bin'), Buffer.from([0, 1, 2, 3, 255, 254, 0]));
    // untracked binary
    fs.writeFileSync(path.join(dir, 'untracked.bin'), Buffer.from([137, 80, 78, 71, 13, 10]));
    await git.stash(['push', '--include-untracked', '-m', 'bins']);
    const hash = (await git.raw(['rev-parse', 'stash@{0}'])).trim();
    const files = await stashFiles(dir, hash);
    check('tracked.bin listed', files.some((f) => f.path === 'tracked.bin'));
    check('tracked.bin marked binary', files.find((f) => f.path === 'tracked.bin')?.binary === true, JSON.stringify(files));
    check('untracked.bin listed', files.some((f) => f.path === 'untracked.bin'));
    const raw = await stashFileRawDiff(dir, hash, 'untracked.bin');
    check('untracked.bin raw diff non-empty', raw.trim().length > 0);
  }

  // ── 3. Weird file names ─────────────────────────────────────────────────
  console.log('\n[3] Paths with spaces / quotes / unicode');
  {
    const dir = await makeRepo('weird');
    const git = simpleGit(dir);
    const names = ['with space.txt', "with'quote.txt", 'uni-файл-文件.txt'];
    for (const n of names) fs.writeFileSync(path.join(dir, n), `content of ${n}\n`);
    await git.stash(['push', '--include-untracked', '-m', 'weird']);
    const hash = (await git.raw(['rev-parse', 'stash@{0}'])).trim();
    const files = await stashFiles(dir, hash);
    for (const n of names) {
      check(`listed: ${n}`, files.some((f) => f.path === n), JSON.stringify(files.map((f) => f.path)));
      const raw = await stashFileRawDiff(dir, hash, n);
      check(`raw diff: ${n}`, raw.trim().length > 0);
    }
  }

  // ── 4. Multiple stashes ─────────────────────────────────────────────────
  console.log('\n[4] Multiple stashes resolve to their own hashes');
  {
    const dir = await makeRepo('multi');
    const git = simpleGit(dir);
    fs.appendFileSync(path.join(dir, 'base.txt'), 'change one\n');
    await git.stash(['push', '-m', 'first']);
    fs.appendFileSync(path.join(dir, 'base.txt'), 'change two\n');
    await git.stash(['push', '-m', 'second']);
    const h0 = (await git.raw(['rev-parse', 'stash@{0}'])).trim();
    const h1 = (await git.raw(['rev-parse', 'stash@{1}'])).trim();
    check('distinct hashes', h0 !== h1);
    const f0 = await stashFiles(dir, h0);
    const f1 = await stashFiles(dir, h1);
    check('stash@{0} has only its change', f0.length === 1 && f0[0].path === 'base.txt', JSON.stringify(f0));
    // both stashes touch base.txt — same path, that's expected; ensure diffs differ
    // NOTE: stash@{0} is the LATEST stash ("second"), stash@{1} is "first"
    const d0 = await stashFileRawDiff(dir, h0, 'base.txt');
    const d1 = await stashFileRawDiff(dir, h1, 'base.txt');
    check('diff contents differ per stash', d0.includes('change two') && d1.includes('change one'),
      `d0=${d0.slice(0, 120)} d1=${d1.slice(0, 120)}`);
  }

  // ── 5. Mixed stash: tracked modification + untracked file ───────────────
  console.log('\n[5] Mixed stash (tracked + untracked together)');
  {
    const dir = await makeRepo('mixed');
    const git = simpleGit(dir);
    fs.appendFileSync(path.join(dir, 'base.txt'), 'tracked modification\n');
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'untracked content\n');
    await git.stash(['push', '--include-untracked', '-m', 'mixed']);
    const hash = (await git.raw(['rev-parse', 'stash@{0}'])).trim();
    const files = await stashFiles(dir, hash);
    check('2 files in stash', files.length === 2, JSON.stringify(files));
    check('tracked modification listed', files.some((f) => f.path === 'base.txt'));
    check('untracked listed as A', files.find((f) => f.path === 'untracked.txt')?.status === 'A', JSON.stringify(files));
    const rTracked = await stashFileRawDiff(dir, hash, 'base.txt');
    const rUntracked = await stashFileRawDiff(dir, hash, 'untracked.txt');
    check('tracked part diff', rTracked.includes('tracked modification'));
    check('untracked part diff', rUntracked.includes('untracked content'));
  }

  console.log(`\n${'='.repeat(50)}`);
  if (failures === 0) console.log('ALL EDGE CASES PASSED');
  else {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exitCode = 1;
});
