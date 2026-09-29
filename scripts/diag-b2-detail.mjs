import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
const REPO = '/home/z/my-project/work/theme-probe-repo';
const SHOTS = '/home/z/my-project/work/ai-diag';
fs.mkdirSync(SHOTS, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-b2-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru',
    aiCommitMessagesEnabled: true, aiActiveProviderId: 'custom-mock',
    aiProvider: 'custom', aiUrl: 'http://127.0.0.1:43112/v1/chat/completions', aiModel: 'mock-gpt-mini',
    aiProviders: [{ id: 'custom-mock', name: 'Mock LLM', kind: 'custom', url: 'http://127.0.0.1:43112/v1/chat/completions', apiKey: '', model: 'mock-gpt-mini', enabled: true }] },
  repositories: [{ path: REPO, name: 'theme-probe-repo', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({ windowState: { bounds: { x: 0, y: 0, width: 1560, height: 960 }, isMaximized: false, isFullScreen: false } }, null, 2));
const app = await electron.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: ':99', PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' } });
const page = await app.firstWindow();
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.waitForTimeout(3000);
await page.locator('text=theme-probe-repo').first().click({ timeout: 6000 });
await page.waitForTimeout(2500);

// what did the app actually load as settings?
const loaded = await page.evaluate(() => {
  const s = (window).__prismSettingsProbe ?? null;
  return document.documentElement.getAttribute('data-theme');
});
console.log('html data-theme:', loaded);

await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2500);
const aiBtn = page.locator('button[title*="AI"]').first();
console.log('AI button count:', await aiBtn.count(), 'disabled:', await aiBtn.isDisabled().catch(() => 'n/a'));
await aiBtn.click();
await page.waitForTimeout(5000);
const editorVal = await page.locator('#commit-message-input').inputValue().catch(e => 'ERR ' + e.message);
console.log('editor value after AI click:', JSON.stringify(String(editorVal).slice(0, 200)));
const bodyText = await page.locator('body').innerText();
const toastish = bodyText.split('\n').filter(l => /сгенерир|ошибк|error|fail|провайдер|Failed|LLM/i.test(l)).slice(0, 6);
console.log('toast/error lines:', JSON.stringify(toastish));
await page.screenshot({ path: path.join(SHOTS, 'b2-detail.png') });
await app.close();
