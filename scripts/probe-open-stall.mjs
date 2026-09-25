#!/usr/bin/env node
/**
 * Diagnose: repo open on a 24k-file repo never completes (branch chip never
 * appears in the footer within 60 s). Find WHERE it stalls:
 *  - does the click register (sidebar item becomes selected)?
 *  - is the RENDERER main thread blocked (long tasks / unresponsive evaluate)?
 *  - is MAIN blocked (IPC probe RTT)?
 *  - what does the footer actually contain?
 *  - console errors?
 *
 * Usage: DISPLAY=:99 node scripts/probe-open-stall.mjs [files]
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-openstall-'));
const FILES = Number(process.argv[2] ?? 24000);

function sh(cmd, cwd) { execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

const hungServer = net.createServer(() => { /* swallow */ });
await new Promise((res) => hungServer.listen(0, '127.0.0.1', res));
const hungPort = hungServer.address().port;

const remote = path.join(ROOT, 'remote.git');
const clone = path.join(ROOT, 'clone');
if (!fs.existsSync(path.join(clone, '.git'))) {
  sh(`git init --bare -q "${remote}"`);
  sh(`git clone -q "${remote}" "${clone}"`);
  sh('git config user.email q@test', clone);
  sh('git config user.name Q', clone);
  fs.mkdirSync(path.join(clone, 'src'), { recursive: true });
  for (let i = 0; i <= FILES; i++) {
    fs.writeFileSync(path.join(clone, 'src', `f${i}.ts`), `export const a${i} = ${i};\n`);
  }
  sh('git add .', clone);
  sh('git commit -q -m base', clone);
  sh('git push -q origin HEAD:refs/heads/main', clone);
}
sh(`git remote set-url origin http://127.0.0.1:${hungPort}/x.git`, clone);
console.log(`fixture: ${clone} (${FILES} files, hung remote :${hungPort})`);

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-openstall-'));
fs.writeFileSync(path.join(ud, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: true,
    repoRemoteCheckIntervalSec: 30,
    backgroundFetchRemotes: { [clone]: ['origin'] },
  },
  repositories: [{ path: clone, name: 'clone', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(ud, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: ud, PRISMGIT_LOCALE: 'ru',
    PRISMGIT_QUIT_LOG: '1', PRISMGIT_LOOP_LOG: '1',
  },
  stdout: 'pipe',
  timeout: 60000,
});
const lines = [];
app.process().stdout?.on('data', (d) => {
  const s = String(d);
  process.stdout.write(s);
  lines.push(s);
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

// Renderer console + errors.
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[renderer ${m.type()}] ${m.text().slice(0, 160)}`);
});
page.on('pageerror', (e) => console.log(`[renderer pageerror] ${String(e).slice(0, 200)}`));

console.log('\n== pre-click state ==');
console.log(await page.evaluate(() => ({
  repoItems: document.querySelectorAll('[data-testid^="repo-item-"]').length,
  footer: (document.querySelector('footer')?.textContent || '').slice(0, 120),
})));

// Longtask observer BEFORE the click.
await page.evaluate(() => {
  window.__longs = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longs.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  } catch { /* noop */ }
});

const t0 = Date.now();
await page.locator('[data-testid="repo-item-clone"]').first().click({ timeout: 15000 });
console.log(`\nclick ok (${Date.now() - t0}ms) — polling state for 90 s…`);

for (let i = 0; i < 45; i++) {
  await page.waitForTimeout(2000);
  const probeT0 = Date.now();
  let state = null;
  try {
    state = await Promise.race([
      page.evaluate(() => ({
        footer: (document.querySelector('footer')?.textContent || '').slice(0, 140),
        loading: !!document.querySelector('[class*="animate-spin"], [class*="spinner"]'),
        main: document.querySelector('main')?.textContent?.slice(0, 80) ?? null,
        longs: window.__longs,
      })),
      new Promise((r) => setTimeout(() => r('EVAL-TIMEOUT'), 3000)),
    ]);
  } catch (e) {
    state = `EVAL-ERROR ${String(e).slice(0, 80)}`;
  }
  const evalMs = Date.now() - probeT0;
  const branchOk = typeof state === 'object' && /master|main/.test(state.footer || '');
  console.log(`+${((i + 1) * 2)}s  eval=${evalMs}ms  ${branchOk ? '✅ BRANCH SHOWN' : '—'}  ${typeof state === 'object' ? `footer="${state.footer?.replace(/\s+/g, ' ').slice(0, 90)}" spin=${state.loading} longs=${(state.longs || []).slice(-3)}` : state}`);
  if (branchOk) break;
}

console.log('\n== loop blocks (main process) during the window ==');
for (const l of lines.join('').split('\n')) {
  if (l.includes('[loop') || l.includes('[quit')) console.log(`   ${l.trim()}`);
}
await app.close().catch(() => {});
hungServer.close();
console.log('\ndone');
process.exit(0);
