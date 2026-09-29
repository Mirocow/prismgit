#!/usr/bin/env node
/**
 * Verify: "При нажатии кнопки 'Check all repositories for remote changes
 * (fetch + incoming/outgoing)' ui ушел в полные тормоза" + "При закрытии
 * приложения такие же тормоза".
 *
 * Launches the BUILT app against a sidebar of N repos (real local remotes,
 * background fetch enabled — the remote-status poll), clicks the sidebar's
 * Check-all button (refresh icon) and measures:
 *
 *   - mainPingsMs : configGet round-trips THROUGH the main process every
 *                   ~150 ms WHILE the check runs — the "is main alive" probe.
 *                   Freeze regression = pings spiking to seconds.
 *   - spawn attribution: every `git` subprocess is attributed to its PARENT —
 *                   the stats sweep (log -1 / rev-list --count / branch /
 *                   remote) must be born by the WORKER process, not main.
 *   - longtasks    : renderer main-thread blocks during the check.
 *   - quitMs       : window.close() → electron process exit (budget 3 s).
 *                   orphanGit: live `git` children of the (dying) worker
 *                   AFTER the app process is gone — must be 0.
 *
 * Usage: xvfb-run -a node scripts/verify-checkall-quit.mjs
 *   PRISMGIT_VERIFY_REPOS=8   — sidebar size (default 8)
 */
import { _electron as electron } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_COUNT = Math.max(1, parseInt(process.env.PRISMGIT_VERIFY_REPOS || '8', 10));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-verify-ca-'));
const repos = [];
function sh(cmd, cwd) { execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

for (let i = 0; i < REPO_COUNT; i++) {
  const remote = path.join(root, `remote-${i}.git`);
  const clone = path.join(root, `clone-${i}`);
  sh(`git init --bare -q "${remote}"`);
  sh(`git clone -q "${remote}" "${clone}"`);
  sh('git config user.email verify@test', clone);
  sh('git config user.name Verify', clone);
  fs.writeFileSync(path.join(clone, `file-${i}.txt`), `hello ${i}\n`);
  sh('git add .', clone);
  sh('git commit -q -m base', clone);
  sh('git push -q origin HEAD:refs/heads/main', clone);
  fs.writeFileSync(path.join(clone, 'local.txt'), 'local\n');
  sh('git add .', clone);
  sh('git commit -q -m outgoing-commit', clone); // outgoing=1
  repos.push({ path: clone, name: `clone-${i}` });
}
console.log(`fixture: ${REPO_COUNT} repos with local remotes (background fetch on)`);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-verify-ud-'));
const bgMap = {};
for (const r of repos) bgMap[r.path] = ['origin'];
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: false, // no background poll noise — we drive the button
    repoRemoteCheckIntervalSec: 3600,
    backgroundFetchRemotes: bgMap,
  },
  repositories: repos.map((r, i) => ({ path: r.path, name: r.name, lastOpened: Date.now() - i, pinned: false })),
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'en',
  },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);

// longtask observer in the renderer
await page.evaluate(() => {
  (window).__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window).__longtasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* older Chromium */ }
});

// Renderer-side ping helper (an IPC round-trip THROUGH main → git).
const ping = () => page.evaluate(() => window.smartgit.git.configGet('/verify/repo-0', 'user.name', 'local').catch(() => 'err'));

function snapshot() {
  const map = new Map();
  const out = execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf-8' });
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return map;
}
const appPid = app.process().pid;
function findWorker(snap) {
  for (const [pid, p] of snap) {
    if (p.ppid === appPid && p.cmd.includes('--utility-sub-type=node.mojom.NodeService')) return pid;
  }
  return null;
}

// Click the Check-all button (the sidebar refresh icon with the full tooltip).
const checkBtn = page.locator('button[title*="Check all repositories"]').first();
await checkBtn.waitFor({ state: 'visible', timeout: 15000 });
console.log('check-all button found — clicking');

const t0 = Date.now();
await checkBtn.click();

// Ping main WHILE the check runs + attribute git spawns to their parents.
const pings = [];
let workerPid = null;
const ATTR = { worker: 0, main: 0, workerCmds: new Map(), mainCmds: new Map() };
const BUDGET = 20000;
while (Date.now() - t0 < BUDGET) {
  const pingStart = Date.now();
  await ping();
  pings.push(Date.now() - pingStart);
  const snap = snapshot();
  if (workerPid == null) workerPid = findWorker(snap);
  for (const [pid, p] of snap) {
    if (!p.cmd || pid === appPid || pid === workerPid) continue;
    const isGit = /(^|\/)git( |$)/.test(p.cmd) && !p.cmd.includes('gitPollWorker');
    if (!isGit) continue;
    if (workerPid != null && p.ppid === workerPid) {
      ATTR.worker++;
      const key = p.cmd.replace(/^.*?git /, 'git ').slice(0, 46);
      ATTR.workerCmds.set(key, (ATTR.workerCmds.get(key) ?? 0) + 1);
    } else if (p.ppid === appPid) {
      ATTR.main++;
      const key = p.cmd.replace(/^.*?git /, 'git ').slice(0, 46);
      ATTR.mainCmds.set(key, (ATTR.mainCmds.get(key) ?? 0) + 1);
    }
  }
}
const checkMs = Date.now() - t0;
const longtasks = await page.evaluate(() => (window).__longtasks || []);

const p50 = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
const worstPing = Math.max(...pings, 0);

console.log(`\n── check-all while running (${(checkMs / 1000).toFixed(1)} s sampling) ──`);
console.log(`main IPC pings: n=${pings.length} p50=${p50(pings) ?? '-'} ms p95=${p95(pings) ?? '-'} ms worst=${worstPing} ms`);
console.log(`renderer longtasks: ${longtasks.length}${longtasks.length ? ' (worst ' + Math.max(...longtasks) + ' ms)' : ''}`);
console.log(`git spawns: worker-born=${ATTR.worker} main-born=${ATTR.main}`);
for (const [cmd, n] of ATTR.workerCmds) console.log(`  worker: ${n}× ${cmd}`);
for (const [cmd, n] of ATTR.mainCmds) console.log(`  main:   ${n}× ${cmd}`);
if (workerPid == null) console.log('NOTE: worker process never appeared (all jobs ran in-process)');

// ── QUIT timing + orphan check ────────────────────────────────────────────
console.log('\n── quitting ──');
// Make sure a worker (and possibly children) exist at quit time: fire one more
// check (fetches + stats) and close WHILE it runs — the orphan scenario.
await checkBtn.click();
await page.waitForTimeout(400); // let the burst start

const snapBefore = snapshot();
const quitStart = Date.now();
await app.close(); // closes windows → before-quit → graceful worker shutdown
// app.close() resolves when the electron process is gone.
const quitMs = Date.now() - quitStart;
console.log(`quit: electron process exited in ${quitMs} ms (budget 3000)`);

// Orphan scan: any LIVE git child whose parent was the (now dead) worker.
const snapAfter = snapshot();
let orphans = 0;
for (const [pid, p] of snapAfter) {
  const isGit = /(^|\/)git( |$)/.test(p.cmd) && !p.cmd.includes('gitPollWorker');
  if (!isGit) continue;
  const parent = snapAfter.get(p.ppid);
  // Parent gone (was the worker) or parent is OUR root fixture shell → orphan.
  if (!parent || p.ppid === workerPid) {
    orphans++;
    console.log(`  ORPHAN git pid=${pid} ppid=${p.ppid}: ${p.cmd.slice(0, 70)}`);
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
console.log(`orphaned git processes after quit: ${orphans} (must be 0)`);

// ── verdict ───────────────────────────────────────────────────────────────
const FAIL = [];
if (worstPing > 1000) FAIL.push(`main ping worst=${worstPing} ms > 1000 (main-loop contention)`);
if (ATTR.main > 0 && workerPid != null) FAIL.push(`${ATTR.main} git spawns born in MAIN during the check (expected 0)`);
if (longtasks.filter((d) => d > 500).length > 2) FAIL.push('renderer had >2 longtasks over 500 ms');
if (quitMs > 3000) FAIL.push(`quit took ${quitMs} ms > 3000`);
if (orphans > 0) FAIL.push(`${orphans} orphaned git processes survived the quit`);
fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(FAIL.length ? `\nFAIL: ${FAIL.join('; ')}` : '\nPASS: main stayed responsive, stats ran in the worker, quit was fast, no orphans');
process.exit(FAIL.length ? 1 : 0);
