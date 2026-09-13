/**
 * PrismGit Conflict Resolution Screenshots
 * ========================================
 *
 * Launches the Electron app via Playwright, opens a test repo with merge
 * conflicts, and captures screenshots of every conflict-resolution UI state.
 *
 * Screenshots are saved to /home/z/my-project/download/screenshots/
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

const TEST_REPO = '/tmp/test-conflict-repo';
const USER_DATA = '/tmp/prismgit-screens-data';
const SCREENSHOT_DIR = '/home/z/my-project/download/screenshots';

// Ensure screenshot dir exists
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function main() {
  console.log('Launching PrismGit…');

  const app: ElectronApplication = await electron.launch({
    args: [
      path.join('/home/z/my-project/repos/gitclient', 'dist-electron', 'main.js'),
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--ozone-platform=headless',
      '--use-gl=swiftshader',
      '--disable-software-rasterizer',
      '--enable-features=Vulkan',
    ],
    env: {
      ...process.env,
      DISPLAY: ':42',
      PRISMGIT_USER_DATA: USER_DATA,
    },
    timeout: 30000,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // Give the app time to load repo status
  await page.waitForTimeout(2000);

  console.log('App launched. Opening test-conflict-repo…');

  // Click on the test-conflict-repo in the sidebar to open it
  // The repo card on the welcome screen or sidebar item
  const repoItem = page.locator('text=test-conflict-repo').first();
  if (await repoItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await repoItem.click();
    await page.waitForTimeout(3000);
    console.log('  ✓ Repo opened');
  } else {
    console.log('  ! Repo item not found — trying #/changes directly');
  }

  console.log('Capturing screenshots…');

  // Helper: take a screenshot with a name
  const shot = async (name: string) => {
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  ✓ ${name}.png`);
  };

  // Helper: wait + screenshot
  const waitShot = async (name: string, ms = 1000) => {
    await page.waitForTimeout(ms);
    await shot(name);
  };

  // 1. Changes page with conflicts (RepoStateBanner + ConflictList)
  console.log('1. Changes page — conflicts visible');
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await waitShot('01-changes-conflicts', 2500);

  // 2. Expand the conflict list (if collapsed)
  console.log('2. Expand conflict list');
  const expandBtn = page.getByTitle('Expand conflict list');
  if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandBtn.click();
    await waitShot('02-conflict-list-expanded', 1500);
  } else {
    // Already expanded — just screenshot
    await waitShot('02-conflict-list-expanded', 1000);
  }

  // 3. Right-click context menu on a conflicted file → Resolve submenu
  console.log('3. Context menu — Resolve submenu');
  // Find a conflicted file row and right-click it
  const conflictRow = page.locator('text=file1.ts').first();
  if (await conflictRow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await conflictRow.click({ button: 'right' });
    await waitShot('03-context-menu', 1000);
    // Try to hover/click the "Resolve" submenu item
    const resolveItem = page.locator('text=Resolve').first();
    if (await resolveItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await resolveItem.hover();
      await waitShot('04-resolve-submenu', 1000);
    }
  }

  // 4. Open the ConflictSolver (3-way merge modal)
  console.log('4. ConflictSolver — 3-way merge modal');
  await page.keyboard.press('Escape'); // close any context menu
  await page.waitForTimeout(500);
  // Click the "Solver" button on the first conflicted file
  const solverBtn = page.locator('text=Solver').first();
  if (await solverBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await solverBtn.click();
    await waitShot('05-conflict-solver-3way', 3000);
  }

  // 5. History page (show the merge in progress + conflicts)
  console.log('5. History page');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.location.hash = '#/history'; });
  await waitShot('06-history-merge-state', 2500);

  // 6. Branches page (show cherry-pick warning banner if any)
  console.log('6. Branches page');
  await page.evaluate(() => { window.location.hash = '#/branches'; });
  await waitShot('07-branches', 2500);

  // 7. StatusBar (in-progress indicator) — full page, the status bar is at the bottom
  console.log('7. StatusBar — in-progress indicator');
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, '08-statusbar-inprogress.png'),
    clip: { x: 0, y: 868, width: 1440, height: 32 },
  });
  console.log('  ✓ 08-statusbar-inprogress.png');

  // 8. RepoStateBanner close-up (top of Changes page, below toolbar)
  console.log('8. RepoStateBanner close-up');
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, '09-repostate-banner.png'),
    clip: { x: 0, y: 70, width: 1440, height: 50 },
  });
  console.log('  ✓ 09-repostate-banner.png');

  // 9. ConflictSolver — click Solver button to open 3-way merge modal
  console.log('9. ConflictSolver — 3-way merge modal');
  // Find and click the first "Solver" button
  const solverButtons = page.locator('button:has-text("Solver")');
  const count = await solverButtons.count();
  console.log(`   Found ${count} Solver buttons`);
  if (count > 0) {
    await solverButtons.first().click();
    await page.waitForTimeout(2000);
    await shot('05-conflict-solver-3way');
  }

  // 10. Context menu — right-click a conflicted file row
  console.log('10. Context menu — right-click conflicted file');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const file1Row = page.locator('text=file1.ts').first();
  if (await file1Row.isVisible({ timeout: 3000 }).catch(() => false)) {
    await file1Row.click({ button: 'right' });
    await page.waitForTimeout(800);
    await shot('03-context-menu');
  }

  // === NEW: ConflictSolver detailed views ===

  // 11. ConflictSolver — 3-pane layout (Base | Ours | Theirs)
  console.log('11. ConflictSolver — 3-pane layout (Base | Ours | Theirs)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2000);
  const solverBtn2 = page.locator('button:has-text("Solver")').first();
  if (await solverBtn2.isVisible({ timeout: 3000 }).catch(() => false)) {
    await solverBtn2.click();
    // Wait longer for file content to load (3 git show calls for :1:/:2:/:3: stages)
    await page.waitForTimeout(5000);
    await shot('11-solver-3pane-base-ours-theirs');

    // 12. ConflictSolver — layout selector (try clicking the 2nd layout option)
    console.log('12. ConflictSolver — merge-below layout');
    // The layout buttons are small text buttons: 3-pane | merge-below | left-merge | right-merge
    // Try to find them by their text content
    const layoutOptions = ['3-pane', 'merge-below', 'left-merge', 'right-merge'];
    for (const layout of layoutOptions) {
      const btn = page.locator(`button:has-text("${layout}")`).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`   Found layout button: ${layout}`);
      }
    }
    // Try clicking merge-below
    const mergeBelow = page.locator('button:has-text("merge-below")').first();
    if (await mergeBelow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await mergeBelow.click();
      await page.waitForTimeout(1500);
      await shot('12-solver-merge-below');
      // Switch back to 3-pane
      const threePane = page.locator('button:has-text("3-pane")').first();
      if (await threePane.isVisible({ timeout: 1000 }).catch(() => false)) {
        await threePane.click();
        await page.waitForTimeout(1000);
      }
    }

    // 13. ConflictSolver — "Use ours" hunk resolution
    console.log('13. ConflictSolver — Use ours button');
    const useOursBtn = page.locator('button:has-text("Use ours")').first();
    if (await useOursBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await useOursBtn.click();
      await page.waitForTimeout(1000);
      await shot('13-solver-use-ours');
    } else {
      console.log('   "Use ours" button not found — taking screenshot anyway');
      await shot('13-solver-no-hunks');
    }

    // 14. ConflictSolver — toolbar with Merge Tool + Save buttons
    console.log('14. ConflictSolver — toolbar with Merge Tool button');
    await page.waitForTimeout(500);
    await shot('14-solver-toolbar-mergetool');

    // Close the solver
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // 15. Diff page — show the Diff tool
  console.log('15. Diff tool — default view');
  await page.evaluate(() => { window.location.hash = '#/diff'; });
  await page.waitForTimeout(3000);
  await shot('15-diff-tool-default');

  // 16. Diff tool — try to show a conflicted file
  console.log('16. Diff tool — file diff');
  await page.waitForTimeout(1500);
  await shot('16-diff-viewer');

  console.log('\nAll screenshots captured to:', SCREENSHOT_DIR);
  await app.close();
}

main().catch((e) => {
  console.error('Screenshot capture failed:', e);
  process.exit(1);
});
