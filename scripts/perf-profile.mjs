/**
 * PrismGit UI performance profiler.
 *
 * Launches the built app against the heavy synthetic repo and measures REAL
 * input latency (Chromium Event Timing API: input dispatch -> processing ->
 * next paint) and main-thread long tasks for the interactions the user
 * reported as sluggish ("интерфейс тупит"):
 *
 *   S0  baseline idle                    — background churn should be ~zero
 *   S1  typing in the commit box        — the classic Changes-page keystroke storm
 *   S2  clicking file rows              — selection re-render cost
 *   S3  typing in the file filter
 *   S4  watcher storm + typing          — IDE auto-save simulation (touches tracked
 *                                          files every 400ms => watcher => git status)
 *   S5  page navigation (Changes/History/Branches)
 *   S6  History scrolling
 *   S7  repo open (wall clock)          — welcome-screen click -> Changes rendered
 *
 * Usage:  node scripts/perf-profile.mjs [--repo /tmp/prismgit-perf-repos/heavy-repo]
 */
import { _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const HEAVY_REPO = process.argv.includes('--repo')
  ? process.argv[process.argv.indexOf('--repo') + 1]
  : '/tmp/prismgit-perf-repos/heavy-repo';

const results = { meta: {}, scenarios: {} };

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
}
function summarize(nums) {
  return { n: nums.length, p50: pct(nums, 50), p95: pct(nums, 95), max: nums.length ? Math.max(...nums) : 0 };
}

const INSTRUMENT = () => {
  window.__stats = { events: [], longtasks: [] };
  window.__reset = () => { window.__stats.events = []; window.__stats.longtasks = []; };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'keydown' || e.name === 'input' || e.name === 'keyup' || e.name === 'click' || e.name === 'mousemove' || e.name === 'wheel') {
          window.__stats.events.push({
            name: e.name, t: Math.round(e.startTime), dur: Math.round(e.duration),
            procDelay: e.processingStart ? Math.round(e.processingStart - e.startTime) : 0,
          });
        }
      }
    }).observe({ type: 'event', durationThreshold: 16 });
  } catch { /* older chromium */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__stats.longtasks.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* noop */ }
};

async function collect(page, scenario, extra = {}) {
  const stats = await page.evaluate(() => ({
    events: window.__stats ? window.__stats.events : [],
    longtasks: window.__stats ? window.__stats.longtasks : [],
  }));
  const byType = {};
  for (const e of stats.events) (byType[e.name] ??= []).push(e.dur);
  const longDurs = stats.longtasks.map((l) => l.dur);
  results.scenarios[scenario] = {
    events: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, summarize(v)])),
    longtasks: { ...summarize(longDurs), totalMs: longDurs.reduce((a, b) => a + b, 0) },
    topLongtasks: stats.longtasks.sort((a, b) => b.dur - a.dur).slice(0, 5),
    ...extra,
  };
  await page.evaluate(() => window.__reset && window.__reset());
}

function report() {
  console.log('\n================ PERF REPORT ================');
  for (const [name, r] of Object.entries(results.scenarios)) {
    console.log(`\n── ${name} ──`);
    for (const [type, s] of Object.entries(r.events || {})) {
      console.log(`  events[${type}]: n=${s.n} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms`);
    }
    if (r.longtasks) console.log(`  longtasks: n=${r.longtasks.n} total=${r.longtasks.totalMs}ms max=${r.longtasks.max}ms`);
    for (const [k, v] of Object.entries(Object.keys(r).filter((k) => !['events', 'longtasks', 'topLongtasks'].includes(k)).reduce((o, k) => ({ ...o, [k]: r[k] }), {}))) {
      console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    if (r.topLongtasks?.length) console.log(`  top longtasks: ${r.topLongtasks.map((l) => `${l.dur}ms@${l.t}`).join(', ')}`);
  }
  fs.writeFileSync(path.join(process.cwd(), 'scripts', 'perf-results.json'), JSON.stringify(results, null, 2));
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-perf-'));
const repoName = path.basename(HEAVY_REPO);
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, maxHistoryLoad: 2000 },
  repositories: [{ path: HEAVY_REPO, name: repoName, lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const DEV = !!process.env.PRISMGIT_PERF_DEV;
const t0 = Date.now();
const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env,
    NODE_ENV: DEV ? 'development' : 'production',
    ...(DEV ? { VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173' } : {}),
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir,
    PRISMGIT_LOCALE: 'en',
  },
  timeout: 30000,
});
let page = await app.firstWindow();
// In dev, the app may open a DETACHED DevTools window first — find the
// actual app window (the one NOT pointing at devtools://).
{
  await page.waitForTimeout(300).catch(() => {});
  const wins = app.windows();
  if (wins.length > 1) {
    const appWin = wins.find((w) => !w.url().startsWith('devtools://'));
    if (appWin && appWin !== page) {
      results.meta.windows = wins.map((w) => w.url().slice(0, 60));
      page = appWin; // use the app window for all scenarios
    }
  }
}
await page.waitForLoadState('domcontentloaded');
results.meta.launchMs = Date.now() - t0;
await page.waitForTimeout(1500);

// Instrument AFTER load so observers catch everything from here on.
await page.evaluate(INSTRUMENT);

// ── S7 repo open (wall clock) ─────────────────────────────────────────────
{
  const btn = page.locator(`button:has-text("${repoName}")`).first();
  await btn.click();
  const start = Date.now();
  await page.locator('#commit-message-input').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500); // let repo-open fan-out settle
  results.scenarios['S7 repo open'] = { wallMs: Date.now() - start };
}

const commitBox = page.locator('#commit-message-input');
const rows = page.locator('[role="option"]');

// ── S0 baseline idle ──────────────────────────────────────────────────────
await page.evaluate(() => window.__reset && window.__reset());
await page.waitForTimeout(8000);
await collect(page, 'S0 idle 8s (baseline)');

// ── S1 typing in the commit box ───────────────────────────────────────────
await commitBox.click();
await page.evaluate(() => window.__reset && window.__reset());
const text = 'feat: type a reasonably long commit message here to simulate real typing behavior 123';
await commitBox.type(text, { delay: 100 });
await page.waitForTimeout(600);
await collect(page, 'S1 type commit message (61 keys)');
results.scenarios['S1 type commit message (61 keys)'].keysTyped = text.length;

// ── S2 clicking file rows ─────────────────────────────────────────────────
{
  const n = Math.min(12, await rows.count());
  await page.evaluate(() => window.__reset && window.__reset());
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(800);
  await collect(page, `S2 click file rows (${n})`);
}

// ── S3 typing in the file filter ─────────────────────────────────────────
{
  const filter = page.locator('input[placeholder="File Filter"]').first();
  if (await filter.isVisible({ timeout: 3000 }).catch(() => false)) {
    await filter.click();
    await page.evaluate(() => window.__reset && window.__reset());
    await filter.type('file1', { delay: 120 });
    await page.waitForTimeout(800);
    await collect(page, 'S3 type file filter (5 keys)');
    await filter.press('Escape').catch(() => {});
    await filter.fill('').catch(() => {});
  } else {
    results.scenarios['S3 type file filter (5 keys)'] = { skipped: 'filter input not found' };
  }
}

// ── S4 watcher storm + typing (IDE auto-save simulation) ─────────────────
{
  const touch = spawn('sh', ['-c',
    `i=0; while [ $i -lt 30 ]; do touch "${HEAVY_REPO}/src/a/file1.ts" "${HEAVY_REPO}/src/a/file2.ts" "${HEAVY_REPO}/src/a/file3.ts" "${HEAVY_REPO}/history.log"; i=$((i+1)); sleep 0.4; done`],
    { stdio: 'ignore', detached: true });
  touch.unref();
  await page.waitForTimeout(1500); // storm is running
  await commitBox.click();
  await commitBox.press('End').catch(() => {});
  await page.evaluate(() => window.__reset && window.__reset());
  await commitBox.type(' more text during storm abcdefghij', { delay: 100 });
  await page.waitForTimeout(600);
  await collect(page, 'S4 watcher-storm + typing (27 keys)');
  // and clicks during the storm
  await page.evaluate(() => window.__reset && window.__reset());
  const n = Math.min(6, await rows.count());
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await collect(page, 'S4b watcher-storm + row clicks (6)');
  await new Promise((r) => setTimeout(r, 13000)); // let storm finish
  await page.evaluate(() => window.__reset && window.__reset());
}

// ── S5 page navigation ────────────────────────────────────────────────────
async function nav(label, waitSel) {
  const el = page.locator(`aside [role="button"][aria-label="${label}"]`).first();
  if (!(await el.isVisible({ timeout: 3000 }).catch(() => false))) {
    // expand collapsed groups
    const headers = page.locator('aside button[role="heading"][title="Expand"]');
    const cnt = await headers.count().catch(() => 0);
    for (let i = 0; i < cnt; i++) await headers.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const start = Date.now();
  await el.click();
  if (waitSel) await page.locator(waitSel).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500); // settle data loads
  return Date.now() - start;
}
{
  await page.evaluate(() => window.__reset && window.__reset());
  const msH = await nav('History', 'text=commit');
  await collect(page, 'S5a nav Changes->History', { wallMs: msH });
  const msB = await nav('Branches', 'text=main');
  await collect(page, 'S5b nav History->Branches', { wallMs: msB });
  const msC = await nav('Changes', '#commit-message-input');
  await collect(page, 'S5c nav Branches->Changes', { wallMs: msC });
}

// ── S6 History scrolling ─────────────────────────────────────────────────
{
  await nav('History', 'text=commit');
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__reset && window.__reset());
  const main = page.locator('main').first();
  await main.hover();
  for (let i = 0; i < 20; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1000);
  await collect(page, 'S6 History scroll (20 wheels)');
}

report();
try { await app.close(); } catch { /* ignore */ }
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
