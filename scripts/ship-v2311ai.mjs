/**
 * SHIP v2.3.11 — commit + push THROUGH THE APP (RU locale).
 * Bonus evidence: the out-of-the-box AI banner + deep link working in the
 * shipping build (the very bug this release fixes).
 * Usage: DISPLAY=:99 node scripts/ship-v2311ai.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v2311';
const MSG = 'fix(ux): v2.3.11 — AI assistant alive out of the box\n\n'
  + '- User report: «AI assistant в комитах и не только не работает».\n'
  + '  Diagnosed against a mock LLM (diagnose-ai.mjs): the pipeline was\n'
  + '  fine — the GATING was broken: aiCommitMessagesEnabled defaults to\n'
  + '  OFF and disabled BOTH the Changes AI button AND the toolbar\n'
  + '  Sparkles (the whole assistant chat, unrelated to commit messages)\n'
  + '- Changes «AI» + MergePanel AI: always clickable; provider-first\n'
  + '  check, and the click itself enables the flag (auto-suggest + @ai\n'
  + '  placeholder follow) — no more bouncing to Settings\n'
  + '- Toolbar Sparkles: unconditional; the panel handles the empty state\n'
  + '- upsertAiProvider: first provider auto-enables the flag (buttons\n'
  + '  used to stay dead even after setup)\n'
  + '- new no-provider banners (assistant panel + chat page) with a\n'
  + '  «Настроить» button deep-linking to #/settings?tab=ai (new deep-link\n'
  + '  support in SettingsPage)\n'
  + '- i18n: 3 keys x4 locales\n'
  + '- pins v2311Pins (11); suite 2117/0/34 skipped (unit 1399 / components\n'
  + '  235 / integration 483); tsc clean; build green; live e2e\n'
  + '  verify-v2311ai ALL PASSED (16): out-of-the-box guidance, mock-LLM\n'
  + '  pipeline, full setup loop (add provider via real dialog -> flag\n'
  + '  auto-enables -> generation from the new provider)';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash' });

const before = { head: sh('git rev-parse HEAD').trim(), origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(), dirty: sh('git status --porcelain').split('\n').filter(Boolean).length };
console.log('BEFORE: dirty =', before.dirty, '· head', before.head.slice(0, 8), '· origin', before.origin.slice(0, 8));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v2311-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
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
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
});
const page = await app.firstWindow();
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('button:has-text("gitclient")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-gitclient"]').first().click();
});
await page.waitForTimeout(4000);

// ── 0. BONUS EVIDENCE: the fixed out-of-the-box AI state, in the shipping app
const spark = page.locator('button[title*="Переключить чат AI"]').first();
await spark.click();
await page.waitForTimeout(1400);
await shot(page, '00-ai-banner.png');
const bannerOk = (await page.locator('text=ИИ-провайдер не настроен').count()) > 0;
console.log('LIVE no-provider banner visible:', bannerOk);
await page.locator('button:text-is("Настроить")').first().click().catch(() => {});
await page.waitForTimeout(1600);
await shot(page, '01-deeplink-settings-ai.png');
const deepOk = (await page.locator('button:has-text("Добавить провайдера")').count()) > 0;
console.log('LIVE deep link → Settings AI:', deepOk);

// ── 1. Changes → stage → commit v2.3.11
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
await page.locator('span:has-text("Изменения (")').first().waitFor({ timeout: 15000 });
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if (await unstagedHeader.count() > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2500);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 15000 });
await shot(page, '02-staged.png');

await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(5000);
await shot(page, '03-commit-done.png');

const head1 = sh('git rev-parse HEAD').trim();
const clean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', clean);
if (head1 === before.head) { console.log('FAIL: no commit created'); await app.close(); process.exit(1); }

// ── 2. Push
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(9000);
await shot(page, '04-push.png');

let origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
if (origin1 !== head1) {
  await page.waitForTimeout(4000);
  origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
}
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); await app.close(); process.exit(1); }

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log('SHIP v2.3.11 DONE — commit + push via UI verified');
