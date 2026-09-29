/** One-off probe: why space-y-8 computes to 0 margin in the running app. */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIG = '/home/z/my-project/work/perf-diag3/big20k';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-probe-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru' },
  repositories: [{ path: BIG, name: 'big20k', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1500, height: 950 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru' },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('button:has-text("big20k")').first().click();
await page.waitForTimeout(3000);
await page.evaluate(() => { window.location.hash = '#/settings'; });
await page.waitForTimeout(1800);

const diag = await page.evaluate(() => {
  const out = {};
  out.rootSpacing = getComputedStyle(document.documentElement).getPropertyValue('--spacing');
  const panel = document.querySelector('div.p-5.space-y-8');
  out.panelFound = !!panel;
  if (panel) {
    const row = panel.firstElementChild;
    const cs = getComputedStyle(row);
    out.rowMarginBottom = cs.marginBottom;
    out.rowMarginBlockEnd = cs.marginBlockEnd;
    out.rowPaddingProbe = getComputedStyle(panel).padding; // p-5 should be 20px-ish
    // Does the stylesheet rule match? try matches() on a synthetic check
    out.rowIsNotLast = !row.matches(':last-child');
    // A KNOWN-good space-y elsewhere: dialogs use space-y-6; probe a made-up element
    const probe = document.createElement('div');
    probe.className = 'space-y-8';
    probe.innerHTML = '<div>a</div><div>b</div>';
    document.body.appendChild(probe);
    out.syntheticMargin = getComputedStyle(probe.firstElementChild).marginBottom;
    probe.remove();
  }
  // padding check via p-5 on the panel itself
  // Enumerate every stylesheet rule mentioning space-y-8 with its context
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list, layer) => {
      for (const r of list) {
        if (r.cssRules) {
          walk(r.cssRules, layer + ' / ' + (r.conditionText ? `@media(${r.conditionText})` : r.cssText.split('{')[0].slice(0, 20)));
        }
        if (r.selectorText && r.selectorText.includes('space-y-8')) {
          hits.push({ sel: r.selectorText, css: r.cssText, layer });
        }
        // also find every rule that could set margins on a plain DIV row
        if (r.selectorText && /(^|[^-\w])(\*|div|:where\(\*\))/.test(r.selectorText) && r.cssText.includes('margin')) {
          hits.push({ sel: r.selectorText, css: r.cssText.slice(0, 200), layer, generic: true });
        }
      }
    };
    walk(rules, 'root');
  }
  out.sheetRules = hits;
  return out;
});
console.log(JSON.stringify(diag, null, 2));
await app.close().catch(() => {});
