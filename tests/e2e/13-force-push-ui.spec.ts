/**
 * E2E: "push --force everywhere" — the force-flag feature chain.
 *
 * Verifies through the REAL app (Electron + IPC + git service):
 *   1. Toolbar Push dropdown: the Force checkbox reveals the force-flag
 *      selector (default --force); a force push to a local bare remote
 *      actually moves the remote branch.
 *   2. Flag semantics end-to-end on a DIVERGED remote:
 *      --force-with-lease is rejected (stale info), real --force overwrites.
 *   3. Command Palette "Push (Force)" runs git push --force on the current
 *      branch.
 *   4. Settings → Appearance (Force Push Policy panel) exposes the global
 *      "Force push flag" selector with --force / --force-with-lease.
 *
 * Uses a PRIVATE repo + bare remote (never touches the shared fixture), on
 * branch `feature/e2e-force` so the default 'feature-only' force-push policy
 * allows force on it.
 */

import { test, expect } from '@playwright/test';
import { launchApp, navigateTo, waitForText, screenshot } from './helpers';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BRANCH = 'feature/e2e-force';
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-forcepush-'));
const REPO = path.join(BASE, 'work');
const BARE = path.join(BASE, 'remote.git');

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
}

function g(args: string): string {
  return sh(`git -c user.name="E2E" -c user.email="e2e@test.com" ${args}`, REPO);
}

function localHash(): string {
  return g('rev-parse HEAD');
}

function remoteHash(): string {
  try {
    return sh(`git --git-dir="${BARE}" rev-parse "refs/heads/${BRANCH}"`, BASE);
  } catch {
    return '';
  }
}

/** Poll until the bare remote's branch equals the local HEAD. */
async function waitRemoteEqualsLocal(timeout = 20000): Promise<void> {
  const target = localHash();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (remoteHash() === target && target) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`remote did not move to ${target.slice(0, 8)} within ${timeout}ms (remote=${remoteHash().slice(0, 8) || '<none>'})`);
}

test.beforeAll(() => {
  fs.mkdirSync(REPO, { recursive: true });
  fs.mkdirSync(BARE, { recursive: true });
  g(`init -q -b ${BRANCH} .`);
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'one\n');
  g('add .');
  g('commit -q -m one');
  sh(`git init -q --bare -b ${BRANCH} .`, BARE);
  g(`remote add origin "${BARE}"`);
});

/** Open the toolbar Push options dropdown; returns the page for chaining. */
async function openPushOptions(page: import('@playwright/test').Page): Promise<void> {
  const chevron = page.locator('button[title^="Push options"]').first();
  await chevron.waitFor({ state: 'visible', timeout: 15000 });
  await chevron.click();
  await page.waitForTimeout(400);
}

/** Check the Force push checkbox inside the dropdown (reveals the flag select). */
async function checkForce(page: import('@playwright/test').Page): Promise<void> {
  const forceLabel = page.locator('label:has-text("Force push")').first();
  await forceLabel.waitFor({ state: 'visible', timeout: 8000 });
  const box = forceLabel.locator('input[type="checkbox"]');
  if (!(await box.isChecked())) {
    await box.check();
    await page.waitForTimeout(250);
  }
}

test.describe('Force push (--force) everywhere', () => {
  test('toolbar: Force checkbox reveals the --force selector and pushes for real', async () => {
    const ctx = await launchApp({ repos: [{ path: REPO, name: 'forcepush-e2e' }] });
    try {
      const page = ctx.page;
      await openPushOptions(page);

      // Force checkbox → the force-flag selector appears, default --force
      await checkForce(page);
      const modeSelect = page.locator('[data-testid="push-force-mode"]');
      await expect(modeSelect).toBeVisible({ timeout: 5000 });
      await expect(modeSelect).toHaveValue('force');
      // Both flags are offered
      const options = modeSelect.locator('option');
      await expect(options).toHaveCount(2);

      await screenshot(page, 'forcepush-toolbar-select');

      // Push → the bare remote receives the branch at the local HEAD
      await page.locator('button:has-text("Push to origin")').first().click();
      await waitRemoteEqualsLocal();
    } finally {
      await ctx.close();
    }
  });

  test('flags end-to-end: lease is rejected on a diverged remote, --force overwrites', async () => {
    // ── Node-side divergence setup ──────────────────────────────────────
    // 1) make sure the branch is published (no-op if already there)
    try { g(`push -q origin ${BRANCH}`); } catch { /* already ahead/diverged — fine */ }
    // 2) teammate clone moves the remote ahead
    const mate = path.join(BASE, 'mate');
    fs.rmSync(mate, { recursive: true, force: true });
    sh(`git clone -q "${BARE}" "${mate}"`, BASE);
    // The bare's HEAD is feature/e2e-force, so the clone already has it
    // checked out — a plain checkout is idempotent (-b would fail with
    // "branch already exists").
    sh(`git -c user.name=Mate -c user.email=mate@test.com checkout -q ${BRANCH}`, mate);
    fs.writeFileSync(path.join(mate, 'mate.txt'), 'teammate\n');
    sh('git add .', mate);
    sh('git -c user.name=Mate -c user.email=mate@test.com commit -q -m teammate', mate);
    sh(`git push -q origin ${BRANCH}`, mate);
    const mateHash = remoteHash();
    // 3) local diverges WITHOUT fetching → stale remote-tracking ref
    fs.writeFileSync(path.join(REPO, 'local.txt'), 'local\n');
    g('add .');
    g('commit -q -m local-rewrite');

    const ctx = await launchApp({ repos: [{ path: REPO, name: 'forcepush-e2e' }] });
    try {
      const page = ctx.page;

      // ── LEASE mode: must be rejected (stale info) ─────────────────────
      await openPushOptions(page);
      await checkForce(page);
      const modeSelect = page.locator('[data-testid="push-force-mode"]');
      await modeSelect.selectOption('lease');
      await page.locator('button:has-text("Push to origin")').first().click();
      await waitForText(page, 'Push failed', 20000);
      // The remote was NOT overwritten
      expect(remoteHash()).toBe(mateHash);

      // ── FORCE mode: overwrites the diverged remote ────────────────────
      await openPushOptions(page);
      await checkForce(page);
      await page.locator('[data-testid="push-force-mode"]').selectOption('force');
      await page.locator('button:has-text("Push to origin")').first().click();
      await waitRemoteEqualsLocal();

      await screenshot(page, 'forcepush-force-overwritten');
    } finally {
      await ctx.close();
    }
  });

  test('command palette: "Push (Force)" runs a real force push', async () => {
    // Local gets ahead (CLI); the palette force push must move the remote.
    fs.writeFileSync(path.join(REPO, 'b.txt'), 'two\n');
    g('add .');
    g('commit -q -m two');
    expect(remoteHash()).not.toBe(localHash());

    const ctx = await launchApp({ repos: [{ path: REPO, name: 'forcepush-e2e' }] });
    try {
      const page = ctx.page;
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(600);
      await page.keyboard.type('Force');
      await page.waitForTimeout(500);
      const cmd = page.locator('text=Push (Force)').first();
      await cmd.waitFor({ state: 'visible', timeout: 8000 });
      await cmd.click();
      await waitRemoteEqualsLocal();
    } finally {
      await ctx.close();
    }
  });

  test('settings: global "Force push flag" selector (--force / --force-with-lease)', async () => {
    const ctx = await launchApp({ repos: [{ path: REPO, name: 'forcepush-e2e' }] });
    try {
      const page = ctx.page;
      await navigateTo(page, 'Settings');
      await page.waitForTimeout(1000);

      // The Force Push Policy panel (Appearance tab is the default) exposes
      // the flag select right below the policy select.
      const flagSelect = page
        .locator('xpath=//label[contains(normalize-space(.), "Force push flag")]/following-sibling::select')
        .first();
      await expect(flagSelect).toBeVisible({ timeout: 8000 });
      await expect(flagSelect).toHaveValue('force');

      // Switching persists the choice
      await flagSelect.selectOption('lease');
      await expect(flagSelect).toHaveValue('lease');
      await flagSelect.selectOption('force');

      await screenshot(page, 'forcepush-settings-flag');
    } finally {
      await ctx.close();
    }
  });
});
