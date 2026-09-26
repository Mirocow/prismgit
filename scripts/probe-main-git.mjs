import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path';
import { execSync } from 'node:child_process';
const ROOT = '/tmp/prismgit-monster-switch';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-mg-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: ['heavy-repo','medium-repo','small-repo'].map((n) => ({ path: path.join(ROOT, n), name: n, lastOpened: Date.now(), pinned: false })),
  repoMetadata: {} }));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({ windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false } }));
const app = await electron.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: ':99', PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' }, timeout: 30000 });
const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
const pid = app.process().pid; const seen = new Map();
const sampler = setInterval(() => {
  try {
    const out = execSync("ps -eo pid,ppid,etime,args --no-headers | awk -v M=" + pid + " '$2==M && ($4==\"git\" || $4==\"/usr/bin/git\")' || true", { encoding: 'utf8', timeout: 2000 });
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      if (m && !seen.has(m[1])) seen.set(m[1], { etime: m[3], args: m[4].slice(0, 120) });
    }
  } catch {}
}, 100);
const t0 = Date.now();
await page.locator('[data-testid="repo-item-heavy-repo"]').first().click({ timeout: 10000 });
await page.locator('text=main').first().waitFor({ timeout: 30000 }).catch(() => {});
console.log(`wall: ${Date.now() - t0}ms`);
await page.waitForTimeout(3000); clearInterval(sampler);
console.log(`\ngit children spawned DIRECTLY by MAIN (pid ${pid}) during heavy-repo open:`);
for (const [p, v] of seen) console.log(`  pid=${p} etime=${v.etime} :: ${v.args}`);
if (!seen.size) console.log('  (none)');
try { await app.close(); } catch {}
process.exit(0);
