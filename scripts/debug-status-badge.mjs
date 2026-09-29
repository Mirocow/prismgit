/** Debug: what status does the app see, and what do the sidebar badges render? */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/counter-debug';
const REPO = path.join(ROOT, 'repo');
const sh = (cmd, cwd = REPO) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
sh('git init -q -b main --bare origin.git', ROOT);
sh('git clone -q origin.git seeder', ROOT);
const SEEDER = path.join(ROOT, 'seeder');
sh('git config user.email e@e && git config user.name E', SEEDER);
fs.writeFileSync(path.join(SEEDER, 'f1.txt'), 'base 1\n');
sh('git add -A && git commit -q -m c1', SEEDER);
fs.writeFileSync(path.join(SEEDER, 'f2.txt'), 'base 2\n');
sh('git add -A && git commit -q -m c2', SEEDER);
sh('git push -q origin main', SEEDER);
sh('git clone -q origin.git repo', ROOT);
sh('git config user.email e@e && git config user.name E', REPO);
sh('git commit -q --allow-empty -m c3 && git push -q origin main');
// dirty: 2 modified + 1 staged + 1 untracked
fs.writeFileSync(path.join(REPO, 'f1.txt'), 'CHANGED 1\n');
fs.writeFileSync(path.join(REPO, 'f2.txt'), 'CHANGED 2\n');
fs.writeFileSync(path.join(REPO, 'staged.txt'), 'new staged\n');
fs.writeFileSync(path.join(REPO, 'untracked.txt'), 'new untracked\n');
sh('git add staged.txt');
console.log('CLI status:'); console.log(sh('git status --porcelain'));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-dbg-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
  repositories: [{ path: REPO, name: 'repo', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1500, height: 950 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('button:has-text("repo")').first().click().catch(() => {});
await page.waitForTimeout(4000);

const st = await page.evaluate(async (p) => {
  const s = await window.smartgit.git.status(p);
  return { files: s.files.length, staged: s.staged.length, paths: s.files.map(f => f.index + f.working_dir + ' ' + f.path) };
}, REPO);
console.log('APP bridge status:', JSON.stringify(st, null, 2));

const badges = await page.evaluate(() => {
  const out = [];
  for (const span of document.querySelectorAll('span')) {
    const cls = span.getAttribute('class') || '';
    if (cls.includes('badge-added') || cls.includes('bg-accent-muted')) {
      out.push({ cls: cls.slice(0, 60), text: span.textContent });
    }
  }
  return out;
});
console.log('DOM badges:', JSON.stringify(badges, null, 2));
await page.screenshot({ path: '/home/z/my-project/work/counter-debug.png' });
await app.close();
fs.rmSync(ROOT, { recursive: true, force: true });
