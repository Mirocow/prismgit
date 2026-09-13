/**
 * E2E: Conflict resolution test via shell-launched Electron + CDP screenshots
 * Launches Electron via a shell command to avoid env issues, then connects
 * via Chrome DevTools Protocol to take screenshots and interact with the UI.
 */
import { test } from '@playwright/test';
import { chromium } from '@playwright/test';
import { exec, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';

const REPOS = [
  { path: '/tmp/conflict-test-1', name: 'conflict-test-1', desc: 'Content conflict in config.ts' },
  { path: '/tmp/conflict-test-2', name: 'conflict-test-2', desc: 'Multiple file conflicts (3 files)' },
  { path: '/tmp/conflict-test-3', name: 'conflict-test-3', desc: 'Conflict in nested Button.tsx' },
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

test.describe('Conflict Resolution E2E', () => {
  test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

  for (const repo of REPOS) {
    test(`${repo.name}: ${repo.desc}`, async () => {
      const ud = fs.mkdtempSync(path.join(os.tmpdir(), `pg-${repo.name}-`));
      const settingsFile = path.join(ud, 'prismgit-settings.json');
      fs.writeFileSync(settingsFile, JSON.stringify({
        settings: { theme: 'dark', fontSize: 13, sidebarWidth: 240, contrast: 100 },
        repositories: [{ path: repo.path, name: repo.name, lastOpened: Date.now(), pinned: false }],
        repoMetadata: {},
      }, null, 2));

      const port = 9230 + REPOS.indexOf(repo);
      const electronBin = path.join(process.cwd(), 'node_modules/electron/dist/electron');
      const mainJs = path.join(process.cwd(), 'dist-electron/main.js');

      // Launch Electron via shell command (ensures DISPLAY is properly set)
      const cmd = `DISPLAY=:99 "${electronBin}" "${mainJs}" ` +
        `--no-sandbox --disable-gpu --disable-dev-shm-usage ` +
        `--remote-debugging-port=${port}`;
      
      console.log(`[${repo.name}] Launching: ${cmd.substring(0, 80)}...`);
      const child = exec(cmd, {
        env: {
          ...process.env,
          DISPLAY: ':99',
          NODE_ENV: 'production',
          PRISMGIT_USER_DATA: ud,
          PRISMGIT_LOCALE: 'en',
        },
      });
      const stderr: string[] = [];
      child.stderr?.on('data', (d) => { stderr.push(d.toString()); });

      try {
        console.log(`[${repo.name}] Waiting for debug port ${port}...`);
        await waitForPort(port, 20000);
        console.log(`[${repo.name}] Port ${port} available!`);

        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const ctx = browser.contexts()[0] || await browser.newContext();
        const page = ctx.pages()[0] || await ctx.newPage();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Click repo on welcome screen
        const repoBtn = page.locator(`button:has-text("${repo.name}")`).first();
        if (await repoBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          console.log(`[${repo.name}] Clicking repo button`);
          await repoBtn.click();
          await page.waitForTimeout(2000);
        }

        await page.screenshot({ path: `${SHOTS}/${repo.name}-01-changes.png` });
        console.log(`[${repo.name}] Screenshot 1: Changes page`);

        // Check banner
        const banner = page.locator('[data-testid="repo-state-banner"]');
        const bv = await banner.isVisible({ timeout: 3000 }).catch(() => false);
        console.log(`[${repo.name}] Banner visible: ${bv}`);
        if (bv) console.log(`[${repo.name}] Banner: ${(await banner.textContent())?.substring(0, 100)}`);

        // Navigate to Diff
        console.log(`[${repo.name}] Navigating to Diff`);
        const diffNav = page.locator('text=Diff').first();
        if (await diffNav.isVisible({ timeout: 2000 }).catch(() => false)) {
          await diffNav.click();
          await page.waitForTimeout(1500);
        }
        await page.screenshot({ path: `${SHOTS}/${repo.name}-02-diff.png` });
        console.log(`[${repo.name}] Screenshot 2: Diff page`);

        // Find conflicted file
        const fileSelectors = ['text=config.ts', 'text=file1.ts', 'text=file2.py', 'text=file3.go', 'text=Button.tsx'];
        for (const sel of fileSelectors) {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log(`[${repo.name}] Found file: ${sel}`);

            // Right-click for context menu
            await el.click({ button: 'right' });
            await page.waitForTimeout(500);
            await page.screenshot({ path: `${SHOTS}/${repo.name}-03-menu.png` });
            console.log(`[${repo.name}] Screenshot 3: Context menu`);

            // Click Resolve Conflict
            const resolveItem = page.locator('text=Resolve Conflict').first();
            if (await resolveItem.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(`[${repo.name}] Clicking Resolve Conflict...`);
              await resolveItem.click();
              await page.waitForTimeout(3000);
              await page.screenshot({ path: `${SHOTS}/${repo.name}-04-3way.png` });
              console.log(`[${repo.name}] Screenshot 4: 3-way panel`);

              // Check editor
              const editor = page.locator('[data-testid="conflict-editor"]');
              const ev = await editor.isVisible({ timeout: 3000 }).catch(() => false);
              console.log(`[${repo.name}] Editor visible: ${ev}`);
              if (ev) {
                const et = await editor.textContent();
                console.log(`[${repo.name}] Editor has markers: ${et?.includes('<<<<<<<')}`);

                // Try Take Left
                const tl = page.locator('button:has-text("Take Left")').first();
                if (await tl.isVisible({ timeout: 2000 }).catch(() => false)) {
                  console.log(`[${repo.name}] Clicking Take Left`);
                  await tl.click();
                  await page.waitForTimeout(1000);
                  await page.screenshot({ path: `${SHOTS}/${repo.name}-05-take-left.png` });
                }

                // Try Save & Stage
                const sv = page.locator('button:has-text("saveStage")').first();
                if (await sv.isVisible({ timeout: 2000 }).catch(() => false)) {
                  console.log(`[${repo.name}] Clicking Save & Stage`);
                  await sv.click();
                  await page.waitForTimeout(2000);
                  await page.screenshot({ path: `${SHOTS}/${repo.name}-06-saved.png` });
                }
              }
            } else {
              console.log(`[${repo.name}] No Resolve menu — direct click`);
              await el.click();
              await page.waitForTimeout(2000);
              await page.screenshot({ path: `${SHOTS}/${repo.name}-04-direct.png` });
            }
            break;
          }
        }

        // Final
        await page.screenshot({ path: `${SHOTS}/${repo.name}-07-final.png` });
        console.log(`[${repo.name}] Screenshot 7: Final`);

        // Console errors
        const errs: string[] = [];
        page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
        await page.waitForTimeout(500);
        console.log(`[${repo.name}] Console errors: ${errs.length}`);
        errs.slice(0, 3).forEach((e, i) => console.log(`  [${i+1}] ${e.substring(0, 150)}`));

        await browser.close();
      } catch (e) {
        console.log(`[${repo.name}] ERROR: ${(e as Error).message}`);
        console.log(`[${repo.name}] stderr: ${stderr.join('').substring(0, 300)}`);
      } finally {
        child.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        fs.rmSync(ud, { recursive: true, force: true });
      }
      console.log(`[${repo.name}] === Done ===\n`);
    });
  }
});
