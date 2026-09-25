#!/usr/bin/env node
/**
 * CDP performance & memory profiler (Enterprise QA suite, Blocks 17/20 + Phase 7.3).
 *
 * Launches the BUILT app against the synthetic high-commit repo and measures
 * exactly what the QA spec demands for renderer robustness at scale:
 *
 *   - JSHeapUsedSize / JSHeapTotalSize via CDP `Performance.getMetrics`
 *     (launch flag --enable-precision-memory-info), budget: < 800 MB
 *   - DOM node count sampled DURING a scroll storm — virtual-scroll leak
 *     check (node count must stay bounded, not grow with scroll depth)
 *   - average FPS via a requestAnimationFrame counter during the storm
 *   - renderer long tasks during the storm
 *   - rapid page-switch churn (History/Branches/Changes) with LIVE `git`
 *     process accounting — the "zombie CLI" audit: every git child is
 *     attributed by walking the process tree to the app; lingering ones
 *     after settle are reported, survivors after quit are ORPHANS (fail)
 *   - quit wall-time (budget 3 s, same gate as verify-checkall-quit.mjs)
 *
 * Usage (needs built app + X display; Linux containers: DISPLAY=:99):
 *   node scripts/gen-perf-repos.mjs --type log
 *   DISPLAY=:99 node scripts/perf-cdp-metrics.mjs [options]
 *     --repo /tmp/prismgit-perf-repos/high-commit-repo
 *     --scrolls 40            scroll storm iterations (default 40)
 *     --strict                enforce budgets (default: report-only)
 *     --out scripts/perf-cdp-results.json
 */
import { _electron as electron } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const REPO = opt('repo', '/tmp/prismgit-perf-repos/high-commit-repo');
const SCROLLS = Number(opt('scrolls', '40'));
const STRICT = args.includes('--strict');
const OUT = opt('out', 'scripts/perf-cdp-results.json');

if (!fs.existsSync(path.join(REPO, '.git'))) {
  console.error(`repo not found: ${REPO} — run: node scripts/gen-perf-repos.mjs --type log`);
  process.exit(1);
}

const HEAP_BUDGET_MB = 800;      // spec: JSHeapUsedSize < 800 MB
const DOM_DELTA_BUDGET = 5000;   // virtual scroll: DOM must not grow with depth
const QUIT_BUDGET_MS = 3000;     // same as verify-checkall-quit.mjs
const FPS_STRICT_MIN = 25;       // lenient vs spec's 45 (headless/software rendering)

const results = { meta: { repo: REPO, scrolls: SCROLLS, strict: STRICT }, scroll: {}, churn: {}, quit: {} };

// ── process-tree accounting (Linux/macOS) ──────────────────────────────────
function psMap() {
  const map = new Map();
  if (process.platform === 'win32') return map;
  const out = spawnSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' });
  if (out.status !== 0) return map;
  for (const line of out.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return map;
}
/** Is `pid` a descendant of `rootPid` (or the root itself)? */
function isDescendant(map, pid, rootPid) {
  let cur = pid;
  for (let hop = 0; cur && hop < 16; hop++) {
    if (cur === rootPid) return true;
    const rec = map.get(cur);
    if (!rec) return false;
    cur = rec.ppid;
  }
  return false;
}
/** All live git processes attributable to the app process tree. */
function liveGitOf(appPid) {
  const map = psMap();
  const list = [];
  for (const [pid, p] of map) {
    if (!/(^|\/)git( |$)/.test(p.cmd || '')) continue;
    if (p.cmd.includes('gitPollWorker')) continue;
    if (isDescendant(map, pid, appPid)) list.push({ pid, cmd: (p.cmd.replace(/^.*?git /, 'git ').slice(0, 60)) });
  }
  return list;
}

// ── seed user data (same shape as perf-profile.mjs) ────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-cdp-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: false, // we drive interactions, not background polls
    repoRemoteCheckIntervalSec: 3600, maxHistoryLoad: 2000,
  },
  repositories: [{ path: REPO, name: path.basename(REPO), lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

// ── launch ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-precision-memory-info',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'en',
  },
  timeout: 30000,
});
let page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
results.meta.launchMs = Date.now() - t0;
await page.waitForTimeout(1500);
const appPid = app.process().pid;

// open the repo from the welcome screen
{
  const btn = page.locator(`button:has-text("${path.basename(REPO)}")`).first();
  await btn.click({ timeout: 15000 });
  await page.locator('#commit-message-input').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500);
}

// CDP session on the renderer page
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
async function metrics() {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const pick = (name) => Number(m.find((x) => x.name === name)?.value ?? 0);
  return {
    JSHeapUsedMB: +(pick('JSHeapUsedSize') / 1048576).toFixed(1),
    JSHeapTotalMB: +(pick('JSHeapTotalSize') / 1048576).toFixed(1),
    Nodes: pick('Nodes'),
    Documents: pick('Documents'),
    JSEventListeners: pick('JSEventListeners'),
    TaskDurationMs: Math.round(pick('TaskDuration')),
  };
}

async function nav(label) {
  const el = page.locator(`aside [role="button"][aria-label="${label}"]`).first();
  if (!(await el.isVisible({ timeout: 3000 }).catch(() => false))) {
    const headers = page.locator('aside button[role="heading"][title="Expand"]');
    const cnt = await headers.count().catch(() => 0);
    for (let i = 0; i < cnt; i++) await headers.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await el.click();
  await page.waitForTimeout(900);
}

// longtask observer
await page.evaluate(() => {
  (window).__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window).__longtasks.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* older Chromium */ }
});

// ── phase 1: History scroll storm (heap / DOM / FPS) ───────────────────────
await nav('History');
await page.waitForTimeout(3000); // first page of commits loaded
results.scroll.before = await metrics();
results.scroll.domBefore = await page.evaluate(() => document.querySelectorAll('*').length);

// rAF FPS counter
await page.evaluate(() => {
  window.__fps = { frames: 0, t0: 0, on: false };
  window.__fpsStart = () => {
    const f = window.__fps;
    f.frames = 0; f.t0 = performance.now(); f.on = true;
    const tick = () => { if (!f.on) return; f.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  window.__fpsStop = () => {
    const f = window.__fps;
    f.on = false;
    return { frames: f.frames, ms: Math.round(performance.now() - f.t0) };
  };
  window.__fpsStart();
});

const domSamples = [];
const main = page.locator('main').first();
await main.hover().catch(() => {});
const stormStart = Date.now();
for (let i = 0; i < SCROLLS; i++) {
  await page.mouse.wheel(0, 900);
  if (i % 5 === 4) {
    await page.keyboard.press('PageDown').catch(() => {});
    domSamples.push(await page.evaluate(() => document.querySelectorAll('*').length));
  }
  await page.waitForTimeout(40);
}
const stormMs = Date.now() - stormStart;
const fps = await page.evaluate(() => window.__fpsStop());
results.scroll = {
  ...results.scroll,
  stormMs,
  scrolls: SCROLLS,
  domSamples,
  domMax: domSamples.length ? Math.max(...domSamples) : 0,
  fpsAvg: +(fps.frames / Math.max(0.001, fps.ms / 1000)).toFixed(1),
  longtasks: await page.evaluate(() => (window).__longtasks || []),
  ...await metrics(),
};

// force GC then re-measure — the spec's "heap returns to baseline" criterion
try {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  results.scroll.afterGc = await metrics();
} catch { /* GC call unsupported — keep storm metrics as final */ }

results.scroll.domDelta = results.scroll.domMax - results.scroll.domBefore;
results.scroll.heapRetainedMB = +(results.scroll.afterGc?.JSHeapUsedMB ?? results.scroll.JSHeapUsedMB
  - results.scroll.before.JSHeapUsedMB).toFixed(1);

// ── phase 2: rapid page-switch churn + zombie accounting ──────────────────
// Each git child here is short-lived on fast local repos (status ~20 ms), so
// a single ps snapshot per switch would miss them — sample densely (every
// 150 ms for ~600 ms after each switch) instead.
const seenGitPids = new Set();
let peakLive = 0;
const seq = ['History', 'Branches', 'Changes', 'History', 'Tags', 'History', 'Branches', 'Changes'];
for (const label of seq) {
  await nav(label);
  for (let s = 0; s < 4; s++) {
    const live = liveGitOf(appPid);
    peakLive = Math.max(peakLive, live.length);
    for (const g of live) seenGitPids.add(g.pid);
    if (s < 3) await page.waitForTimeout(150);
  }
}
// settle: wait until the tree calms (2 consecutive clean-ish samples, cap 10 s)
let lingering = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  lingering = liveGitOf(appPid);
  if (lingering.length === 0) break;
}
for (const g of lingering) seenGitPids.add(g.pid);
results.churn = {
  switches: seq.length,
  peakLiveGit: peakLive,
  lingeringAfterSettleMs: lingering.length,
  lingering: lingering.map((g) => `${g.pid}: ${g.cmd}`),
};

// ── phase 3: quit + orphan check ───────────────────────────────────────────
const quitStart = Date.now();
await app.close();
results.quit.exitMs = Date.now() - quitStart;
await new Promise((r) => setTimeout(r, 700)); // give the OS time to reap
const orphans = [];
for (const pid of seenGitPids) {
  try { process.kill(pid, 0); orphans.push(pid); } catch { /* dead — good */ }
}
results.quit.orphans = orphans.length;
results.quit.orphanPids = orphans;
for (const pid of orphans) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }

// ── verdict ────────────────────────────────────────────────────────────────
const heapMax = results.scroll.JSHeapUsedMB;
const FAIL = [];
if (heapMax > HEAP_BUDGET_MB) FAIL.push(`JSHeapUsedSize ${heapMax} MB > ${HEAP_BUDGET_MB} MB budget`);
if (results.scroll.domDelta > DOM_DELTA_BUDGET) FAIL.push(`DOM grew by ${results.scroll.domDelta} nodes during scroll (virtual-scroll leak?)`);
if (results.quit.orphans > 0) FAIL.push(`${results.quit.orphans} orphaned git processes survived the quit`);
if (results.quit.exitMs > QUIT_BUDGET_MS) FAIL.push(`quit took ${results.quit.exitMs} ms > ${QUIT_BUDGET_MS} ms`);
if (STRICT && results.scroll.fpsAvg < FPS_STRICT_MIN) FAIL.push(`average FPS ${results.scroll.fpsAvg} < ${FPS_STRICT_MIN} during scroll storm`);
if (STRICT && results.churn.lingeringAfterSettleMs > 2) FAIL.push(`${results.churn.lingeringAfterSettleMs} git processes still running after churn settle`);
results.verdict = FAIL;

fs.writeFileSync(path.join(process.cwd(), OUT), JSON.stringify(results, null, 2));

console.log('\n================ CDP PERF & MEMORY REPORT ================');
console.log(`repo: ${REPO}  (launch ${results.meta.launchMs} ms)`);
console.log('\n── scroll storm (History) ──');
console.log(`  heap used:   before=${results.scroll.before.JSHeapUsedMB} MB  peak=${results.scroll.JSHeapUsedMB} MB  afterGC=${results.scroll.afterGc?.JSHeapUsedMB ?? 'n/a'} MB  (budget ${HEAP_BUDGET_MB} MB)`);
console.log(`  DOM nodes:   before=${results.scroll.domBefore}  max=${results.scroll.domMax}  delta=${results.scroll.domDelta}  (budget +${DOM_DELTA_BUDGET})`);
console.log(`  FPS:         avg=${results.scroll.fpsAvg} over ${(stormMs / 1000).toFixed(1)}s${STRICT ? ` (strict min ${FPS_STRICT_MIN})` : ' (informational)'}`);
console.log(`  longtasks:   n=${results.scroll.longtasks.length}${results.scroll.longtasks.length ? ' worst=' + Math.max(...results.scroll.longtasks) + 'ms' : ''}`);
console.log('\n── page-switch churn (zombie audit) ──');
console.log(`  switches=${results.churn.switches}  peak live git=${results.churn.peakLiveGit}  lingering after settle=${results.churn.lingeringAfterSettleMs}`);
if (results.churn.lingering.length) console.log(`  lingering: ${results.churn.lingering.join(' | ')}`);
console.log('\n── quit ──');
console.log(`  exit=${results.quit.exitMs} ms (budget ${QUIT_BUDGET_MS})  orphans=${results.quit.orphans}`);
console.log(`\nresults: ${OUT}`);
if (FAIL.length) { console.log(`\nFAIL: ${FAIL.join('; ')}`); process.exit(1); }
console.log('\nPASS: heap/DOM budgets respected, no orphaned git processes, quit within budget');
