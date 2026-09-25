#!/usr/bin/env node
/**
 * Verify: «проблема с закрытием приложения при открытии репозитория осталась»
 * — the app hangs when closing WHILE A REPOSITORY IS OPEN in the UI.
 *
 * This is the scenario the older verify-quit-freeze.mjs harness NEVER tested:
 * it registered repos + ran the poll burst, but never OPENED one (no repo
 * page, no watcher:start, no worker-side chokidar watch, no ChangesPage
 * loaders). v3.6 moved the workdir watch into the git worker — the quit path
 * after that commit was never re-verified with a repo actually open.
 *
 * Scenarios:
 *  R1 — open a repo, let the open fan-out + watcher settle (4 s), then quit.
 *  R2 — open a repo and quit IMMEDIATELY (mid repo-open burst, watcher still
 *       warming up in the worker).
 *  R3 — repo open, plus the renderer stays busy (repo page re-render storm is
 *       not needed; we just quit via window close exactly like the user).
 *
 * Measures TRUE process death (kill -0 polling — Playwright's app.close()
 * promise lies about utilityProcess teardown) and prints the PRISMGIT_QUIT_LOG
 * phase timeline so a hang is attributable to a phase, not a guess.
 *
 * Usage: xvfb-run -a node scripts/verify-quit-repo-open.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-repoopen-'));

/** One repo with enough files to make the worker chokidar scan non-trivial. */
function makeRepo(name, fileCount) {
  const dir = path.join(ROOT, name);
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  const sh = (cmd) => execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  sh('git init -q -b main .');
  sh('git config user.email q@test');
  sh('git config user.name Q');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(dir, 'src', `f${i}.ts`), `export const a${i} = ${i};\n`.repeat(20));
  }
  sh('git add .');
  sh('git commit -q -m base');
  return dir;
}

const REPO = { dir: makeRepo('repo-a', 3000), name: 'repo-a', branch: 'main' };
console.log(`fixture repo: ${REPO.dir} (3000 files)`);

const quitLogs = [];

async function launchApp(userDataDir) {
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: 'light', tourCompleted: true,
      autoRefresh: true,
      repoRemoteCheckIntervalSec: 30,
    },
    repositories: [{ path: REPO.dir, name: REPO.name, lastOpened: Date.now(), pinned: false }],
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
    timeout: 30000,
  });
  const stdout = app.process().stdout;
  if (stdout) stdout.on('data', (d) => {
    const s = String(d);
    process.stdout.write(s);
    quitLogs.push(s);
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  return { app, page };
}

/** Click the repo in the sidebar → repo page opens (watcher starts). */
async function openRepo(page) {
  await page.locator(`[data-testid="repo-item-${REPO.name}"]`).first().click({ timeout: 10000 });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const shown = await page.evaluate((b) => {
      const foot = document.querySelector('footer');
      return !!foot && foot.textContent.includes(b);
    }, REPO.branch).catch(() => false);
    if (shown) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

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

function lastQuitTimeline() {
  const lines = quitLogs.join('').split('\n').filter((l) => l.includes('[quit'));
  return lines.slice(-14);
}

// ── R1: repo open + settled → quit ─────────────────────────────────────────
console.log('\n── R1: repo OPEN (settled) → quit ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-r1-'));
  const { app, page } = await launchApp(ud);
  const ok = await openRepo(page);
  console.log(`repo page open: ${ok ? 'yes (branch chip shown)' : 'NO — fix the harness'}`);
  await page.waitForTimeout(4000); // open fan-out + worker watcher warm-up settle
  quitLogs.length = 0;
  const ms = await closeAndMeasure(app, 'R1');
  console.log(`R1 quit with repo open: ${ms} ms (budget 2000) ${ms > 2000 ? '❌ FREEZE' : '✓'}`);
  for (const l of lastQuitTimeline()) console.log(`   ${l.trim()}`);
}

// ── R2: repo open, quit IMMEDIATELY (mid open burst) ───────────────────────
console.log('\n── R2: repo open, quit MID-BURST (300 ms after click) ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-r2-'));
  const { app, page } = await launchApp(ud);
  await openRepo(page);
  await page.waitForTimeout(300); // right in the middle of the git burst
  quitLogs.length = 0;
  const ms = await closeAndMeasure(app, 'R2');
  console.log(`R2 quit mid-burst: ${ms} ms (budget 2000) ${ms > 2000 ? '❌ FREEZE' : '✓'}`);
  for (const l of lastQuitTimeline()) console.log(`   ${l.trim()}`);
}

// ── R3: repo open + second window session (switched repos first) ───────────
console.log('\n── R3: repo open after REPO SWITCH → quit ──');
{
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ud-r3-'));
  const { app, page } = await launchApp(ud);
  await openRepo(page);
  await page.waitForTimeout(1500);
  // switch away and back — exercise stop/start watcher churn
  await page.locator('[data-testid="repo-nav-back"], [data-testid="sidebar-repos"], button:has-text("Репозитории")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.locator(`[data-testid="repo-item-${REPO.name}"]`).first().click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  quitLogs.length = 0;
  const ms = await closeAndMeasure(app, 'R3');
  console.log(`R3 quit after switch: ${ms} ms (budget 2000) ${ms > 2000 ? '❌ FREEZE' : '✓'}`);
  for (const l of lastQuitTimeline()) console.log(`   ${l.trim()}`);
}

console.log('\ndone');
process.exit(0);
