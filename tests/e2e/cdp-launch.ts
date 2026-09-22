/**
 * CDP launcher — shared by ui-ux-full.spec.ts, all-repo-states.spec.ts and
 * conflict-resolution.spec.ts.
 *
 * E2E FIX (root causes #4 + #6): the old specs launched Electron via
 * exec("<shell command>") which broke two ways:
 *   a) DISPLAY was hardcoded to :99 while `xvfb-run -a` picks a FREE
 *      display — Electron died instantly, the debug port never opened;
 *   b) exec() wraps the command in a SHELL, so child.kill() killed the
 *      shell and left orphan Electron processes eating RAM until later
 *      launches OOMed.
 *
 * This module spawns the Electron BINARY directly (no shell), inherits
 * DISPLAY from the environment, kills the whole process tree on cleanup
 * (SIGKILL after a SIGTERM grace period) and waits for real exit.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';
import { chromium, type Browser, type Page } from '@playwright/test';

export const FIXTURE_BASE =
  process.env.PRISMGIT_TEST_REPOS || path.join(os.tmpdir(), 'prismgit-repos');
export const SHOTS = path.join(process.cwd(), 'tests', 'e2e', 'screenshots');

export function shotDir(): string {
  fs.mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

/** Unique CDP port per launch (deterministic per test to avoid collisions). */
let portCounter = 9400;
function nextPort(): number {
  return portCounter++;
}

export function waitForPort(port: number, timeout = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeout) reject(new Error(`CDP port ${port} never opened (Electron failed to start?)`));
        else setTimeout(tryConnect, 300);
      });
      sock.once('timeout', () => {
        sock.destroy();
        if (Date.now() - start > timeout) reject(new Error(`CDP port ${port} never opened (Electron failed to start?)`));
        else setTimeout(tryConnect, 300);
      });
      sock.connect(port, '127.0.0.1');
    };
    tryConnect();
  });
}

export interface CdpApp {
  page: Page;
  browser: Browser;
  child: ChildProcess;
  userDataDir: string;
  stderr: string;
  close: () => Promise<void>;
}

/**
 * Launch the built Electron app against a pre-seeded repo and connect over
 * CDP. `repo` must be { path, name } of an EXISTING fixture repo (created by
 * tests/fixtures/setup-e2e-extra-repos.sh via global-setup).
 */
export async function launchCdpApp(repo: { path: string; name: string }): Promise<CdpApp> {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), `pg-cdp-${repo.name}-`));
  // Same settings shape as helpers.seedUserData — INCLUDING tourCompleted so
  // the first-run tour overlay can never intercept clicks.
  fs.writeFileSync(path.join(ud, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: 'dark', fontSize: 13, sidebarWidth: 240, contrast: 100,
      maxHistoryLoad: 500, tourCompleted: true,
    },
    repositories: [{ path: repo.path, name: repo.name, lastOpened: Date.now(), pinned: false }],
    repoMetadata: {},
  }, null, 2));
  fs.writeFileSync(path.join(ud, 'prismgit-window-state.json'), JSON.stringify({
    windowState: { bounds: { x: 0, y: 0, width: 1600, height: 1000 }, isMaximized: false, isFullScreen: false },
  }, null, 2));

  const electronBin = path.join(process.cwd(), 'node_modules/electron/dist/electron');
  const mainJs = path.join(process.cwd(), 'dist-electron/main.js');
  if (!fs.existsSync(mainJs)) {
    throw new Error(`dist-electron/main.js missing at ${mainJs} — run the build before e2e`);
  }
  const port = nextPort();
  // Direct binary spawn — NO shell wrapper, so kill() hits Electron itself.
  const child = spawn(electronBin, [
    mainJs,
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
  ], {
    env: {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':99', // inherit the ACTUAL Xvfb display
      NODE_ENV: 'production',
      PRISMGIT_USER_DATA: ud,
      PRISMGIT_LOCALE: 'en',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderrChunks: string[] = [];
  child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d.toString()));

  // Wait for the CDP endpoint to actually open (Electron boot takes a
  // moment) BEFORE connecting — connecting early gets ECONNREFUSED.
  await waitForPort(port, 20000).catch((e) => {
    killTree(child);
    throw new Error(`CDP port never opened for ${repo.name}: ${e.message}\nstderr: ${stderrChunks.join('').slice(0, 800)}`);
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch((e) => {
    killTree(child);
    throw new Error(`CDP connect failed for ${repo.name}: ${e.message}\nstderr: ${stderrChunks.join('').slice(0, 500)}`);
  });
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  // Open the repo from the welcome screen (recent list button).
  const btn = page.locator(`button:has-text("${repo.name}")`).first();
  if (await btn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2000);
  }

  const close = async () => {
    try { await browser.close(); } catch { /* already gone */ }
    await killTreeAndWait(child);
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { page, browser, child, userDataDir: ud, stderr: stderrChunks.join(''), close };
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
}

async function killTreeAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  killTree(child);
  const exited = await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => resolve(), 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(() => resolve(), 1500);
    });
  }
}

/**
 * Navigate via the sidebar — aria-label first (regular nav items and
 * favorites carry aria-label={item.label}), expanding collapsed groups
 * (Working Tree / Workflows / Refs start collapsed), then div[role=button]
 * text fallback. Mirrors helpers.navigateTo but tolerant of the CDP page.
 */
export async function cdpNavigateTo(page: Page, label: string): Promise<void> {
  const byAria = page.locator(`aside [role="button"][aria-label="${label}"]`).first();
  if (await byAria.isVisible({ timeout: 2000 }).catch(() => false)) {
    await byAria.click();
    await page.waitForTimeout(900);
    return;
  }
  const expandable = page.locator('aside button[role="heading"][title="Expand"]');
  const n = await expandable.count();
  for (let i = 0; i < n; i++) {
    const header = expandable.nth(i);
    if (await header.isVisible().catch(() => false)) await header.click().catch(() => {});
  }
  if (n > 0) await page.waitForTimeout(300);
  if (await byAria.isVisible({ timeout: 3000 }).catch(() => false)) {
    await byAria.click();
    await page.waitForTimeout(900);
    return;
  }
  const byText = page.locator('aside div[role="button"]').filter({ hasText: label }).first();
  await byText.waitFor({ state: 'visible', timeout: 10000 });
  await byText.click();
  await page.waitForTimeout(900);
}
