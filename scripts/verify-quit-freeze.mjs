#!/usr/bin/env node
/**
 * Verify: "При закрытии приложение намертво зависает на некоторое время".
 *
 * Reproduces the quit-freeze with THREE scenarios:
 *
 *  S1 — quit while the remote-status poll burst is running (12 fast local
 *       remotes + 2 repos with a HUNG remote: a local TCP server that
 *       accepts the connection but never answers → git fetch hangs).
 *       Measures: app.close() → process exit, orphaned git processes.
 *
 *  S2 — close the window while the RENDERER main thread is busy
 *       (synthetic 6 s JS long task). Chromium must handshake with the
 *       renderer to run beforeunload handlers (aiChatStore flushes chat
 *       history there). If close stalls ≈ the task duration → confirmed:
 *       a busy renderer holds the window hostage at quit.
 *
 *  S3 — same as S2 after the fix: close must complete within the close
 *       deadline (~<1 s) even with a busy renderer.
 *
 * Usage: xvfb-run -a node scripts/verify-quit-freeze.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

/** Trigger quit, then poll the OS for REAL process death (kill -0). */
async function closeAndMeasure(app, label, timeoutMs = 15000) {
  const pid = app.process().pid;
  const t0 = Date.now();
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const closePromise = app.close().then(() => Date.now() - t0).catch(() => -1);
  let deathMs = null;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (!alive()) { deathMs = Date.now() - t0; break; }
  }
  const closeResolvedMs = await Promise.race([closePromise, new Promise((r) => setTimeout(() => r(null), 200))]);
  if (deathMs === null) {
    console.log(`${label}: process STILL ALIVE after ${timeoutMs} ms ❌❌`);
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    await new Promise((r) => setTimeout(r, 200));
  } else {
    console.log(`${label}: true process death: ${deathMs} ms (playwright close(): ${closeResolvedMs === null ? 'never resolved' : closeResolvedMs + 'ms'})`);
  }
  return deathMs ?? timeoutMs;
}

const FAST_REPOS = 12;
const HUNG_REPOS = 2;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-quit-'));
const repos = [];
function sh(cmd, cwd) { execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

for (let i = 0; i < FAST_REPOS; i++) {
  const remote = path.join(root, `remote-${i}.git`);
  const clone = path.join(root, `clone-${i}`);
  sh(`git init --bare -q "${remote}"`);
  sh(`git clone -q "${remote}" "${clone}"`);
  sh('git config user.email q@test', clone);
  sh('git config user.name Q', clone);
  fs.writeFileSync(path.join(clone, `f-${i}.txt`), `hello ${i}\n`);
  sh('git add .', clone);
  sh('git commit -q -m base', clone);
  sh('git push -q origin HEAD:refs/heads/main', clone);
  repos.push({ path: clone, name: `clone-${i}`, remotes: { [clone]: ['origin'] } });
}

// HUNG remote: TCP server that accepts and never responds.
const hungServer = net.createServer(() => { /* swallow — never reply */ });
await new Promise((res) => hungServer.listen(0, '127.0.0.1', res));
const hungPort = hungServer.address().port;
for (let i = 0; i < HUNG_REPOS; i++) {
  const remote = path.join(root, `hremote-${i}.git`);
  const clone = path.join(root, `hclone-${i}`);
  sh(`git init --bare -q "${remote}"`);
  sh(`git clone -q "${path.join(root, 'remote-0.git')}" "${clone}"`); // content clone
  sh(`git remote set-url origin http://127.0.0.1:${hungPort}/h${i}.git`, clone); // → hang
  repos.push({ path: clone, name: `hclone-${i}`, remotes: { [clone]: ['origin'] } });
}
console.log(`fixture: ${FAST_REPOS} fast + ${HUNG_REPOS} hung-fetch repos (port ${hungPort} never answers)`);

const bgMap = {};
for (const r of repos) Object.assign(bgMap, r.remotes);

function snapshot() {
  const map = new Map();
  const out = execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return map;
}

async function launchApp(userDataDir) {
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: 'light', tourCompleted: true,
      autoRefresh: true,              // ← poll ON (the real default!)
      repoRemoteCheckIntervalSec: 30, // ← fastest allowed
      backgroundFetchRemotes: bgMap,  // fetch ALL repos' remotes in background
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
      PRISMGIT_QUIT_LOG: '1',
    },
    stdout: 'pipe',
    timeout: 30000,
  });
  // Pipe the app's stdout so [quit +Nms] telemetry lands in the harness log.
  app.process().stdout?.on('data', (d) => { process.stdout.write(String(d)); });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  return { app, page };
}

// ── S1: quit while the poll burst (with hung fetches) is running ──────────
console.log('\n── S1: quit during poll burst + hung fetches ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud1-'));
  const { app, page } = await launchApp(ud);
  const appPid = app.process().pid;

  // Wait until at least one hung fetch is alive (git child talking to our dead port).
  let hungAlive = false;
  const hungPids = new Set();
  for (let i = 0; i < 40 && !hungAlive; i++) {
    await page.waitForTimeout(250);
    const snap = snapshot();
    for (const [pid, p] of snap) {
      if (/git( |$)/.test(p.cmd) && (p.cmd.includes(`127.0.0.1:${hungPort}`) || /fetch --prune/.test(p.cmd))) {
        hungAlive = true;
        hungPids.add(pid);
      }
    }
  }
  // Record the fetch pids seen just before quitting (parent = worker).
  const snapPre = snapshot();
  const workerPids = new Set();
  for (const [pid, p] of snapPre) {
    if (p.cmd && p.cmd.includes('--utility-sub-type=node.mojom.NodeService')) workerPids.add(pid);
  }
  const fetchPids = [];
  for (const [pid, p] of snapPre) {
    if (/fetch --prune/.test(p.cmd || '') && (workerPids.has(p.ppid) || hungPids.has(pid))) fetchPids.push(pid);
  }
  console.log(`hung fetch observed: ${hungAlive}; fetch pids pre-quit: [${fetchPids.join(',')}]`);

  const quitMs = await closeAndMeasure(app, 'S1');
  console.log(`S1 quit: true death ${quitMs} ms (budget 3000) ${quitMs > 3000 ? '❌ FREEZE' : '✓'}`);

  // orphans
  const snap = snapshot();
  let orphans = 0;
  for (const [pid, p] of snap) {
    if (/git( |$)/.test(p.cmd) && !p.cmd.includes('gitPollWorker') && p.ppid === 1) {
      orphans++;
      console.log(`  ORPHAN pid=${pid} ppid=1: ${p.cmd.slice(0, 70)}`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
  console.log(`S1 orphans: ${orphans} (must be 0)`);
}

// ── S2: close while the renderer main thread is blocked 6 s ──────────────
console.log('\n── S2: close with busy renderer (6 s long task) ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud2-'));
  const { app, page } = await launchApp(ud);

  // Start a 6 s blocking JS task on the renderer main thread — but return
  // control to the harness immediately (the task keeps running in the page).
  await page.evaluate(() => {
    setTimeout(() => {
      const end = Date.now() + 6000;
      while (Date.now() < end) { /* busy-wait: renderer unresponsive */ }
    }, 0);
    return 'armed';
  });
  await page.waitForTimeout(100); // let the busy-wait start

  const quitMs = await closeAndMeasure(app, 'S2');
  console.log(`S2 quit with busy renderer: true death ${quitMs} ms (budget 1500) ${quitMs > 1500 ? '❌ renderer holds quit hostage' : '✓ bounded'}`);
}

hungServer.close();
// Orphaned hung-fetch git processes keep accepted sockets open, which makes
// hungServer.close() hang forever — the HARNESS must exit regardless.
console.log('\ndone');
process.exit(0);
