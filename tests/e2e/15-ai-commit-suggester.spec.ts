/**
 * E2E: AI COMMIT-MESSAGE SUGGESTER against a mock Ollama server.
 *
 * Regression spec for the user-reported "AI подсказчик к коммитам не
 * работает": the provider registry stores the Ollama BASE url (no
 * /api/chat path). Before the fix, the request POSTed to the server root
 * → 404 → silent auto-suggest failure + "AI generation failed" on the
 * button + a 14s retry storm (404-"not found" was misread as
 * "model loading").
 *
 * The mock mimics REAL Ollama behavior:
 *   - POST /api/chat → 200 NDJSON (the endpoint the app must derive)
 *   - anything else  → 404 {"error":"path ... not found"} (incl. POST /)
 *   - CORS headers   → Ollama sends Access-Control-Allow-Origin: * by
 *     default, which the renderer's direct STREAMING fetch needs (the CSP
 *     now allows localhost and 127.0.0.1 on any port in connect-src).
 *
 * Covers both user-facing paths:
 *   1. AUTO-SUGGEST: stage files + empty message → 2s debounce → suggestion
 *      banner → click fills the textarea.
 *   2. MANUAL: the "Generate commit message with AI" button.
 * Plus the negative pin: no request may EVER hit the server root.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = process.cwd();

const hits: Array<{ method: string; url: string }> = [];
let server: http.Server;
let serverPort = 0;
let repoDir: string;
let userDataDir: string;
let app: ElectronApplication;
let page: Page;

const MOCK_MESSAGE = 'feat: e2e mock ollama message';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // ── Mock Ollama server (real Ollama semantics + CORS) ─────────────────
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ method: req.method || '?', url: req.url || '/' });
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (req.url === '/api/chat' && req.method === 'POST') {
        // Non-streaming JSON body — callOllama JSON.parse()s it directly;
        // a single NDJSON line is also valid JSON.
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', ...cors });
        res.end(JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: MOCK_MESSAGE }, done: true }) + '\n');
        return;
      }
      if (req.url === '/api/tags' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...cors });
        res.end(JSON.stringify({ models: [{ name: 'llama3.2' }] }));
        return;
      }
      // Everything else — like real Ollama: 404 path not found.
      res.writeHead(404, { 'Content-Type': 'application/json', ...cors });
      res.end(JSON.stringify({ error: `path '${req.url}' not found` }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  serverPort = (server.address() as { port: number }).port;

  // ── Repo with a STAGED modification (auto-suggest precondition) ───────
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ai-e2e-'));
  execSync('git init -q -b main && git config user.email t@t.t && git config user.name T', { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'feature.ts'), 'export const A = 1;\n');
  execSync('git add feature.ts && git commit -q -m init', { cwd: repoDir });
  fs.appendFileSync(path.join(repoDir, 'feature.ts'), 'export const B = 2;\n');
  execSync('git add feature.ts', { cwd: repoDir });

  // ── userData: Ollama provider stored with the PRESET BASE-URL shape ──
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ai-e2e-ud-'));
  fs.writeFileSync(
    path.join(userDataDir, 'prismgit-settings.json'),
    JSON.stringify({
      settings: {
        theme: 'light', tourCompleted: true,
        aiCommitMessagesEnabled: true,
        aiProviders: [{
          id: 'prov-mock-ollama', kind: 'ollama', name: 'Mock Ollama',
          url: `http://127.0.0.1:${serverPort}`, // BASE url — the real preset shape
          model: 'llama3.2', enabled: true, createdAt: Date.now(),
        }],
        aiActiveProviderId: 'prov-mock-ollama',
      },
      repositories: [{ path: repoDir, name: path.basename(repoDir), lastOpened: Date.now(), pinned: false }],
      repoMetadata: {},
    }, null, 2)
  );
  fs.writeFileSync(
    path.join(userDataDir, 'prismgit-window-state.json'),
    JSON.stringify({ windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false } })
  );

  // ── Launch ──────────────────────────────────────────────────────────────
  app = await electron.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      path.join(ROOT, 'dist-electron/main.js')],
    env: {
      ...process.env, NODE_ENV: 'production',
      DISPLAY: process.env.DISPLAY || ':99',
      PRISMGIT_USER_DATA: userDataDir,
      PRISMGIT_LOCALE: 'en',
    },
    timeout: 30000,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  const repoBtn = page.locator(`button:has-text("${path.basename(repoDir)}")`).first();
  if (await repoBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await repoBtn.click();
  }
  // Repo open + status fan-out + 2s auto-suggest debounce + generation.
  await page.waitForTimeout(7000);
});

test.afterAll(async () => {
  await app?.close().catch(() => { /* ignore */ });
  server?.close();
  if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('auto-suggest shows the AI banner for a staged change and fills the message on click', async () => {
  const banner = page.locator('[title="Click to use this AI-generated commit message"]');
  await expect(banner).toBeVisible({ timeout: 15000 });
  await banner.click();
  const value = await page.locator('textarea').first().inputValue();
  expect(value).toContain(MOCK_MESSAGE);
});

test('the "Generate commit message with AI" button streams a message into the textarea', async () => {
  // Clear the message so the button path runs from scratch.
  await page.locator('textarea').first().fill('');
  const aiBtn = page.locator('[title*="Generate commit message with AI"]').first();
  await expect(aiBtn).toBeVisible();
  await aiBtn.click();
  const textarea = page.locator('textarea').first();
  await expect
    .poll(async () => textarea.inputValue(), { timeout: 20000 })
    .toContain(MOCK_MESSAGE);
});

test('every AI request hit the derived /api/chat endpoint — never the server root', async () => {
  expect(hits.length).toBeGreaterThan(0);
  const chatHits = hits.filter((h) => h.url === '/api/chat' && h.method === 'POST');
  expect(chatHits.length).toBeGreaterThan(0);
  const rootHits = hits.filter((h) => h.url === '/' || h.url === '');
  expect(rootHits, `requests to the server root must never happen, got: ${JSON.stringify(hits)}`).toEqual([]);
});
