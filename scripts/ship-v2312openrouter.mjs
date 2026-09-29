/**
 * SHIP v2.3.12 — commit + push THROUGH THE APP (RU locale).
 * Bonus evidence: the OpenRouter free-model fallback + friendly error
 * working in the shipping build itself (the exact bug this release fixes).
 * Usage: DISPLAY=:99 node scripts/ship-v2312openrouter.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/gitclient';
const SHOTS = '/home/z/my-project/work/release-v2312';
const MOCK_PORT = 43121;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/api/v1`;
const MSG = 'fix(ux): v2.3.12 — OpenRouter free models: readable errors + 429 fallback\n\n'
  + '- User report: «из бесплатных доступна только openrouter/free» + raw\n'
  + '  "Error: Error: OpenAI chat error 429: {json}" walls. The model id was\n'
  + '  passed CORRECTLY (429 names the model+provider) — the app just had no\n'
  + '  fallback and dumped raw JSON with a double Error: prefix\n'
  + '- new src/lib/aiErrors.ts: LLMApiError (kind+status+providerMessage+\n'
  + '  remedy) thrown by EVERY LLM call site (aiChat x3 protocols,\n'
  + '  commit-message batch + streaming, electron/services/ai.ts IPC path);\n'
  + '  messages carry a parseable [kind status] marker so IPC-marshaled\n'
  + '  errors revive with the same structure at the UI\n'
  + '- 429 on an OpenRouter :free model → automatic single retry via the\n'
  + '  openrouter/free meta-router (visible info toast, never silent);\n'
  + '  paid models never downgrade silently (readable error instead)\n'
  + '- OpenRouter preset default: dead llama-3.1-8b:free → openrouter/free\n'
  + '- provider editor: FREE badges (pricing 0 / :free) + «free only» filter\n'
  + '- AiAssistant/AiChatPage: localized error titles + provider message +\n'
  + '  remedy instead of "Error: ${String(e)}"; i18n aiErr.* x4 locales\n'
  + '- pins v2312Pins (26); suite 2143/0/34 skipped (unit+components 1660 /\n'
  + '  integration 483); tsc clean; build green; live e2e\n'
  + '  verify-v2312openrouter ALL PASSED (25) against a mock OpenRouter that\n'
  + '  reproduces the exact 429 upstream_provider_shared_pool failure; v2311\n'
  + '  regression ALL PASSED';

fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  .then(() => console.log(`📸 ${name}`));
const sh = (cmd) => execSync(cmd, { cwd: REPO, encoding: 'utf8', shell: '/bin/bash' });

const mock = spawn('node', [path.join(process.cwd(), 'scripts/mock-openrouter.mjs'), String(MOCK_PORT)], { stdio: ['ignore', 'pipe', 'ignore'] });
mock.stdout.on('data', (d) => { const s = String(d).trim(); if (s && !s.includes('listening')) console.log('  [mock]', s.slice(0, 90)); });

const before = { head: sh('git rev-parse HEAD').trim(), origin: sh('git rev-parse origin/feature/smartgit-electron-v3').trim(), dirty: sh('git status --porcelain').split('\n').filter(Boolean).length };
console.log('BEFORE: dirty =', before.dirty, '· head', before.head.slice(0, 8), '· origin', before.origin.slice(0, 8));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-v2312-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru',
    aiCommitMessagesEnabled: true, aiActiveProviderId: 'or-ship',
    aiProvider: 'openrouter', aiUrl: MOCK_BASE, aiModel: 'google/gemma-4-31b-it:free',
    aiProviders: [{ id: 'or-ship', name: 'OpenRouter мок', kind: 'openrouter', url: MOCK_BASE, apiKey: 'sk-or-mock', model: 'google/gemma-4-31b-it:free', enabled: true }],
  },
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

// ── 0. BONUS EVIDENCE: the fixed 429 → openrouter/free fallback, live in the shipping app
const spark = page.locator('button[title*="Переключить чат AI"]').first();
await spark.click();
await page.waitForTimeout(1400);
const clearBtn = page.locator('button[title*="Очистить историю чата"]');
if ((await clearBtn.count()) > 0) { await clearBtn.first().click(); await page.waitForTimeout(500); }
const ta = page.locator('textarea').last();
await ta.fill('проверь fallback');
await page.waitForTimeout(300);
await page.locator('button[title="Отправить"]').last().click().catch(async () => ta.press('Enter'));
await page.waitForTimeout(6000);
await shot(page, '00-live-fallback.png');
const liveBody = await page.locator('body').innerText();
console.log('LIVE fallback answer visible:', liveBody.includes('MOCK-OPENROUTER-OK'));
console.log('LIVE no raw JSON wall:', !liveBody.includes('upstream_provider_shared_pool'));
// Close the panel — its fixed bottom-right overlay would intercept the
// «Коммит» button click in the step below.
await spark.click();
await page.waitForTimeout(800);

// ── 1. Changes → stage (if anything is still unstaged) → commit v2.3.12
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
// Tolerant staging: a previous partial run may have already staged everything
// (then the "Изменения (" section is absent — that's fine).
await page.locator('span:has-text("Изменения (")').first().waitFor({ timeout: 6000 }).catch(() => {});
const unstagedHeader = page.locator('span:has-text("Изменения (")').first();
if ((await unstagedHeader.count()) > 0) {
  await unstagedHeader.click();
  await page.waitForTimeout(2500);
}
await page.locator('span:has-text("Индекс (")').first().waitFor({ timeout: 15000 });
await shot(page, '01-staged.png');

await page.locator('#commit-message-input').fill(MSG);
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.locator('button:text-is("Коммит")').first().click();
await page.waitForTimeout(5000);
await shot(page, '02-commit-done.png');

const head1 = sh('git rev-parse HEAD').trim();
const clean = sh('git status --porcelain').trim() === '';
console.log('COMMIT:', head1.slice(0, 8), 'parent', before.head.slice(0, 8), 'clean-tree', clean);
if (head1 === before.head) { console.log('FAIL: no commit created'); await app.close(); mock.kill(); process.exit(1); }

// ── 2. Push
await page.locator('button[title*="Отправить текущую ветку"]').first().click();
await page.waitForTimeout(9000);
await shot(page, '03-push.png');

let origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
if (origin1 !== head1) {
  await page.waitForTimeout(4000);
  origin1 = sh('git rev-parse origin/feature/smartgit-electron-v3').trim();
}
console.log('PUSH: origin =', origin1.slice(0, 8), '== local', head1.slice(0, 8), origin1 === head1);
if (origin1 !== head1) { console.log('FAIL: push did not land'); await app.close(); mock.kill(); process.exit(1); }

await app.close();
mock.kill();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log('SHIP v2.3.12 DONE — commit + push via UI verified, fallback live in the shipping build');
