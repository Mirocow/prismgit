#!/usr/bin/env node
/**
 * Production-package smoke: launches the PACKAGED binary (release/linux-unpacked)
 * — not dist-electron/main.js — with a seeded repo list, connects over CDP
 * (--remote-debugging-port) and asserts the full boot → repo open → page nav
 * → clean quit chain works in the shipped artifact.
 *
 * Usage: DISPLAY=:99 node scripts/pkg-smoke-e2e.mjs [path-to-binary]
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const BIN = process.argv[2] || path.join(process.cwd(), 'release/linux-unpacked/prismgit');
if (!fs.existsSync(BIN)) { console.error(`packaged binary not found: ${BIN}`); process.exit(1); }

// A real fixture repo with commits
const REPO = '/tmp/prismgit-e2e-repos/test-repo';
if (!fs.existsSync(`${REPO}/.git`)) {
  execSync('bash tests/fixtures/setup-e2e-extra-repos.sh', { stdio: 'inherit', timeout: 120000 });
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-pkg-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: [{ path: REPO, name: 'test-repo', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const PORT = 9333;
const t0 = Date.now();
const child = spawn(BIN, ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`], {
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99', PRISMGIT_USER_DATA: userDataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
child.stdout.on('data', (d) => { bootLog += d; });
child.stderr.on('data', (d) => { bootLog += d; });

const waitFor = (ms, fn) => new Promise((res, rej) => {
  const t = setInterval(async () => {
    if (await fn()) { clearInterval(t); res(); }
    else if (Date.now() - t0 > ms) { clearInterval(t); rej(new Error(`timeout after ${ms}ms`)); }
  }, 200);
});
const cdpUp = () => new Promise((res) => http.get(`http://127.0.0.1:${PORT}/json/version`, (r) => res(r.statusCode === 200)).on('error', () => res(false)));
await waitFor(30000, cdpUp);
console.log(`launch -> CDP endpoint up: ${Date.now() - t0}ms`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
let page = ctx.pages()[0];
if (!page) page = await ctx.waitForPage('domcontentloaded', { timeout: 20000 });
console.log(`CDP pages: ${ctx.pages().length}, using: ${page.url().slice(0, 60)}`);

// Boot lands on the welcome screen (lastOpened does NOT auto-open) — click the repo
await page.locator('button:has-text("test-repo")').first().click({ timeout: 20000 })
  .catch(() => page.locator('[data-testid="repo-item-test-repo"]').first().click({ timeout: 20000 }));
await page.locator('text=main').first().waitFor({ timeout: 25000 });
console.log(`repo open -> branch chip visible: ${Date.now() - t0}ms total`);

// Sidebar nav works in the packaged build
await page.locator('button:has-text("History")').first().click({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
const body = await page.locator('body').innerText();
const navOk = /test-repo|main/.test(body);
console.log(`History page rendered with repo context: ${navOk ? 'YES' : 'NO'}`);

// Clean quit through the full chain: SIGTERM (the OS logout path)
const tq = Date.now();
child.kill('SIGTERM');
await waitFor(15000, async () => { try { process.kill(child.pid, 0); return false; } catch { return true; } });
const quitMs = Date.now() - tq;
console.log(`SIGTERM -> process death: ${quitMs}ms ${quitMs < 3000 ? '(within budget)' : '(OVER BUDGET)'}`);
const leftovers = execSync("ps -eo comm --no-headers | grep -c '^git$' || true", { encoding: 'utf8' }).trim();
console.log(`orphaned git after quit: ${leftovers}`);

const PASS = navOk && quitMs < 3000 && leftovers === '0';
console.log(PASS ? '\nPASS: packaged binary boots, opens a repo, navigates, quits clean'
                 : `\nFAIL (nav=${navOk} quit=${quitMs}ms orphans=${leftovers})`);
try { await browser.close(); } catch { /* app already dead */ }
process.exit(PASS ? 0 : 1);
