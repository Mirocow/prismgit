/**
 * Task 25 — end-to-end verification of the Remotes/Push/Search/Bisect fixes
 * against a REAL git repository:
 *
 *   1. push() to a NON-origin remote ('github') without upstream → succeeds, -u auto-set
 *   2. push() of a selected non-current branch does NOT push HEAD's commit
 *   3. push() with zero remotes → clear error
 *   4. log({ grep }) — commit message search incl. -i
 *   5. bisectStatus.rev — clean hash (not "commit <hash> ...")
 *   6. bisectLog() when not bisecting → '' instead of throwing
 *
 * Run: npx tsx scripts/verify-remotes-push-search-bisect.ts
 */
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  const svc = await import('../electron/services/git');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'task25-'));

  // ── Setup: working repo + two bare "remotes" (github, gitlab) ───────────
  const work = path.join(ROOT, 'work');
  const remoteA = path.join(ROOT, 'github.git');
  const remoteB = path.join(ROOT, 'gitlab.git');
  fs.mkdirSync(work, { recursive: true });
  const git = simpleGit(work);
  await git.init();
  await git.addConfig('user.email', 't@t.local');
  await git.addConfig('user.name', 'T');
  fs.writeFileSync(path.join(work, 'a.txt'), 'alpha\n');
  await git.add('a.txt');
  await git.commit('init: alpha');
  fs.writeFileSync(path.join(work, 'b.txt'), 'bravo\n');
  await git.add('b.txt');
  await git.commit('feat: bravo content');
  await git.raw(['commit', '--allow-empty', '-m', 'fix: a bugfix commit']);
  fs.writeFileSync(path.join(work, 'c.txt'), 'Charlie UNRELEASED\n');
  await git.add('c.txt');
  await git.commit('fix: unpushed third commit');
  for (const r of [remoteA, remoteB]) {
    await git.raw(['init', '--bare', r]);
  }
  await git.raw(['remote', 'add', 'github', remoteA]);
  await git.raw(['remote', 'add', 'gitlab', remoteB]);

  // ── 1. Push current branch (no upstream) to 'github' ────────────────────
  console.log('\n[1] push without upstream to non-origin remote');
  const remotes = await svc.remotes(work);
  check('both remotes listed', remotes.map((r) => r.name).sort().join(',') === 'github,gitlab', JSON.stringify(remotes.map((r) => r.name)));
  await svc.push(work, 'github');
  const remoteHeads = await simpleGit(remoteA).raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  check('branch pushed to github', remoteHeads.includes('main'), remoteHeads);
  const upstream = await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', 'main@{u}']).catch(() => '');
  check('upstream auto-set (-u)', upstream.trim() === 'github/main', upstream.trim());

  // ── 2. Push a NON-current branch must not push HEAD's commit ────────────
  console.log('\n[2] push of selected non-current branch uses its own ref');
  await git.checkout(['-b', 'feature/old']);
  await git.raw(['reset', '--hard', 'HEAD~2']); // feature/old points 2 commits back
  await git.checkout('main');
  // current HEAD = "fix: unpushed third commit"; pushing feature/old must NOT deliver it
  await svc.push(work, 'gitlab', 'feature/old');
  const glBranches = await simpleGit(remoteB).raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  check('feature/old pushed to gitlab', glBranches.includes('feature/old'), glBranches);
  const glTip = (await simpleGit(remoteB).raw(['log', '-1', '--format=%s', 'feature/old'])).trim();
  check('gitlab tip is the OLD commit (not HEAD)', glTip === 'feat: bravo content', glTip);
  const headsAfter = (await simpleGit(remoteB).raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).trim();
  check('main NOT pushed to gitlab', !headsAfter.split('\n').includes('main'), headsAfter);

  // ── 3. Push with zero remotes → clear error ─────────────────────────────
  console.log('\n[3] push with no remotes');
  const lonework = path.join(ROOT, 'lonely');
  fs.mkdirSync(lonework, { recursive: true });
  const lgit = simpleGit(lonework);
  await lgit.init();
  await lgit.addConfig('user.email', 't@t.local');
  await lgit.addConfig('user.name', 'T');
  fs.writeFileSync(path.join(lonework, 'x.txt'), 'x\n');
  await lgit.add('x.txt');
  await lgit.commit('init');
  let errMsg = '';
  try {
    await svc.push(lonework, 'origin');
  } catch (e) {
    errMsg = String((e as Error).message);
  }
  check('push to missing remote errors', errMsg.length > 0, errMsg);

  // ── 4. log({ grep }) — commit message search ────────────────────────────
  console.log('\n[4] commit message search via log --grep');
  const hits = await svc.log(work, { maxCount: 50, all: true, grep: 'bravo' });
  check('finds "feat: bravo content"', hits.length === 1 && hits[0].subject === 'feat: bravo content', JSON.stringify(hits.map((h) => h.subject)));
  const hitsCi = await svc.log(work, { maxCount: 50, all: true, grep: 'BRAVO', grepIgnoreCase: true });
  check('case-insensitive works', hitsCi.length === 1, String(hitsCi.length));
  const misses = await svc.log(work, { maxCount: 50, all: true, grep: 'does-not-exist-xyz' });
  check('no false positives', misses.length === 0, String(misses.length));

  // ── 5+6. Bisect status rev + idle log ───────────────────────────────────
  console.log('\n[5] bisect status rev is a clean hash');
  const idleLog = await svc.bisectLog(work).catch((e) => `THREW: ${e}`);
  check('bisectLog idle → empty string', idleLog === '', String(idleLog).slice(0, 80));
  await git.raw(['bisect', 'start']);
  await git.raw(['bisect', 'bad', 'HEAD']);
  await git.raw(['bisect', 'good', 'HEAD~2']);
  const st = await svc.bisectStatus(work);
  check('state=bisecting', st.state === 'bisecting');
  check('rev is a 40-char hash', /^[0-9a-f]{40}$/.test(st.rev || ''), st.rev);
  await git.raw(['bisect', 'reset']);

  console.log(`\n${'='.repeat(50)}`);
  if (failures === 0) console.log('ALL CHECKS PASSED');
  else {
    console.log(`${failures} CHECK(S) FAILED`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exitCode = 1;
});
