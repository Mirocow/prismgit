import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-transport-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({ settings: { locale: 'ru', tourCompleted: true }, repositories: [], repoMetadata: {} }));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({ windowState: { bounds: { x: 0, y: 0, width: 800, height: 600 }, isMaximized: false, isFullScreen: false } }));
const app = await electron.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: ':99', PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' } });
const page = await app.firstWindow();
await page.waitForTimeout(2500);
const result = await page.evaluate(async () => {
  const out = {};
  // 1) direct renderer fetch
  try {
    const r = await fetch('http://127.0.0.1:43112/v1/models');
    out.rendererFetch = { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 80) };
  } catch (e) { out.rendererFetch = { error: String(e) }; }
  // 2) IPC proxy (ai:chat)
  try {
    const r2 = await window.smartgit.ai.chat({ url: 'http://127.0.0.1:43112/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'mock-gpt-mini', messages: [{ role: 'user', content: 'transport probe' }] }) });
    out.ipcChat = r2;
  } catch (e) { out.ipcChat = { error: String(e) }; }
  // 3) what does the preload expose as api.ai?
  out.apiAi = typeof window.smartgit?.ai;
  return out;
});
console.log(JSON.stringify(result, null, 2).slice(0, 1500));
await app.close();
