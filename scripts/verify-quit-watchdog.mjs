#!/usr/bin/env node
/**
 * Verify the QUIT WATCHDOG (v3.7): «проблема с закрытием приложения при
 * открытии репозитория осталась» — the quit could not be reproduced in-house
 * (all guarded paths measured 50–100 ms), so the quit is now ABSOLUTELY
 * bounded by a 3 s hard watchdog (app.exit(0)).
 *
 * This harness makes the quit chain as BAD as it can possibly get:
 *  - PRISMGIT_QUIT_SIMULATE_WEDGE=1: before-quit parks the quit FOREVER (no
 *    re-quit, no dispose, no flushes) — the pre-watchdog app would hang
 *    INDEFINITELY in exactly this state;
 *  - a repo is OPEN (worker watcher + status burst);
 *  - a git fetch to a never-answering remote is IN FLIGHT (the child the
 *    watchdog must kill from main via the 'children' reports).
 *
 * PASS = process death ≤ 4.5 s (watchdog fired) + zero orphaned git procs.
 *
 * Usage: DISPLAY=:99 node scripts/verify-quit-watchdog.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-watchdog-'));

function sh(cmd, cwd) { execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

const hungServer = net.createServer(() => { /* swallow — never answer */ });
await new Promise((res) => hungServer.listen(0, '127.0.0.1', res));
const hungPort = hungServer.address().port;

const remote = path.join(ROOT, 'remote.git');
const clone = path.join(ROOT, 'clone');
sh(`git init --bare -q "${remote}"`);
sh(`git clone -q "${remote}" "${clone}"`);
sh('git config user.email q@test', clone);
sh('git config user.name Q', clone);
fs.writeFileSync(path.join(clone, 'a.txt'), 'hello\n');
sh('git add .', clone);
sh('git commit -q -m base', clone);
sh('git push -q origin HEAD:refs/heads/master', clone);
sh(`git remote set-url origin http://127.0.0.1:${hungPort}/x.git`, clone);
console.log(`fixture: ${clone} (hung remote :${hungPort})`);

function snapshot() {
  const map = new Map();
  const out = execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return map;
}

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-wd-'));
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

let out = '';
const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: ud, PRISMGIT_LOCALE: 'ru',
    PRISMGIT_QUIT_LOG: '1',
    PRISMGIT_QUIT_SIMULATE_WEDGE: '1', // ← the quit chain is WEDGED on purpose
  },
  stdout: 'pipe',
  timeout: 60000,
});
app.process().stdout?.on('data', (d) => { out += String(d); process.stdout.write(String(d)); });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);

// Open the repo (repo page + watcher + status burst).
await page.locator('[data-testid="repo-item-clone"]').first().click({ timeout: 15000 });
for (let i = 0; i < 100; i++) {
  const shown = await page.evaluate(() => {
    const foot = document.querySelector('footer');
    return !!foot && /master|main/.test(foot.textContent || '');
  }).catch(() => false);
  if (shown) break;
  await page.waitForTimeout(200);
}
// Wait for the hung fetch to be in flight (worker child alive).
let fetchPid = null;
for (let i = 0; i < 40 && fetchPid == null; i++) {
  await page.waitForTimeout(250);
  const snap = snapshot();
  for (const [pid, p] of snap) {
    if (/fetch --prune/.test(p.cmd || '')) { fetchPid = pid; break; }
  }
}
console.log(`repo open; hung fetch pid pre-quit: ${fetchPid ?? 'none seen (still ok — children report covers any child)'}`);

// QUIT — the chain is wedged; ONLY the watchdog can end this process.
const pid = app.process().pid;
const t0 = Date.now();
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
app.close().catch(() => { /* the wedge makes playwright's close hang; ignore */ });
let deathMs = null;
while (Date.now() - t0 < 15000) {
  await new Promise((r) => setTimeout(r, 50));
  if (!alive()) { deathMs = Date.now() - t0; break; }
}
if (deathMs == null) {
  console.log(`❌❌ PROCESS STILL ALIVE after 15 s — watchdog FAILED`);
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(1);
}
console.log(`\nwedge-quit process death: ${deathMs} ms (budget 4500) ${deathMs > 4500 ? '❌ TOO SLOW' : '✓'}`);

const watchdogFired = out.includes('quit watchdog FIRED');
console.log(`watchdog fired log: ${watchdogFired ? '✓' : '❌ MISSING (death came from somewhere else!)'}`);
const wedgeLog = out.includes('SIMULATED WEDGE');
console.log(`wedge hook active: ${wedgeLog ? '✓' : '❌'}`);

// Orphan sweep: the hung fetch (worker child) must NOT survive the app.
await new Promise((r) => setTimeout(r, 300));
const snap2 = snapshot();
let orphans = 0;
for (const [p, proc] of snap2) {
  if (/git( |$)/.test(proc.cmd || '') && !proc.cmd.includes('gitPollWorker') && proc.ppid === 1) {
    orphans++;
    console.log(`  ORPHAN pid=${p}: ${(proc.cmd || '').slice(0, 80)}`);
    try { process.kill(p, 'SIGKILL'); } catch { /* gone */ }
  }
}
console.log(`orphans after watchdog quit: ${orphans} (must be 0)`);

hungServer.close();
const pass = deathMs <= 4500 && watchdogFired && orphans === 0;
console.log(pass ? '\nWATCHDOG VERIFICATION: PASS' : '\nWATCHDOG VERIFICATION: FAIL');
process.exit(pass ? 0 : 1);
