#!/usr/bin/env node
/**
 * Probe: WHY does close hang for the user with a repo open, when the in-house
 * harness passes? Extends verify-quit-repo-open.mjs with the user's missing
 * conditions:
 *   - repo open IN THE UI (watcher + ChangesPage live)
 *   - HUNG remote fetch in flight (real network remote that never answers)
 *   - BIG repo (24k files — ENOSPC scale, like the user's)
 *   - autoRefresh poll burst active
 *
 * Usage: DISPLAY=:99 node scripts/probe-quit-repo-hung.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-quitrh-'));
const FILES = Number(process.env.PROBE_FILES ?? 24000);

function sh(cmd, cwd) { execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

// Hung remote: accepts, never answers.
const hungServer = net.createServer(() => { /* swallow */ });
await new Promise((res) => hungServer.listen(0, '127.0.0.1', res));
const hungPort = hungServer.address().port;

// remote bare + clone with N files + remote pointed at the hung port.
const remote = path.join(ROOT, 'remote.git');
const clone = path.join(ROOT, 'clone');
sh(`git init --bare -q "${remote}"`);
sh(`git clone -q "${remote}" "${clone}"`);
sh('git config user.email q@test', clone);
sh('git config user.name Q', clone);
fs.mkdirSync(path.join(clone, 'src'), { recursive: true });
// 24k tiny files — node writeFileSync in a loop is ~seconds.
{
  const srcDir = path.join(clone, 'src');
  for (let i = 0; i <= FILES; i++) {
    fs.writeFileSync(path.join(srcDir, `f${i}.ts`), `export const a${i} = ${i};\n`);
  }
}
sh('git add .', clone);
sh('git commit -q -m base', clone);
sh('git push -q origin HEAD:refs/heads/main', clone);
sh(`git remote set-url origin http://127.0.0.1:${hungPort}/x.git`, clone);
console.log(`fixture: ${clone} (${FILES} files, hung remote :${hungPort})`);

const quitLogs = [];

async function launchApp(userDataDir) {
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: 'light', tourCompleted: true,
      autoRefresh: true,
      repoRemoteCheckIntervalSec: 30,
      backgroundFetchRemotes: { [clone]: ['origin'] },
    },
    repositories: [{ path: clone, name: 'clone', lastOpened: Date.now(), pinned: false }],
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
      PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru',
      PRISMGIT_QUIT_LOG: '1',
    },
    stdout: 'pipe',
    timeout: 60000,
  });
  app.process().stdout?.on('data', (d) => { process.stdout.write(String(d)); quitLogs.push(String(d)); });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  return { app, page };
}

async function openRepo(page) {
  await page.locator('[data-testid="repo-item-clone"]').first().click({ timeout: 15000 });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const shown = await page.evaluate(() => {
      const foot = document.querySelector('footer');
      return !!foot && foot.textContent.includes('main');
    }).catch(() => false);
    if (shown) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

async function closeAndMeasure(app, label, timeoutMs = 20000) {
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
  } else {
    console.log(`${label}: true process death: ${deathMs} ms (playwright close(): ${closeResolvedMs === null ? 'never resolved' : closeResolvedMs + 'ms'})`);
  }
  return deathMs ?? timeoutMs;
}

function snapshot() {
  const map = new Map();
  const out = execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf8' });
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return map;
}

console.log('\n── H1: repo open (24k files) + hung fetch in flight → quit ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-h1-'));
  const { app, page } = await launchApp(ud);
  const ok = await openRepo(page);
  console.log(`repo page open: ${ok}`);
  // wait for the open burst to settle AND a fetch to be in flight
  await page.waitForTimeout(5000);
  const snap = snapshot();
  const fetches = [...snap.values()].filter((p) => /fetch|remote-http|curl/.test(p.cmd || ''));
  console.log(`in-flight fetch-ish processes pre-quit: ${fetches.length}`);
  quitLogs.length = 0;
  const ms = await closeAndMeasure(app, 'H1');
  console.log(`H1 quit: ${ms} ms (budget 2000) ${ms > 2000 ? '❌ FREEZE' : '✓'}`);
  for (const l of quitLogs.join('').split('\n').filter((l) => l.includes('[quit')).slice(-16)) console.log(`   ${l.trim()}`);
  // orphans after death
  const snap2 = snapshot();
  let orphans = 0;
  for (const [pid, p] of snap2) {
    if (/git( |$)/.test(p.cmd || '') && !p.cmd.includes('gitPollWorker') && p.ppid === 1) {
      orphans++;
      console.log(`  ORPHAN pid=${pid}: ${(p.cmd || '').slice(0, 80)}`);
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
  console.log(`H1 orphans: ${orphans}`);
}

console.log('\n── H2: quit DURING the repo-open burst + immediate fetch ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-h2-'));
  const { app, page } = await launchApp(ud);
  await openRepo(page);
  await page.waitForTimeout(400); // mid-burst
  quitLogs.length = 0;
  const ms = await closeAndMeasure(app, 'H2');
  console.log(`H2 quit mid-burst: ${ms} ms (budget 2000) ${ms > 2000 ? '❌ FREEZE' : '✓'}`);
  for (const l of quitLogs.join('').split('\n').filter((l) => l.includes('[quit')).slice(-16)) console.log(`   ${l.trim()}`);
}

hungServer.close();
console.log('\ndone');
process.exit(0);
