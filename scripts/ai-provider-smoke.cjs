/**
 * E2E: AI commit-message mechanism + provider switching.
 *
 * Verifies:
 *  1. A local mock OpenAI-compatible server receives a well-formed request
 *     (Bearer key, model, prompt with the diff) through the REAL pipeline
 *     renderer → IPC → main → HTTP, and the message lands back in the UI.
 *  2. Switching provider in Settings → AI UPDATES the URL / model / key
 *     inputs (the stale-uncontrolled-input bug) — provider switch no longer
 *     appears broken.
 *  3. Edits to URL/key are mirrored into aiProviderConfigs (switch away and
 *     back keeps them).
 *  4. No plaintext API key lands in the settings JSON (vault active).
 */
const { _electron: electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const USER_DATA = '/tmp/prismgit-ai-smoke';
const APP = '/home/z/my-project/gitclient';
const MOCK_PORT = 9938;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-small' }, { id: 'mock-large' }] }));
      return;
    }
    // /chat/completions
    server.lastRequest = { auth: req.headers.authorization || '', body };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'feat: mock generated commit message' } }],
    }));
  });
});

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

  await new Promise((r) => server.listen(MOCK_PORT, r));

  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });

  const app = await electron.launch({
    args: [APP, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, PRISMGIT_USER_DATA: USER_DATA },
    cwd: APP,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  try {
    // ── 1. End-to-end generation through the real IPC pipeline ──
    await win.evaluate(([url]) => window.smartgit.settings.set('aiApiKey', 'mock-secret-key'), [MOCK_URL]);
    const msg = await win.evaluate(async ([url]) => {
      const cfg = { url, apiKey: 'mock-secret-key', model: 'mock-1', maxDiffSize: 131072 };
      return window.smartgit.ai.generateCommitMessage(cfg, 'diff --git a/x b/x\n+hello world', undefined);
    }, [MOCK_URL]);
    check('generation returns mock message', msg === 'feat: mock generated commit message', String(msg));
    const sent = server.lastRequest || {};
    check('request has Bearer key', sent.auth === 'Bearer mock-secret-key', sent.auth);
    const sentBody = JSON.parse(sent.body || '{}');
    check(
      'request carries model + diff',
      sentBody.model === 'mock-1' && (sentBody.messages?.[0]?.content || '').includes('Git diff:') && (sentBody.messages?.[0]?.content || '').includes('+hello world'),
      `model=${JSON.stringify(sentBody.model)} hasDiff=${(sentBody.messages?.[0]?.content || '').includes('Git diff:')}`
    );

    // ── 2. Provider switching UPDATES the connection inputs ──
    // Open Settings via the sidebar, then the AI tab
    await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((x) => x.textContent?.trim() === 'Settings');
      if (!b) throw new Error('sidebar Settings button not found');
      b.click();
    });
    await win.waitForTimeout(500);
    await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const b = btns.find((x) => x.textContent?.trim() === 'AI');
      if (!b) throw new Error('AI tab button not found');
      b.click();
    });
    await win.waitForTimeout(300);
    // Select provider "Cerebras" in the Provider select
    await win.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const sel = selects.find((s) => Array.from(s.options).some((o) => o.textContent?.includes('Cerebras')));
      if (!sel) throw new Error('provider select not found');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, 'cerebras');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await win.waitForTimeout(800); // switch handler does 5 sequential/parallel setSetting calls

    const afterSwitch = await win.evaluate(() => ({
      provider: window.smartgit.settings.get ? null : null,
      urlInput: (document.querySelector('input[placeholder="https://api.openai.com/v1/chat/completions"]') || {}).value,
      modelInput: (document.querySelector('input[placeholder="gpt-4o-mini"]') || {}).value,
    }));
    check('URL input updated after switch', afterSwitch.urlInput === 'https://api.cerebras.ai/v1/chat/completions', afterSwitch.urlInput);
    check('Model input updated after switch', afterSwitch.modelInput === 'llama3.1-8b', afterSwitch.modelInput);

    // Store state is the source of truth for generation
    const storeUrl = await win.evaluate(() => window.smartgit.settings.getAll().then((s) => s.aiUrl));
    check('store aiUrl = cerebras', storeUrl === 'https://api.cerebras.ai/v1/chat/completions', String(storeUrl));

    // ── 3. Edit URL + key are mirrored into aiProviderConfigs.cerebras ──
    const urlInput = win.locator('input[placeholder="https://api.openai.com/v1/chat/completions"]');
    await urlInput.fill(`http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`);
    await urlInput.blur();
    await win.waitForTimeout(400);
    // Type the API key for THIS provider, then blur — vault + mirror
    const keyInput = win.locator('input[placeholder="sk-..."]');
    await keyInput.fill('mock-secret-key');
    await keyInput.blur();
    await win.waitForTimeout(600);
    const cfgs = await win.evaluate(() => window.smartgit.settings.getAll().then((s) => s.aiProviderConfigs));
    check('edits mirrored into provider config', cfgs?.cerebras?.url === MOCK_URL && cfgs?.cerebras?.apiKey === 'mock-secret-key', JSON.stringify(cfgs?.cerebras));
    const flatKey = await win.evaluate(() => window.smartgit.settings.getAll().then((s) => s.aiApiKey));
    check('flat key restored', flatKey === 'mock-secret-key', String(flatKey));

    // ── 4. No plaintext key in settings JSON (vault active) ──
    await new Promise((r) => setTimeout(r, 400));
    const settingsRaw = fs.readFileSync(path.join(USER_DATA, 'prismgit-settings.json'), 'utf8');
    check('settings JSON free of api key', !settingsRaw.includes('mock-secret-key'));
    const vaultRaw = fs.readFileSync(path.join(USER_DATA, 'prismgit-secrets.json'), 'utf8');
    check('vault holds the api key', vaultRaw.includes('mock-secret-key'));

    // ── 5. Generation with the configured provider values (mock URL stored) ──
    const msg2 = await win.evaluate(async ([url]) => {
      const s = await window.smartgit.settings.getAll();
      const cfg = { url: s.aiUrl || url, apiKey: s.aiApiKey, model: s.aiModel, maxDiffSize: 131072 };
      return window.smartgit.ai.generateCommitMessage(cfg, 'diff --git a/y b/y\n+second change', undefined);
    }, [MOCK_URL]);
    check('generation via stored settings', msg2 === 'feat: mock generated commit message', String(msg2));
  } catch (e) {
    check('unexpected exception', false, String(e).split('\n')[0]);
  } finally {
    await app.close();
    server.close();
  }

  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
