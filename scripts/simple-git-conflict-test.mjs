/**
 * Empirical check: what does simple-git's `raw(['pull', ...])` throw when the
 * pull hits merge conflicts? Does the error message contain 'CONFLICT'?
 * (The renderer's pull handlers branch on msg.includes('CONFLICT') to decide
 * whether to refreshStatus and warn — if the word is missing, a conflicted
 * pull shows a transient toast and the UI never enters conflict state.)
 */
import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = '/tmp/simple-git-conflict-test';
const shell = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = path.join(ROOT, 'empty-config');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

shell('git init -q --bare origin.git', ROOT);
shell(`git clone -q ${ROOT}/origin.git work`, ROOT);
const work = path.join(ROOT, 'work');
shell('git config user.name "Ivan Testov"', work);
shell('git config user.email "ivan@test.dev"', work);

// base commit
fs.writeFileSync(path.join(work, 'file.txt'), 'base\n');
shell('git add file.txt', work);
shell('git commit -q -m base', work);
const branch = shell('git symbolic-ref --short HEAD', work);
shell('git push -q -u origin HEAD:main', work);
// Point the bare's HEAD at main so clones check out the right branch.
shell('git symbolic-ref HEAD refs/heads/main', path.join(ROOT, 'origin.git'));
if (branch !== 'main') shell('git branch -q -m main', work);
shell('git clone -q origin.git other', ROOT);
const other = path.join(ROOT, 'other');
shell('git config user.name "Petr Remotev"', other);
shell('git config user.email "petr@remote.dev"', other);
fs.writeFileSync(path.join(other, 'file.txt'), 'remote change\n');
shell('git add file.txt', other);
shell('git commit -q -m "remote edit"', other);
shell('git push -q origin HEAD:main', other);

// local conflicting edit
fs.writeFileSync(path.join(work, 'file.txt'), 'local change\n');
shell('git add file.txt', work);
shell('git commit -q -m "local edit"', work);

// ── The app's exact call: simple-git raw pull with --no-rebase ──────────────
const git = simpleGit(work);
const args = ['pull', '--no-rebase', 'origin', 'main'];
try {
  await git.raw(args);
  console.log('PULL RESOLVED (unexpected)');
} catch (e) {
  console.log('=== THREW ===');
  console.log('error name:', e?.name);
  console.log('message >>>', JSON.stringify(e?.message));
  console.log('has CONFLICT in message:', /CONFLICT/i.test(e?.message || ''));
  console.log('has conflict in message:', /conflict/i.test(e?.message || ''));
}

// Repo state check — what status sees afterwards
const st = await git.status();
console.log('=== STATE ===');
console.log('isMerging (MERGE_HEAD exists):', fs.existsSync(path.join(work, '.git', 'MERGE_HEAD')));
console.log('conflicted files:', st.conflicted);
