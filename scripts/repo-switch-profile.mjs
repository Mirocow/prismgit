/**
 * Repo-switch freeze profiler.
 *
 * Reproduces the user report: "при переключении репозитория по прежнему
 * происходит зависание" — the UI hangs when clicking a different repo in
 * the sidebar, and (earlier report) the delay grows with every switch.
 *
 * Measures, per switch:
 *   - wallMs        click -> StatusBar shows the NEW repo's branch name
 *   - longtasks     renderer main-thread long tasks in the switch window
 *   - ipc rtt       p50/p95/max round-trip of a TRIVIAL IPC
 *                   (fs:pathBasename) — spikes = MAIN process blocked
 *   - events        input Event-Timing durations (click/keydown latency)
 *
 * Usage:
 *   bash scripts/make-switch-repos.sh
 *   node scripts/repo-switch-profile.mjs [--repos /tmp/prismgit-switch-repos]
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = process.argv.includes('--repos')
  ? process.argv[process.argv.indexOf('--repos') + 1]
  : '/tmp/prismgit-switch-repos';

const REPOS = [
  { dir: 'heavy-repo', name: 'heavy-repo', branch: 'main' },
  { dir: 'medium-repo', name: 'medium-repo', branch: 'develop' },
  { dir: 'small-repo', name: 'small-repo', branch: 'topic-light' },
];
for (const r of REPOS) {
  if (!fs.existsSync(path.join(ROOT, r.dir, '.git'))) {
    console.error(`missing ${ROOT}/${r.dir} — run: bash scripts/make-switch-repos.sh`);
    process.exit(1);
  }
}

const results = { meta: { root: ROOT, launches: [] }, switches: [], notes: [] };
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
}
function sum(a) { return a.reduce((x, y) => x + y, 0); }

// Renderer instrumentation: long tasks + input-event timing + IPC probe.
const INSTRUMENT = () => {
  window.__stats = { events: [], longtasks: [], ipc: [] };
  window.__reset = () => { window.__stats.events = []; window.__stats.longtasks = []; window.__stats.ipc = []; };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (['keydown', 'input', 'keyup', 'click', 'wheel'].includes(e.name)) {
          window.__stats.events.push({ name: e.name, t: Math.round(e.startTime), dur: Math.round(e.duration) });
        }
      }
    }).observe({ type: 'event', durationThreshold: 16 });
  } catch { /* older chromium */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__stats.longtasks.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* noop */ }
  // IPC probe — a trivial invoke every 40ms. RTT spikes reveal main-process
  // event-loop blockage (blocked main can't reply to ANY ipc until it frees).
  window.__probeOn = true;
  (async () => {
    while (window.__probeOn) {
      const t0 = performance.now();
      try { await window.smartgit.fs.pathBasename('/ipc-probe'); } catch { /* ignore */ }
      const rtt = Math.round(performance.now() - t0);
      if (window.__stats && window.__probeOn) window.__stats.ipc.push({ t: Math.round(t0), rtt });
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-switch-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: REPOS.map((r) => ({ path: path.join(ROOT, r.dir), name: r.name, lastOpened: Date.now(), pinned: false })),
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const t0 = Date.now();
const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir,
    PRISMGIT_LOCALE: 'ru',
    PRISMGIT_LOOP_LOG: '1',
  },
  timeout: 30000,
});

// Main-process event-loop block log ([loop <epochMs> +<lag>ms]) — correlated
// with each switch window below to attribute main-loop blockage.
const loopBlocks = [];
{
  const stdout = app.process()?.stdout;
  if (stdout) {
    stdout.setEncoding('utf8');
    let buf = '';
    stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        const m = line.match(/^\[loop (\d+)\] \+(\d+)ms block on main$/);
        if (m) loopBlocks.push({ t: Number(m[1]), lag: Number(m[2]) });
      }
    });
  }
}
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
results.meta.launchMs = Date.now() - t0;
await page.waitForTimeout(2000);
await page.evaluate(INSTRUMENT);

/** Is the repo UI ready? StatusBar footer contains the branch chip. */
const branchShown = (branch) => page.evaluate((b) => {
  const foot = document.querySelector('footer');
  return !!foot && foot.textContent.includes(b);
}, branch);

async function waitForBranch(branch, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await branchShown(branch)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function clickRepo(name) {
  await page.locator(`[data-testid="repo-item-${name}"]`).first().click({ timeout: 10000 });
}

async function snapshotStats() {
  return page.evaluate(() => ({
    events: window.__stats.events, longtasks: window.__stats.longtasks, ipc: window.__stats.ipc,
  }));
}

function sliceWindow(samples, t0Ms, t1Ms) {
  // page clock vs node clock differ — caller passes page-relative times.
  return samples.filter((s) => s.t >= t0Ms && s.t <= t1Ms);
}

async function doSwitch(from, to, label) {
  await page.evaluate(() => window.__reset && window.__reset());
  const pageT0 = await page.evaluate(() => Math.round(performance.now()));
  const wallT0 = Date.now();
  await clickRepo(to.name);
  const ok = await waitForBranch(to.branch);
  const wallMs = Date.now() - wallT0;
  await page.waitForTimeout(1200); // trailing fan-out window
  const pageT1 = await page.evaluate(() => Math.round(performance.now()));
  const stats = await snapshotStats();

  const longs = sliceWindow(stats.longtasks, pageT0, pageT1);
  const ipcs = sliceWindow(stats.ipc, pageT0, pageT1).map((i) => i.rtt);
  const evs = sliceWindow(stats.events, pageT0, pageT1);
  const byType = {};
  for (const e of evs) (byType[e.name] ??= []).push(e.dur);

  const entry = {
    label,
    ok,
    wallMs,
    longtasks: { n: longs.length, totalMs: sum(longs.map((l) => l.dur)), max: longs.length ? Math.max(...longs.map((l) => l.dur)) : 0,
      top: longs.sort((a, b) => b.dur - a.dur).slice(0, 4).map((l) => `${l.dur}ms@+${l.t - pageT0}`) },
    ipcRtt: { n: ipcs.length, p50: pct(ipcs, 50), p95: pct(ipcs, 95), max: ipcs.length ? Math.max(...ipcs) : 0 },
    events: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { n: v.length, p95: pct(v, 95), max: Math.max(...v) }])),
  };
  // Main-loop blocks inside the switch window (epoch ms from the loop log).
  const blocks = loopBlocks.filter((b) => b.t >= wallT0 - 150 && b.t <= wallT0 + wallMs + 1200);
  entry.mainBlocks = { n: blocks.length, totalMs: sum(blocks.map((b) => b.lag)),
    top: blocks.sort((a, b) => b.lag - a.lag).slice(0, 5).map((b) => `+${b.lag}ms@+${b.t - wallT0}`) };
  results.switches.push(entry);
  console.log(`\n── ${label} (${from} → ${to.name}) ${ok ? '' : 'TIMEOUT!'}`);
  console.log(`  wall click→branch: ${entry.wallMs}ms`);
  console.log(`  renderer longtasks: n=${entry.longtasks.n} total=${entry.longtasks.totalMs}ms max=${entry.longtasks.max}ms${entry.longtasks.top.length ? ' [' + entry.longtasks.top.join(', ') + ']' : ''}`);
  console.log(`  IPC rtt (main responsiveness): n=${entry.ipcRtt.n} p50=${entry.ipcRtt.p50}ms p95=${entry.ipcRtt.p95}ms max=${entry.ipcRtt.max}ms`);
  console.log(`  main-loop blocks: n=${entry.mainBlocks.n} total=${entry.mainBlocks.totalMs}ms${entry.mainBlocks.top.length ? ' [' + entry.mainBlocks.top.join(', ') + ']' : ''}`);
  if (Object.keys(entry.events).length) console.log(`  input events: ${JSON.stringify(entry.events)}`);
}

// ── Initial open (welcome screen → heavy-repo) ─────────────────────────────
{
  await page.evaluate(() => window.__reset && window.__reset());
  const wallT0 = Date.now();
  await page.locator('button:has-text("heavy-repo")').first().click({ timeout: 10000 }).catch(async () => {
    await clickRepo('heavy-repo'); // welcome list may not be a <button>
  });
  const ok = await waitForBranch('main');
  const wallMs = Date.now() - wallT0;
  results.meta.initialOpenMs = wallMs;
  console.log(`initial open heavy-repo: ${wallMs}ms ${ok ? '' : 'TIMEOUT!'}`);
  await page.waitForTimeout(4000); // let repo-open fan-out + first poll settle
}

// ── Switch rounds — reproduces A→B→A growth pattern ───────────────────────
const [heavy, medium, small] = REPOS;
await doSwitch(heavy, medium, 'switch-1');
await doSwitch(medium, heavy, 'switch-2');
await doSwitch(heavy, medium, 'switch-3');
await doSwitch(medium, heavy, 'switch-4');
await doSwitch(heavy, small, 'switch-5');
await doSwitch(small, heavy, 'switch-6');

// ── Interactivity DURING a switch: type into the commit box right after
// clicking — if the renderer is blocked, keydown events queue up and the
// event durations spike.
{
  await page.evaluate(() => window.__reset && window.__reset());
  await clickRepo(medium.name);
  const box = page.locator('#commit-message-input');
  const t0 = Date.now();
  await box.type('typing during switch to measure responsiveness', { delay: 30 }).catch(() => {});
  const typeMs = Date.now() - t0;
  const stats = await snapshotStats();
  const evs = stats.events.filter((e) => e.name === 'keydown');
  results.meta.duringSwitchTyping = {
    totalTypeMs: typeMs,
    keydown: { n: evs.length, p95: pct(evs.map((e) => e.dur), 95), max: evs.length ? Math.max(...evs.map((e) => e.dur)) : 0 },
    longtasks: { n: stats.longtasks.length, max: stats.longtasks.length ? Math.max(...stats.longtasks.map((l) => l.dur)) : 0 },
  };
  console.log(`\ntype-during-switch: total=${typeMs}ms keydown p95=${results.meta.duringSwitchTyping.keydown.p95}ms max=${results.meta.duringSwitchTyping.keydown.max}ms`);
}

// ── FUNCTIONAL: watcher chain regression (worker watch -> main -> renderer) ─
// Edit a tracked file OUTSIDE the app (Node fs) and verify the sidebar/Changes
// auto-refresh picks it up within the watcher debounce + status window (≤10s).
{
  await clickRepo(heavy.name);
  await waitForBranch('main');
  await page.waitForTimeout(3500); // watcher fully armed (deferred start 1s + scan)
  const before = await page.evaluate(() => {
    const foot = document.querySelector('footer');
    return foot ? foot.textContent : '';
  });
  const probeFile = path.join(ROOT, 'heavy-repo', `watcher-probe-${Date.now()}.ts`);
  // NEW untracked file: the changed-files counter (footer "N changed")
  // moves 61 -> 62 — a guaranteed visible delta (appending to an already
  // modified file leaves the status content-equal and nothing re-renders).
  fs.writeFileSync(probeFile, 'export const probe = 1;\n');
  const t0 = Date.now();
  let pickedUp = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // The StatusBar "N files" counter or the Changes list must CHANGE.
    const after = await page.evaluate(() => {
      const foot = document.querySelector('footer');
      return foot ? foot.textContent : '';
    });
    if (after !== before) { pickedUp = true; break; }
    await page.waitForTimeout(250);
  }
  const tookMs = Date.now() - t0;
  results.meta.watcherChain = { pickedUp, tookMs };
  console.log(`watcher-chain (external edit -> auto-refresh): ${pickedUp ? `OK in ${tookMs}ms` : 'FAILED (no refresh within 15s!)'}`);
}

fs.writeFileSync(path.join(process.cwd(), 'scripts', 'repo-switch-results.json'), JSON.stringify(results, null, 2));
console.log('\nresults → scripts/repo-switch-results.json');
await app.close().catch(() => {});
process.exit(0);
