/**
 * Probe: is the 3-way merge tool's MIDDLE pane (Result) actually editable?
 *
 * User report: «В 3-way инструменте средняя панель недоступна для
 * редактирования - а должна быть».
 *
 * Fixture: real modify/modify conflict; open the resolver via the same path
 * a user takes (Changes → conflicted file row → 3-way in the Diff tool);
 * then FOCUS the middle textarea, TYPE, and assert the value changed, the
 * dirty indicator lit up, and Save persists the typed text to disk.
 *
 * Usage: DISPLAY=:99 node scripts/probe-3way-editable.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/probe-3way';
const REPO = path.join(ROOT, 'repo');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
};

const sh = (cmd, cwd = REPO) =>
  execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
/** Conflicting ops exit 1 — that's the point. */
const shOk = (cmd, cwd = REPO) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { return String(e.stdout ?? ''); }
};

// ── Fixture: modify/modify conflict — small file for typing + TALL file
// (300 lines) for the shared-scroll check ────────────────────────────────────
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
sh('git init -q -b main');
sh('git config user.email e2e@prismgit.test && git config user.name E2E');
fs.writeFileSync(path.join(REPO, 'shared.txt'), 'line1\nline2\nline3\nline4\n');
fs.writeFileSync(path.join(REPO, 'tall.txt'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
sh('git add -A && git commit -q -m seed');
sh('git checkout -q -b side');
fs.writeFileSync(path.join(REPO, 'shared.txt'), 'line1\nTHEIRS-EDIT\nline3\nline4\n');
fs.writeFileSync(path.join(REPO, 'tall.txt'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n') + '\nTHEIRS-TAIL\n');
sh('git add -A && git commit -q -m theirs');
sh('git checkout -q main');
fs.writeFileSync(path.join(REPO, 'shared.txt'), 'line1\nOURS-EDIT\nline3\nline4\n');
fs.writeFileSync(path.join(REPO, 'tall.txt'), Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n') + '\nOURS-TAIL\n');
sh('git add -A && git commit -q -m ours');
shOk('git merge side'); // → CONFLICT in shared.txt + tall.txt (exit 1 — expected)
console.log('fixture ready (merge conflicts on shared.txt + 300-line tall.txt)');

// ── Launch the app (RU, dark) ───────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-3way-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'dark', tourCompleted: true, autoRefresh: true, locale: 'ru' },
  repositories: [{ path: REPO, name: 'repo', lastOpened: Date.now(), pinned: false }],
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
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2500);
await page.locator('button:has-text("repo")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-repo"]').first().click();
});
await page.waitForTimeout(3000);

// ── Open the 3-way resolver: Changes → DOUBLE-click the conflicted row ──────
// (Single click only SELECTS; the resolver opens on dblclick via the
// 'smartgit:resolve-conflict' event — App.tsx ConflictRedirect → #/diff.)
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(2000);
const row = page.locator('text=shared.txt').first();
await row.dblclick();
await page.waitForTimeout(3000);

// Where did we land? The resolver is embedded in the Diff tool.
console.log('hash after row click:', await page.evaluate(() => window.location.hash));

// ── The middle pane textarea ────────────────────────────────────────────────
const ta = page.locator('[data-testid="merge-result-textarea"]');
const taCount = await ta.count();
check('middle-pane textarea present in the DOM', taCount > 0, `count=${taCount}`);

if (taCount > 0) {
  const before = await ta.inputValue();
  console.log('middle pane initial length:', before.length, '| has markers:', /&lt;&lt;&lt;&lt;&lt;&lt;&lt;|<<<<<<< /.test(before) || before.includes('<<<<<<<'));

  // ROOT-CAUSE probe: does the VISIBLE layer (<pre> behind the transparent
  // textarea) re-render while typing? If not — the user types blind: the
  // value changes but nothing visible changes → "panel not editable".
  const pre = page.locator('pre[aria-hidden="true"]').first();
  const preBefore = await pre.innerText();
  await ta.click();
  await page.keyboard.press('Control+Home').catch(() => page.keyboard.press('Home'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('EDITED-BY-PROBE ');
  await page.waitForTimeout(1200); // give any debounced re-render time
  const preAfter = await pre.innerText();
  const valueAfter = await ta.inputValue();
  check('VISIBLE layer updated after typing (pre innerText changed)', preAfter !== preBefore,
    `pre: ${preBefore.length}ch → ${preAfter.length}ch`);
  check('VISIBLE layer contains the typed text', preAfter.includes('EDITED-BY-PROBE'));
  // (pre innerText includes the gutter numbers — a strict equality against
  // the raw textarea value is not meaningful; the "contains typed text"
  // check above is the real assertion.)

  // Is it DISABLED / readOnly at the DOM level?
  const ro = await ta.evaluate((el) => el.readOnly || el.disabled);
  check('textarea NOT readOnly/disabled', !ro, `readOnly||disabled=${ro}`);

  // Try REAL typing: click + keyboard.
  await ta.click();
  await page.keyboard.press('Control+Home').catch(() => page.keyboard.press('Home'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('EDITED-BY-PROBE ');
  await page.waitForTimeout(600);

  const after = await ta.inputValue();
  check('typing CHANGED the middle pane value', after !== before,
    `before=${before.length}ch after=${after.length}ch`);
  check('typed marker visible in value', after.includes('EDITED-BY-PROBE'));

  // Dirty indicator should light (status bar '●').
  const dirtyVisible = await page.locator('text=/^●/').count();
  check('dirty indicator lit after edit', dirtyVisible > 0);

  // Save via Ctrl+Enter and verify the file on disk got the typed text.
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(2500);
  const onDisk = fs.readFileSync(path.join(REPO, 'shared.txt'), 'utf8');
  check('typed text PERSISTED to the working tree after save', onDisk.includes('EDITED-BY-PROBE'),
    `disk bytes=${onDisk.length}`);
  // (pre innerText includes the gutter numbers — a strict equality against
  // the raw textarea value is not meaningful; the "contains typed text"
  // check above is the real assertion.)
  const staged = sh('git diff --cached --name-only');
  check('resolved file STAGED after save', staged.includes('shared.txt'), staged.trim());
}

await page.screenshot({ path: '/home/z/my-project/work/3way-middle-probe.png' });
console.log('screenshot: /home/z/my-project/work/3way-middle-probe.png');

// DOM-forensics for anything OVERLAYING the textarea (pointer-events thief).
if (taCount > 0) {
  const forensic = await ta.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = Math.min(r.top + 40, r.bottom - 2);
    const stack = document.elementsFromPoint(cx, cy).map((n) => {
      const e = n;
      return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${String(e.className || '').slice(0, 40)}`;
    });
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hitStack: stack.slice(0, 6) };
  });
  console.log('hit-test stack over the middle of the textarea:', JSON.stringify(forensic, null, 2));
  check('textarea IS in the hit-test stack (clickable)', forensic.hitStack.some((s) => s.startsWith('textarea')));
}

// ═══ TALL FILE: shared scrolling (side panes must follow the middle) ════════
console.log('\n── S2. 300-line file: shared scrolling ──');
await page.evaluate(() => { window.location.hash = '#/changes'; });
await page.waitForTimeout(1500);
const tallRow = page.locator('text=tall.txt').first();
await tallRow.dblclick();
await page.waitForTimeout(3000);

const scroller = page.locator('[data-testid="merge-scroll-container"]');
const scrollerOk = await scroller.count();
check('shared scroll container present', scrollerOk > 0, `count=${scrollerOk}`);
if (scrollerOk > 0) {
  const before = await scroller.evaluate((el) => ({ scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  check('container HAS scrollable content (scrollHeight > clientHeight)',
    before.scrollHeight > before.clientHeight, `scrollHeight=${before.scrollHeight} clientHeight=${before.clientHeight}`);

  // NATIVE user-path scrolling first: real mouse wheel over the scroller.
  const box = await scroller.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1000);
  }
  let nativeAfter = await scroller.evaluate((el) => el.scrollTop);
  console.log('after native wheel: scrollTop =', nativeAfter);
  if (nativeAfter < 4000) {
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(1000);
    nativeAfter = await scroller.evaluate((el) => el.scrollTop);
    console.log('after second wheel: scrollTop =', nativeAfter);
  }
  const after = nativeAfter;
  check('container scrollTop actually moved (was frozen at 0 in v2)', after >= 4000, `scrollTop=${after}`);

  // The side panes must RE-WINDOW: their rows should now sit at top near
  // scrollTop (rows around the current scroll position, not at 0).
  const paneWindow = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="merge-pane-ours"]');
    if (!el || !el.firstElementChild) return null;
    const tops = [...el.children].map((c) => parseFloat(c.style.top) || 0);
    const lineNums = (el.textContent || '').match(/\d+/g) || [];
    return { firstTop: tops[0], lastTop: tops[tops.length - 1], firstLine: parseInt(lineNums[0] || '0', 10), scrollerTop: document.querySelector('[data-testid="merge-scroll-container"]').scrollTop };
  });
  console.log('ours pane window:', JSON.stringify(paneWindow));
  check('side pane RE-WINDOWED to the scroll position (rows moved from top=0)',
    !!paneWindow && paneWindow.firstTop > 1000 && paneWindow.firstTop >= paneWindow.scrollerTop - 500,
    JSON.stringify(paneWindow));

  // The middle pane's PRE (highlight layer) must show the same window —
  // target the PRE specifically (the textarea's textContent would false-
  // positive because it carries the FULL file text).
  const midPreWindow = await page.evaluate(() => {
    const col = document.querySelector('[data-testid="merge-result-column"]');
    const pre = col ? col.querySelector('pre[aria-hidden="true"]') : null;
    if (!pre) return null;
    const lineNums = (pre.textContent || '').match(/\d+/g) || [];
    return { firstLine: parseInt(lineNums[0] || '0', 10), lastLine: parseInt(lineNums[lineNums.length - 1] || '0', 10) };
  });
  console.log('middle pre window:', JSON.stringify(midPreWindow));
  check('middle highlight layer shows the scrolled window (deep lines)',
    !!midPreWindow && midPreWindow.firstLine > 100,
    JSON.stringify(midPreWindow));
  check('all 3 panes show the SAME window (ours firstLine ~ middle firstLine)',
    !!paneWindow && !!midPreWindow && Math.abs(paneWindow.firstLine - midPreWindow.firstLine) <= 12,
    `ours=${paneWindow?.firstLine} mid=${midPreWindow?.firstLine}`);

  await page.screenshot({ path: '/home/z/my-project/work/3way-tall-scrolled.png' });
  console.log('screenshot: /home/z/my-project/work/3way-tall-scrolled.png');
}

await app.close();
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED — middle pane IS editable' : `\n${failures} CHECK(S) FAILED — real bug confirmed`);
process.exit(failures === 0 ? 0 : 1);
