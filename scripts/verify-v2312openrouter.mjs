/**
 * v2.3.12 e2e verification (RU) — «из бесплатных доступна только
 * openrouter/free … Error: OpenAI chat error 429: {"error":{…}}».
 *
 * Against a mock OpenRouter that reproduces the user's EXACT failure mode
 * (every model but openrouter/free → 429 upstream_provider_shared_pool):
 *   P1 — assistant panel: 429 on google/gemma-…:free → auto-retry via
 *        openrouter/free → answer arrives + visible fallback toast + NO raw
 *        JSON wall, NO double "Error: Error:".
 *   P2 — commit message (streaming path): same 429 → fallback → the message
 *        streams into the editor via openrouter/free.
 *   P3 — provider editor: Fetch models → FREE badges + «Только бесплатные»
 *        filter (on by default for OpenRouter).
 *   P4 — PAID model 429 → NO silent fallback → friendly localized error.
 *   P5 — the OpenRouter preset now defaults to openrouter/free.
 *
 * The mock server is spawned INSIDE this script (background processes from
 * shell tool calls do not survive).
 *
 * Usage: DISPLAY=:99 node scripts/verify-v2312openrouter.mjs
 */
import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = '/home/z/my-project/work/theme-probe-repo';
const SHOTS = '/home/z/my-project/work/v2312-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const MOCK_PORT = 43120;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}/api/v1`;
const LOG = '/home/z/my-project/work/v2312-openrouter-log.jsonl';
try { fs.unlinkSync(LOG); } catch { /* fresh */ }

const mock = spawn('node', [path.join(process.cwd(), 'scripts/mock-openrouter.mjs'), String(MOCK_PORT), LOG], { stdio: ['ignore', 'pipe', 'ignore'] });
mock.stdout.on('data', (d) => { const s = String(d).trim(); if (s && !s.includes('listening')) console.log('  [mock]', s.slice(0, 100)); });

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  .then(() => console.log(`  📸 ${name}`));

const readLog = () => {
  try {
    return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
};

const settingsFileOf = (dir) => path.join(dir, 'prismgit-settings.json');

async function boot(settings, tag) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prismgit-v2312${tag}-`));
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

const askPanel = async (page, text) => {
  const ta = page.locator('textarea').last();
  await ta.fill(text);
  await page.waitForTimeout(300);
  await page.locator('button[title="Отправить"]').last().click().catch(async () => ta.press('Enter'));
  await page.waitForTimeout(6000);
};

/** Accumulate body text over time — toasts auto-dismiss after 4 s, so a
 *  single late read misses them. Poll and merge instead. */
const collectBody = async (page, ms) => {
  let seen = '';
  const steps = Math.max(1, Math.floor(ms / 500));
  for (let i = 0; i < steps; i++) {
    await page.waitForTimeout(500);
    seen += (await page.locator('body').innerText()) + '\n';
  }
  return seen;
};

// ── P1 + P2: free model 429 → auto-fallback via openrouter/free ───────────
console.log('\n═══ P1/P2: :free model 429 → auto-retry via openrouter/free ═══');
{
  const markBefore = readLog().length;
  const { app, page } = await boot({
    aiCommitMessagesEnabled: true, aiActiveProviderId: 'or-mock',
    aiProvider: 'openrouter', aiUrl: MOCK_BASE, aiModel: 'google/gemma-4-31b-it:free',
    aiProviders: [{ id: 'or-mock', name: 'OpenRouter мок', kind: 'openrouter', url: MOCK_BASE, apiKey: 'sk-or-mock', model: 'google/gemma-4-31b-it:free', enabled: true }],
  }, 'p1');

  // P1: the assistant panel answers DESPITE the 429 (auto-fallback).
  // NOTE: the renderer localStorage is APP-WIDE (v2.3.8 lesson) and the chat
  // history is keyed by repo path — previous runs' transcripts (with their
  // old-format error messages!) would poison the assertions. Clear first.
  const spark = page.locator('button[title*="Переключить чат AI"]').first();
  await spark.click();
  await page.waitForTimeout(1500);
  const clearBtn = page.locator('button[title*="Очистить историю чата"]');
  if ((await clearBtn.count()) > 0) {
    await clearBtn.first().click();
    await page.waitForTimeout(600);
  }
  const ta = page.locator('textarea').last();
  await ta.fill('покажи статус');
  await page.waitForTimeout(300);
  await page.locator('button[title="Отправить"]').last().click().catch(async () => ta.press('Enter'));
  const seen = await collectBody(page, 7000);
  const body = seen;
  check('P1a panel answered via the openrouter/free fallback', body.includes('MOCK-OPENROUTER-OK'));
  check('P1b fallback toast visible («перегружена» + router)', /перегружена/.test(body) && /openrouter\/free/.test(body));
  check('P1c NO raw JSON wall in the chat', !body.includes('"limit_source"') && !body.includes('upstream_provider_shared_pool'));
  check('P1d NO double "Error: Error:" prefix', !body.includes('Error: Error:'));
  check('P1e NO raw "OpenAI chat error 429" text', !body.includes('OpenAI chat error'));
  await shot(page, 'p1-panel-fallback');

  // P2: the commit-message STREAMING path gets the same fallback.
  const markCommit = readLog().length;
  await page.evaluate(() => { window.location.hash = '#/changes'; });
  await page.waitForTimeout(2200);
  const aiBtn = page.locator('button[title*="Сгенерировать сообщение коммита"]').first();
  await aiBtn.click();
  await page.waitForTimeout(6000);
  const editorVal = await page.locator('#commit-message-input').inputValue().catch(() => '');
  check('P2a commit message generated via the fallback (streaming path)', String(editorVal).includes('MOCK-OPENROUTER-OK'), String(editorVal).slice(0, 60));
  await shot(page, 'p2-commit-fallback');
  const entries = readLog().slice(markCommit);
  const saw429 = entries.some((e) => e.status === 429 && e.model === 'google/gemma-4-31b-it:free');
  const sawRouter = entries.some((e) => e.status === 200 && e.model === 'openrouter/free');
  check('P2b mock saw the 429 AND the router retry', saw429 && sawRouter, `429=${saw429} router=${sawRouter}`);
  const routerStream = entries.some((e) => e.status === 200 && e.model === 'openrouter/free' && e.stream);
  check('P2c the router retry used the streaming request', routerStream);

  const total = readLog().length - markBefore;
  check('P1f mock log recorded the whole exchange', total >= 4, `entries=${total}`);

  await app.close();
}

// ── P3: FREE badges + «Только бесплатные» in the model dropdown ────────────
console.log('\n═══ P3: model list — FREE badges + free-only filter ═══');
{
  const { app, page } = await boot({
    aiCommitMessagesEnabled: true, aiActiveProviderId: 'or-mock',
    aiProvider: 'openrouter', aiUrl: MOCK_BASE, aiModel: 'google/gemma-4-31b-it:free',
    aiProviders: [{ id: 'or-mock', name: 'OpenRouter мок', kind: 'openrouter', url: MOCK_BASE, apiKey: 'sk-or-mock', model: 'google/gemma-4-31b-it:free', enabled: true }],
  }, 'p3');

  await page.evaluate(() => { window.location.hash = '#/settings?tab=ai'; });
  await page.waitForTimeout(2500);
  // Open the provider editor (pencil on the card).
  await page.locator('button[title*="Изменить"], button:has-text("Изменить")').first().click();
  await page.waitForTimeout(1000);
  await shot(page, 'p3-editor-open');

  // Fetch the model list from the mock.
  await page.locator('button:has-text("Загрузить модели")').first().click();
  await page.waitForTimeout(2500);
  await shot(page, 'p3-models-fetched');

  const freeBadges = await page.locator('span:has-text("FREE")').count();
  check('P3a FREE badges rendered in the dropdown', freeBadges >= 2, `badges=${freeBadges}`);
  const filterBox = page.locator('label:has-text("Только бесплатные")');
  check('P3b «Только бесплатные» filter present', (await filterBox.count()) > 0);
  const filterChecked = await page.locator('label:has-text("Только бесплатные") input[type="checkbox"]').first().isChecked();
  check('P3c the filter is ON by default for OpenRouter', filterChecked === true);
  const rowsWith = await page.locator('div.max-h-72 button, .overflow-y-auto button').count();
  // All visible rows must be free while the filter is on.
  const paidVisible = await page.locator('button:has-text("anthropic/claude-3.5-sonnet")').count();
  check('P3d paid models hidden while the filter is on', paidVisible === 0, `rows=${rowsWith}`);
  // Turn the filter off → paid models appear.
  await page.locator('label:has-text("Только бесплатные") input[type="checkbox"]').first().uncheck({ force: true });
  await page.waitForTimeout(600);
  const paidVisibleNow = await page.locator('button:has-text("anthropic/claude-3.5-sonnet")').count();
  check('P3e turning the filter off shows paid models', paidVisibleNow > 0);
  await shot(page, 'p3-filter-off');

  // Pick the meta-router from the list (the recommended default).
  await page.locator('button:has-text("openrouter/free")').first().click();
  await page.waitForTimeout(500);
  const modelVal = await page.locator('input[placeholder*="gpt-4o-mini"], input[placeholder*="llama3.2"]').first().inputValue();
  check('P3f picking openrouter/free fills the model field', modelVal === 'openrouter/free', modelVal);

  await app.close();
}

// ── P4: PAID model 429 → NO silent fallback, friendly localized error ──────
console.log('\n═══ P4: paid model 429 → readable error, no silent downgrade ═══');
{
  const { app, page } = await boot({
    aiCommitMessagesEnabled: true, aiActiveProviderId: 'or-paid',
    aiProvider: 'openrouter', aiUrl: MOCK_BASE, aiModel: 'anthropic/claude-3.5-sonnet',
    aiProviders: [{ id: 'or-paid', name: 'OpenRouter платный', kind: 'openrouter', url: MOCK_BASE, apiKey: 'sk-or-mock', model: 'anthropic/claude-3.5-sonnet', enabled: true }],
  }, 'p4');

  const markBefore = readLog().length;
  const spark = page.locator('button[title*="Переключить чат AI"]').first();
  await spark.click();
  await page.waitForTimeout(1500);
  // Clear the stale app-wide chat history (same isolation reason as P1).
  const clearBtnP4 = page.locator('button[title*="Очистить историю чата"]');
  if ((await clearBtnP4.count()) > 0) {
    await clearBtnP4.first().click();
    await page.waitForTimeout(600);
  }
  const taP4 = page.locator('textarea').last();
  await taP4.fill('проверь ошибку');
  await page.waitForTimeout(300);
  await page.locator('button[title="Отправить"]').last().click().catch(async () => taP4.press('Enter'));
  const bodyP4 = await collectBody(page, 7000);
  const body = bodyP4;
  check('P4a NO fallback answer for a paid model', !body.includes('MOCK-OPENROUTER-OK'));
  const entries = readLog().slice(markBefore);
  check('P4b the router was NOT used (no silent downgrade)', !entries.some((e) => e.model === 'openrouter/free'));
  check('P4c friendly localized title present', /ограничена/.test(body) && body.includes('429'));
  check('P4d the provider message is readable, not a JSON wall', /temporarily rate-limited upstream/.test(body) && !body.includes('"limit_source"'));
  check('P4e NO double "Error: Error:" prefix', !body.includes('Error: Error:'));
  await shot(page, 'p4-paid-friendly-error');

  await app.close();
}

// ── P5: the OpenRouter preset defaults to openrouter/free ─────────────────
console.log('\n═══ P5: preset default — openrouter/free ═══');
{
  const { app, page } = await boot({}, 'p5');
  await page.evaluate(() => { window.location.hash = '#/settings?tab=ai'; });
  await page.waitForTimeout(2500);
  await page.locator('button:has-text("Добавить провайдера")').first().click();
  await page.waitForTimeout(1000);
  // Click the OpenRouter template in the type picker.
  await page.locator('button:has-text("OpenRouter"), button:has-text("openrouter")').first().click();
  await page.waitForTimeout(700);
  const modelVal = await page.locator('input[placeholder*="gpt-4o-mini"], input[placeholder*="llama3.2"]').first().inputValue().catch(() => '(no model input)');
  check('P5a the OpenRouter template pre-fills openrouter/free', modelVal === 'openrouter/free', modelVal);
  const urlVal = await page.locator('input[placeholder*="example.com"], input[placeholder*="11434"]').first().inputValue().catch(() => '');
  check('P5b the template pre-fills the openrouter.ai base URL', urlVal.includes('openrouter.ai'), urlVal);
  await shot(page, 'p5-preset-default');
  await app.close();
}

mock.kill();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
