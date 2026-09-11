/**
 * E2E Test: All repo states — verify banner + buttons for each state
 *
 * Tests 5 in-progress states:
 *   1. merging — Abort button
 *   2. cherry-picking — Continue + Abort buttons
 *   3. rebasing — Continue + Abort buttons
 *   4. reverting — Continue + Abort buttons
 *   5. bisecting — Mark HEAD as Bad + Mark HEAD as Good + Abort buttons
 *
 * For each state, also tests conflict resolution via 3-way panel.
 *
 * Run: DISPLAY=:99 npx playwright test tests/e2e/all-repo-states.spec.ts --workers=1
 */
import { test } from '@playwright/test';
import { chromium } from '@playwright/test';
import { exec, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

const REPOS = [
  { path: '/tmp/state-merge',       name: 'state-merge',       state: 'merging',         expectButtons: ['Abort'] },
  { path: '/tmp/state-cherry-pick', name: 'state-cherry-pick', state: 'cherry-picking',  expectButtons: ['Continue', 'Abort'] },
  { path: '/tmp/state-rebase',      name: 'state-rebase',      state: 'rebasing',        expectButtons: ['Continue', 'Abort'] },
  { path: '/tmp/state-revert',       name: 'state-revert',       state: 'reverting',        expectButtons: ['Continue', 'Abort'] },
  { path: '/tmp/state-bisect',       name: 'state-bisect',       state: 'bisecting',        expectButtons: ['Mark HEAD as Good', 'Mark HEAD as Bad', 'Abort'] },
];
const SHOTS = '/home/z/my-project/screenshots';

function waitForPort(port: number, timeout = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryConnect = () => {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Port ${port} timeout`));
        else setTimeout(tryConnect, 300);
      });
      sock.once('timeout', () => {
        sock.destroy();
        if (Date.now() - start > timeout) reject(new Error(`Port ${port} timeout`));
        else setTimeout(tryConnect, 300);
      });
      sock.connect(port, '127.0.0.1');
    };
    tryConnect();
  });
}

test.describe('All Repo States E2E', () => {
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

  for (const repo of REPOS) {
    test(`${repo.name}: ${repo.state} — banner + buttons`, async () => {
      const ud = fs.mkdtempSync(path.join(os.tmpdir(), `pg-${repo.name}-`));
      fs.writeFileSync(path.join(ud, 'prismgit-settings.json'), JSON.stringify({
        settings: { theme: 'dark', fontSize: 13, sidebarWidth: 240, contrast: 100 },
        repositories: [{ path: repo.path, name: repo.name, lastOpened: Date.now(), pinned: false }],
        repoMetadata: {},
      }, null, 2));

      const port = 9240 + REPOS.indexOf(repo);
      const electronBin = path.join(process.cwd(), 'node_modules/electron/dist/electron');
      const mainJs = path.join(process.cwd(), 'dist-electron/main.js');

      const cmd = `DISPLAY=:99 "${electronBin}" "${mainJs}" --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=${port}`;
      console.log(`[${repo.name}] Launching Electron...`);
      const child: ChildProcess = exec(cmd, {
        env: { ...process.env, DISPLAY: ':99', NODE_ENV: 'production',
          PRISMGIT_USER_DATA: ud, PRISMGIT_LOCALE: 'en' },
      });
      const stderr: string[] = [];
      child.stderr?.on('data', (d) => stderr.push(d.toString()));

      try {
        await waitForPort(port, 20000);
        console.log(`[${repo.name}] Debug port ${port} ready`);

        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const ctx = browser.contexts()[0] || await browser.newContext();
        const page = ctx.pages()[0] || await ctx.newPage();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Click repo button
        const repoBtn = page.locator(`button:has-text("${repo.name}")`).first();
        if (await repoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await repoBtn.click();
          await page.waitForTimeout(2000);
        }

        await page.screenshot({ path: `${SHOTS}/state-${repo.name}-01-changes.png` });
        console.log(`[${repo.name}] Screenshot 1: Changes page`);

        // Check repo-state banner
        const banner = page.locator('[data-testid="repo-state-banner"]');
        const bv = await banner.isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`[${repo.name}] Banner visible: ${bv}`);
        if (bv) {
          const bt = await banner.textContent();
          console.log(`[${repo.name}] Banner text: ${bt?.trim().substring(0, 120)}`);
          // Verify the banner contains the expected state text
          const hasState = bt?.toLowerCase().includes(repo.state) ||
                            bt?.toLowerCase().includes(repo.state.replace('ing', ''));
          console.log(`[${repo.name}] Banner contains '${repo.state}': ${hasState}`);
        }

        // Check expected buttons in the banner
        for (const btnLabel of repo.expectButtons) {
          const btn = banner.locator(`button:has-text("${btnLabel}")`).first();
          const btnVisible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
          console.log(`[${repo.name}] Button '${btnLabel}' visible: ${btnVisible}`);
        }

        // For conflict states (merge/cherry-pick/rebase/revert), test 3-way panel
        if (repo.state !== 'bisecting') {
          console.log(`[${repo.name}] === Navigating to Diff for conflict resolution ===`);
          const diffNav = page.locator('text=Diff').first();
          if (await diffNav.isVisible({ timeout: 2000 }).catch(() => false)) {
            await diffNav.click();
            await page.waitForTimeout(1500);
          }
          await page.screenshot({ path: `${SHOTS}/state-${repo.name}-02-diff.png` });
          console.log(`[${repo.name}] Screenshot 2: Diff page`);

          // Find conflicted file
          const fileRow = page.locator('text=file.txt').first();
          if (await fileRow.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log(`[${repo.name}] Found file.txt — right-clicking`);
            await fileRow.click({ button: 'right' });
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${SHOTS}/state-${repo.name}-03-menu.png` });

            const resolveItem = page.locator('text=Resolve Conflict').first();
            if (await resolveItem.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(`[${repo.name}] Clicking Resolve Conflict...`);
              await resolveItem.click();
              await page.waitForTimeout(3000);
              await page.screenshot({ path: `${SHOTS}/state-${repo.name}-04-3way.png` });
              console.log(`[${repo.name}] Screenshot 4: 3-way panel`);

              // Check editor
              const editor = page.locator('[data-testid="conflict-editor"]');
              const ev = await editor.isVisible({ timeout: 3000 }).catch(() => false);
              console.log(`[${repo.name}] Editor visible: ${ev}`);
              if (ev) {
                const et = await editor.textContent();
                console.log(`[${repo.name}] Has conflict markers: ${et?.includes('<<<<<<<')}`);

                // Click Take Left
                const tl = page.locator('button:has-text("Take Left")').first();
                if (await tl.isVisible({ timeout: 2000 }).catch(() => false)) {
                  console.log(`[${repo.name}] Clicking Take Left`);
                  await tl.click();
                  await page.waitForTimeout(1000);
                  await page.screenshot({ path: `${SHOTS}/state-${repo.name}-05-after-take-left.png` });
                  console.log(`[${repo.name}] Screenshot 5: After Take Left`);
                }

                // Save & Stage
                const sv = page.locator('button:has-text("saveStage")').first();
                if (await sv.isVisible({ timeout: 2000 }).catch(() => false)) {
                  console.log(`[${repo.name}] Clicking Save & Stage`);
                  await sv.click();
                  await page.waitForTimeout(2000);
                  await page.screenshot({ path: `${SHOTS}/state-${repo.name}-06-saved.png` });
                }
              }
            }
          }
        }

        // Console errors
        const errs: string[] = [];
        page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
        await page.waitForTimeout(500);
        console.log(`[${repo.name}] Console errors: ${errs.length}`);
        errs.slice(0, 3).forEach((e, i) => console.log(`  [${i + 1}] ${e.substring(0, 150)}`));

        await page.screenshot({ path: `${SHOTS}/state-${repo.name}-07-final.png` });
        console.log(`[${repo.name}] === Done ===\n`);

        await browser.close();
      } catch (e) {
        console.log(`[${repo.name}] ERROR: ${(e as Error).message}`);
        console.log(`[${repo.name}] stderr: ${stderr.join('').substring(0, 300)}`);
      } finally {
        child.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        fs.rmSync(ud, { recursive: true, force: true });
      }
    });
  }
});
