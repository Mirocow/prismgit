#!/usr/bin/env node
/**
 * Repro: "Repository Settings зависло приложение при открытии, возможно
 * связано с fetch статусом".
 *
 * Launches the BUILT app against a fixture with a real bare remote and
 * background-fetch enabled (the remote-status poll), then opens the
 * Repository Settings dialog repeatedly and measures:
 *   - busyMs      : dispatch → busy spinner gone (30 s budget ⇒ FREEZE)
 *   - mainPingMs  : a configGet round-trip THROUGH the main process
 *                   (renderer → IPC → git queue → spawn) while the dialog
 *                   is loading — the "is main alive" probe
 *   - renderer longtasks during the open
 *
 * Modes:
 *   PRISMGIT_REPRO_REPOS=6  — six repos in the sidebar (multi-repo poll)
 *   PRISMGIT_REPRO_DEAD=1   — add an unreachable remote to every repo
 *                             (VPN-down style: fetch hangs until the 60 s kill)
 *
 * Usage: xvfb-run -a node scripts/repro-repo-settings-freeze.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_COUNT = Math.max(1, parseInt(process.env.PRISMGIT_REPRO_REPOS || '1', 10));
const DEAD = process.env.PRISMGIT_REPRO_DEAD === '1';
const OPEN_ROUNDS = parseInt(process.env.PRISMGIT_REPRO_ROUNDS || '3', 10);
const DEV = process.env.PRISMGIT_REPRO_DEV === '1';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-repro-rs-'));
const repos = [];

function sh(cmd, cwd) { execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

for (let i = 0; i < REPO_COUNT; i++) {
  const remote = path.join(root, `remote-${i}.git`);
  const clone = path.join(root, `clone-${i}`);
  sh(`git init --bare -q "${remote}"`);
  sh(`git clone -q "${remote}" "${clone}"`);
  sh('git config user.email repro@test', clone);
  sh('git config user.name Repro', clone);
  fs.writeFileSync(path.join(clone, 'hello.txt'), 'hello\n');
  sh('git add .', clone);
  sh('git commit -q -m base', clone);
  sh('git push -q origin HEAD:refs/heads/main', clone);
  fs.writeFileSync(path.join(clone, 'local.txt'), 'local\n');
  sh('git add .', clone);
  sh('git commit -q -m local-only', clone); // outgoing=1
  if (DEAD) {
    sh(`git remote add dead-${i} https://10.255.255.1/dead/repo-${i}.git`, clone);
  }
  repos.push({ path: clone, name: `clone-${i}` });
}

console.log(`fixture: ${REPO_COUNT} repo(s), dead-remotes=${DEAD}`);

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-repro-ud-'));
const bgMap = {};
for (const r of repos) bgMap[r.path] = ['origin'];
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: true,
    maxHistoryLoad: 2000, repoRemoteCheckIntervalSec: 120,
    backgroundFetchRemotes: bgMap,
  },
  repositories: repos.map((r, i) => ({ path: r.path, name: r.name, lastOpened: i === 0 ? Date.now() : Date.now() - i, pinned: false })),
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: DEV ? 'development' : 'production',
    ...(DEV ? { VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173' } : {}),
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'en',
  },
  timeout: 30000,
});
let page = await app.firstWindow();
// dev: a detached DevTools window may be first — pick the real app window
await page.waitForTimeout(300).catch(() => {});
{
  const wins = app.windows();
  const appWin = wins.find((w) => !w.url().startsWith('devtools://'));
  if (appWin && appWin !== page) page = appWin;
}
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1500);

// open the first repo
const btn = page.locator(`button:has-text("${repos[0].name}")`).first();
if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
  await btn.click();
  await page.locator('#commit-message-input').waitFor({ state: 'visible', timeout: 30000 });
  console.log('repo opened');
} else {
  console.log('WARN: repo button not visible — dialog requires an open repo');
}
await page.waitForTimeout(6000); // let the initial remote-status poll (fetch) get going

const REPO = repos[0].path;
async function mainPing(label) {
  return page.evaluate(async ({ repo, label }) => {
    const t = performance.now();
    const res = await Promise.race([
      window.smartgit.git.configGet(repo, 'user.name').then(() => 'ok', (e) => 'err:' + String(e).slice(0, 60)),
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 15000)),
    ]);
    return { label, res, ms: Math.round(performance.now() - t) };
  }, { repo: REPO, label });
}

console.log('main ping BEFORE:', JSON.stringify(await mainPing('before')));

// instrument longtasks
await page.evaluate(() => {
  window.__lt = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) }); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* noop */ }
});

const report = [];
for (let round = 1; round <= OPEN_ROUNDS; round++) {
  await page.evaluate(() => { window.__lt = []; });
  const t0 = Date.now();
  await page.evaluate(() => window.dispatchEvent(new Event('prismgit:repo-settings')));

  const dialog = page.locator('.fixed.inset-0.z-50').last();
  const spinner = page.locator('.fixed.inset-0.z-50 .animate-spin').first();
  const appeared = await spinner.isVisible({ timeout: 5000 }).catch(() => false);

  // poll the main-process liveliness WHILE the dialog loads
  const pings = [];
  const pingLoop = (async () => {
    for (let k = 0; k < 20; k++) {
      pings.push(await mainPing('during'));
      if (Date.now() - t0 > 30000) break;
      await page.waitForTimeout(250).catch(() => {});
    }
  })();

  const gone = await spinner.waitFor({ state: 'hidden', timeout: 30000 }).then(() => true).catch(() => false);
  const busyMs = Date.now() - t0;
  await pingLoop.catch(() => {});

  // Verify the batch ACTUALLY delivered values (not a silently-failed load):
  // the fixture repo has user.name=Repro — the User tab input must show it.
  const userName = await page
    .locator('.fixed.inset-0.z-50 input[placeholder="Your Name"]')
    .inputValue()
    .catch(() => '<not-found>');

  const lts = await page.evaluate(() => window.__lt || []);
  const diag = await dialog.isVisible().catch(() => false);
  report.push({
    round, spinnerAppeared: appeared, busyGone: gone, busyMs, userName,
    dialogVisibleAfter: diag,
    longtasks: { n: lts.length, totalMs: lts.reduce((a, b) => a + b.dur, 0), maxMs: lts.length ? Math.max(...lts.map((l) => l.dur)) : 0 },
    pingsDuring: pings.map((p) => `${p.res}:${p.ms}ms`),
  });
  console.log(`round ${round}: spinner=${appeared} gone=${gone} busyMs=${busyMs} userName=${userName} longtasks=${lts.length}/${lts.reduce((a, b) => a + b.dur, 0)}ms pings=${pings.map((p) => `${p.res}:${p.ms}`).join(' ')}`);

  // close via Cancel button (en locale)
  if (diag) {
    await page.locator('.fixed.inset-0.z-50 button:has-text("Cancel")').last().click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

console.log('\n================ REPRO REPORT ================');
console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(process.cwd(), 'scripts', 'repro-repo-settings-results.json'), JSON.stringify({ meta: { REPO_COUNT, DEAD, OPEN_ROUNDS }, report }, null, 2));

try { await app.close(); } catch { /* ignore */ }
process.exit(0);
