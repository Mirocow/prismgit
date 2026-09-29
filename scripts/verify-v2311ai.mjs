/**
 * v2.3.11 e2e verification (RU) — «AI assistant в комитах и не только не
 * работает пройдись по всему приложению».
 *
 * The full walk of every AI surface, in three phases:
 *   A — OUT OF THE BOX (no provider): controls must be ALIVE and point the
 *       user at what's missing (was: dead disabled buttons, no way in).
 *   B — mock LLM provider preconfigured: the whole pipeline works (commit
 *       messages, assistant panel, chat page) — the pipeline was never
 *       broken, only unreachable.
 *   C — the USER SETUP LOOP: add a provider through the REAL Settings UI →
 *       the commit flag auto-enables → the AI button generates from the
 *       just-added provider.
 *
 * The mock LLM server is spawned INSIDE this script (background processes
 * from shell tool calls do not survive).
 *
 * Usage: DISPLAY=:99 node scripts/verify-v2311ai.mjs
 */
import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/theme-probe-repo';
const SHOTS = '/home/z/my-project/work/v2311-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const MOCK_URL = 'http://127.0.0.1:43112/v1/chat/completions';

const mock = spawn('node', [path.join(process.cwd(), 'scripts/mock-llm-server.mjs'), '43112'], { stdio: ['ignore', 'pipe', 'ignore'] });
mock.stdout.on('data', (d) => { const s = String(d).trim(); if (s && !s.includes('listening')) console.log('  [mock]', s.slice(0, 90)); });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  .then(() => console.log(`  📸 ${name}`));

const settingsFileOf = (dir) => path.join(dir, 'prismgit-settings.json');

async function boot(settings, tag) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prismgit-v2311${tag}-`));
  fs.writeFileSync(settingsFileOf(userDataDir), JSON.stringify({
    settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru', ...settings },
    repositories: [{ path: REPO, name: 'theme-probe-repo', lastOpened: Date.now(), pinned: false }],
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
  await page.waitForTimeout(3000);
  try {
    await page.locator('text=theme-probe-repo').first().click({ timeout: 6000 });
    await page.waitForTimeout(2500);
  } catch { /* already open */ }
  return { app, page, userDataDir };
}

const readSetting = (dir, key) => {
  try {
    const j = JSON.parse(fs.readFileSync(settingsFileOf(dir), 'utf8'));
    return j.settings?.[key];
  } catch { return undefined; }
};

// ── Phase A: out of the box ────────────────────────────────────────────────
console.log('\n═══ A: out of the box — controls alive, guidance visible ═══');
{
  const { app, page } = await boot({}, 'a');

  // A1: Toolbar Sparkles is NOT disabled anymore
  const spark = page.locator('button[title*="Переключить чат AI"]').first();
  check('A1 toolbar assistant toggle ENABLED (was disabled out of the box)', (await spark.count()) > 0 && !(await spark.isDisabled()));
  await spark.click();
  await page.waitForTimeout(1500);
  await shot(page, 'a1-panel-banner');

  // A2: the no-provider banner with a «Настроить» button
  const banner = page.locator('text=ИИ-провайдер не настроен');
  check('A2 assistant panel shows the no-provider banner', (await banner.count()) > 0);
  const cfgBtn = page.locator('button:text-is("Настроить")').first();
  check('A3 banner has the Configure button', (await cfgBtn.count()) > 0);

  // A4: the Configure button deep-links to Settings → AI tab
  await cfgBtn.click();
  await page.waitForTimeout(1800);
  await shot(page, 'a4-settings-deeplink');
  const addBtn = page.locator('button:has-text("Добавить провайдера")').first();
  check('A4 deep link landed on Settings → AI (Add provider visible)', (await addBtn.count()) > 0);

  // A5: Changes AI button clickable → actionable toast
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2200);
  const aiBtn = page.locator('button[title*="Сгенерировать сообщение коммита"]').first();
  check('A5 Changes AI button ENABLED (was disabled)', (await aiBtn.count()) > 0 && !(await aiBtn.isDisabled()));
  await aiBtn.click();
  await page.waitForTimeout(1200);
  await shot(page, 'a5-changes-toast');
  const toast = await page.locator('text=AI-провайдер не настроен').count();
  check('A6 clicking without provider → actionable toast', toast > 0);

  await app.close();
}

// ── Phase B: preconfigured provider — the full pipeline ───────────────────
console.log('\n═══ B: mock provider — the whole pipeline works ═══');
{
  const { app, page } = await boot({
    aiCommitMessagesEnabled: true, aiActiveProviderId: 'custom-mock',
    aiProvider: 'custom', aiUrl: MOCK_URL, aiModel: 'mock-gpt-mini',
    aiProviders: [{ id: 'custom-mock', name: 'Mock LLM', kind: 'custom', url: MOCK_URL, apiKey: '', model: 'mock-gpt-mini', enabled: true }],
  }, 'b');

  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2200);
  const aiBtn = page.locator('button[title*="Сгенерировать сообщение коммита"]').first();
  await aiBtn.click();
  await page.waitForTimeout(4000);
  const editorVal = await page.locator('#commit-message-input').inputValue().catch(() => '');
  check('B1 AI commit message streamed into the editor', String(editorVal).includes('MOCK-LLM-OK'), String(editorVal).slice(0, 60));
  await shot(page, 'b1-commit-message');

  const spark = page.locator('button[title*="Переключить чат AI"]').first();
  await spark.click();
  await page.waitForTimeout(1500);
  const panelTa = page.locator('textarea').last();
  await panelTa.fill('покажи статус репозитория');
  await page.waitForTimeout(300);
  await page.locator('button[title="Отправить"]').last().click().catch(async () => panelTa.press('Enter'));
  await page.waitForTimeout(5000);
  const panelBody = await page.locator('body').innerText();
  check('B2 assistant panel answered via mock', panelBody.includes('MOCK-LLM-OK'));
  await shot(page, 'b2-panel-answer');

  await page.evaluate(() => { window.location.hash = '#/ai-chat'; });
  await page.waitForTimeout(2000);
  const ta = page.locator('textarea').first();
  await ta.fill('hello');
  await page.waitForTimeout(300);
  await page.locator('button[title="Отправить"]').first().click().catch(async () => ta.press('Enter'));
  await page.waitForTimeout(5000);
  const chatBody = await page.locator('body').innerText();
  check('B3 AI chat page round-trip', chatBody.includes('MOCK-LLM-OK'));
  await shot(page, 'b3-chat-answer');

  await app.close();
}

// ── Phase C: the user setup loop — add a provider in the REAL UI ──────────
console.log('\n═══ C: user adds a provider through Settings → everything comes alive ═══');
{
  const { app, page, userDataDir } = await boot({}, 'c');

  // Deep-link into Settings → AI from the assistant banner (the real path)
  const spark = page.locator('button[title*="Переключить чат AI"]').first();
  await spark.click();
  await page.waitForTimeout(1200);
  await page.locator('button:text-is("Настроить")').first().click();
  await page.waitForTimeout(1800);

  await page.locator('button:has-text("Добавить провайдера")').first().click();
  await page.waitForTimeout(1000);
  await shot(page, 'c1-add-dialog');
  // Custom (OpenAI-compatible) template → fill name/url/model
  await page.locator('button:has-text("Custom"), button:has-text("Свой")').first().click().catch(() => {});
  await page.waitForTimeout(600);
  const inputs = page.locator('input[type="text"]');
  const n = await inputs.count();
  check('C1 add-provider dialog opened with fields', n >= 3, `inputs=${n}`);
  await inputs.nth(0).fill('Мой мок');
  const urlInput = page.locator('input[placeholder*="example.com"], input[placeholder*="11434"]').first();
  await urlInput.fill(MOCK_URL);
  const modelInput = page.locator('input[placeholder*="gpt-4o-mini"], input[placeholder*="llama3.2"]').first();
  await modelInput.fill('mock-gpt-mini');
  await shot(page, 'c2-dialog-filled');
  // common.save in RU is just «Сохранить» (the 'Save provider' string is
  // only the English fallback in the component).
  await page.locator('button:has-text("Сохранить")').first().click();
  await page.waitForTimeout(2500);
  await shot(page, 'c3-saved');

  check('C2 provider card «Мой мок» appears in the grid', (await page.locator('text=Мой мок').count()) > 0);
  await page.waitForTimeout(800);
  check('C3 the commit-message flag AUTO-ENABLED after first provider', readSetting(userDataDir, 'aiCommitMessagesEnabled') === true,
    String(readSetting(userDataDir, 'aiCommitMessagesEnabled')));
  check('C4 provider persisted', (readSetting(userDataDir, 'aiProviders') ?? []).length >= 1);
  check('C5 active provider id persisted', typeof readSetting(userDataDir, 'aiActiveProviderId') === 'string');

  // C6: the AI button now GENERATES from the just-added provider
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2500);
  const aiBtn = page.locator('button[title*="Сгенерировать сообщение коммита"]').first();
  await aiBtn.click();
  await page.waitForTimeout(4500);
  const editorVal = await page.locator('#commit-message-input').inputValue().catch(() => '');
  check('C6 AI commit message generated from the just-added provider', String(editorVal).includes('MOCK-LLM-OK'), String(editorVal).slice(0, 60));
  await shot(page, 'c6-generates');

  await app.close();
}

mock.kill();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
