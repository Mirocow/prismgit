/**
 * Release screenshots — «открой репозиторий prismgit с помощью самого
 * prismgit, сделай скрин основных экранов».
 *
 * Opens THE PRISMGIT REPO ITSELF inside the built app (production build,
 * EN locale, Ayu Dark) and captures the main screens for the README:
 *   history (All-branches graph), changes (real uncommitted work),
 *   branches, pull requests (real GitLab MRs), reviews, AI chat, settings,
 *   + a light-theme History shot, + RU-locale history/changes for README.ru.
 *
 * Output: docs/screenshots/*.png
 * Usage: DISPLAY=:99 node scripts/take-release-screenshots.mjs
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const OUT = path.join(REPO, 'docs', 'screenshots');
const GL_TOKEN = 'glpat-WU4paMsj1aLktM8BUQktAm86MQp1Om0H.01.0w0h427at';
const GL_URL = 'http://178.140.10.58:8082';

fs.mkdirSync(OUT, { recursive: true });

async function launchApp({ locale, theme }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prismgit-shots-${locale}-`));
  fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
    settings: { theme, tourCompleted: true, autoRefresh: true, locale },
    repositories: [{ path: REPO, name: 'gitclient', lastOpened: Date.now(), pinned: false }],
    repoMetadata: {},
  }, null, 2));
  fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
    windowState: { bounds: { x: 0, y: 0, width: 1560, height: 960 }, isMaximized: false, isFullScreen: false },
  }, null, 2));
  const app = await electron.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      path.join(process.cwd(), 'dist-electron/main.js')],
    env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99',
      PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: locale },
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  // Open the prismgit repo itself — «репозиторий prismgit … с помощью самого prismgit»
  await page.locator('button:has-text("gitclient")').first().click().catch(async () => {
    await page.locator('[data-testid="repo-item-gitclient"]').first().click();
  });
  await page.waitForTimeout(4000);
  return { app, page };
}

const nav = async (page, hash, settle = 2500) => {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(settle);
};

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`📸 ${name}`);
};

// ── 1. EN, Ayu Dark — the main README set ──────────────────────────────────
{
  const { app, page } = await launchApp({ locale: 'en', theme: 'dark' });

  // History with the full branch graph (All branches)
  await nav(page, '#/history', 3000);
  await page.locator('button[title="More filters"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Branches:")').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('label:has-text("All branches") input[type="radio"]').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  await shot(page, 'history-dark.png');

  // Changes — the real uncommitted counters-fix worktree
  await nav(page, '#/changes', 2500);
  await shot(page, 'changes-dark.png');

  // Branches
  await nav(page, '#/branches', 2500);
  await shot(page, 'branches.png');

  // GitLab auth → Pull Requests (real MRs of the project)
  await page.evaluate(async ({ token, url }) => {
    await window.smartgit.gitlab.authWithPAT(token, url);
  }, { token: GL_TOKEN, url: GL_URL });
  await page.waitForTimeout(1000);
  await nav(page, '#/pulls', 4000);
  await page.waitForTimeout(4000); // MR list from the real GitLab
  await shot(page, 'pulls.png');

  // Select the first MR, then Reviews (shared provider selection)
  await page.locator('div.cursor-pointer').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await nav(page, '#/reviews', 3000);
  await page.waitForTimeout(2500);
  await shot(page, 'reviews.png');

  // AI Assistant
  await nav(page, '#/ai-chat', 2000);
  await shot(page, 'ai-chat.png');

  // Settings
  await nav(page, '#/settings', 2000);
  await shot(page, 'settings.png');

  // Light theme — History again (theme toggle shortcut)
  await nav(page, '#/history', 2500);
  await page.keyboard.press('Control+Shift+T');
  await page.waitForTimeout(1200);
  await shot(page, 'history-light.png');

  await app.close();
}

// ── 2. RU locale — for README.ru.md ────────────────────────────────────────
{
  const { app, page } = await launchApp({ locale: 'ru', theme: 'dark' });
  await nav(page, '#/history', 3000);
  await page.locator('button[title="More filters"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Branches:")').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('label:has-text("Все ветки") input[type="radio"]').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  await shot(page, 'history-ru.png');
  await nav(page, '#/changes', 2500);
  await shot(page, 'changes-ru.png');
  await app.close();
}

console.log('DONE — screenshots in', OUT);
