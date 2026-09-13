/**
 * Render the About window HTML (electron/aboutInfo.ts) to a PNG preview.
 * Usage: node scripts/preview-about.mjs  →  tests/e2e/screenshots/about-preview.png
 */
import { chromium } from 'playwright-core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Use an explicitly installed chromium build (matches the ms-playwright cache)
const candidates = [
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1234/chrome-linux/chrome'),
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1200/chrome-linux64/chrome'),
  path.join(os.homedir(), '.cache/ms-playwright/chromium-1200/chrome-linux/chrome'),
];
const driver = candidates.find((p) => fs.existsSync(p));
if (!driver) {
  console.error('No chromium build found in', candidates);
  process.exit(1);
}

// Compile the TS module on the fly with esbuild (installed with vite)
const esbuild = (await import('esbuild')).buildSync;
esbuild({
  entryPoints: ['electron/aboutInfo.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'node_modules/.cache/aboutInfo.mjs',
  platform: 'node',
});
const { buildAboutHtml } = await import('../node_modules/.cache/aboutInfo.mjs');

const info = {
  name: 'PrismGit',
  version: '2.0.0',
  buildDate: new Date().toISOString(),
  electron: '32.3.3',
  chrome: '128.0.6613.186',
  node: '20.18.1',
  v8: '12.4.254.20',
  osType: 'Darwin',
  osRelease: '23.6.0',
  platform: 'darwin',
  arch: 'arm64',
  locale: 'en-US',
  firstLaunch: '2026-08-01T12:00:00.000Z',
  repositoryUrl: 'http://178.140.10.58:8082/web/git/gitclient',
  license: 'MIT',
};
const logo = fs.readFileSync('build/logo-256.png').toString('base64');
const html = buildAboutHtml(info, { logoSrc: `data:image/png;base64,${logo}` });

const browser = await chromium.launch({ executablePath: driver, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 540, height: 800 } });
await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
await page.waitForTimeout(300);
fs.mkdirSync('tests/e2e/screenshots', { recursive: true });
await page.screenshot({ path: 'tests/e2e/screenshots/about-preview.png' });
await browser.close();
console.log('OK: tests/e2e/screenshots/about-preview.png');
