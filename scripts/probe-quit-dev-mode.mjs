#!/usr/bin/env node
/**
 * Quit probe in DEV MODE — the user always runs `make dev`.
 * Faithful reproduction: vite dev server on :5173 (renderer dev build + HMR
 * client) + Electron main with VITE_DEV_SERVER_URL set (main.ts isDev path).
 *
 * Usage: DISPLAY=:99 node scripts/probe-quit-dev-mode.mjs
 * (starts its own vite server on :5173, kills it at the end)
 */
import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-quitdev-'));
const FILES = Number(process.env.PROBE_FILES ?? 3000);

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
  for (let i = 0; i <= FILES; i++) fs.writeFileSync(path.join(clone, 'src', `f${i}.ts`), `export const a${i} = ${i};\n`);
  sh('git add .', clone);
  sh('git commit -q -m base', clone);
  sh('git push -q origin HEAD:refs/heads/master', clone);
}
sh(`git remote set-url origin http://127.0.0.1:${hungPort}/x.git`, clone);
console.log(`fixture: ${clone} (${FILES} files, hung remote :${hungPort})`);

// ── vite dev server (renderer only — no electron auto-spawn) ───────────────
const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
  cwd: process.cwd(),
  env: { ...process.env, PRISMGIT_E2E_WEBSERVER: '1', DISPLAY: process.env.DISPLAY || ':99' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let viteReady = false;
vite.stdout.on('data', (d) => { const s = String(d); if (s.includes('5173')) { viteReady = true; console.log(`[vite] ${s.trim().split('\n').pop()}`); } });
vite.stderr.on('data', (d) => { const s = String(d).trim(); if (s) console.log(`[vite-err] ${s.slice(0, 140)}`); });
for (let i = 0; i < 60 && !viteReady; i++) await new Promise((r) => setTimeout(r, 500));
if (!viteReady) { console.log('vite did not announce readiness — trying anyway'); }
// Belt: poll the port.
{
  const portUp = () => new Promise((res) => {
    const s = net.connect(5173, '127.0.0.1');
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
  });
  for (let i = 0; i < 40; i++) { if (await portUp()) break; await new Promise((r) => setTimeout(r, 500)); }
}
console.log('vite dev server up on :5173');

const quitLogs = [];

async function launchApp(userDataDir) {
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: 'light', tourCompleted: true, autoRefresh: true,
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
      ...process.env,
      NODE_ENV: 'development',
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
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
  await page.waitForTimeout(4000);
  return { app, page };
}

async function openRepo(page) {
  await page.locator('[data-testid="repo-item-clone"]').first().click({ timeout: 15000 });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const shown = await page.evaluate(() => {
      const foot = document.querySelector('footer');
      return !!foot && /master|main/.test(foot.textContent || '');
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

console.log('\n── D1: DEV mode, repo open (settled) → quit ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-d1-'));
  const { app, page } = await launchApp(ud);
  const ok = await openRepo(page);
  console.log(`repo page open: ${ok}`);
  await page.waitForTimeout(4000);
  // Renderer busy-loop probe: is the page responsive pre-quit?
  const tProbe = Date.now();
  await page.evaluate(() => 1).catch(() => {});
  console.log(`renderer responsive pre-quit (eval): ${Date.now() - tProbe}ms`);
  quitLogs.length = 0;
  const ms = await closeAndMeasure(app, 'D1');
  console.log(`D1 DEV-mode quit with repo open: ${ms} ms (budget 2500) ${ms > 2500 ? '❌ FREEZE' : '✓'}`);
  for (const l of quitLogs.join('').split('\n').filter((l) => l.includes('[quit')).slice(-16)) console.log(`   ${l.trim()}`);
}
// (tProbe defined late to avoid TDZ noise — trivial helper used above)

try { process.kill(-vite.pid, 'SIGKILL'); } catch { try { vite.kill('SIGKILL'); } catch { /* gone */ } }
hungServer.close();
console.log('\ndone');
process.exit(0);
