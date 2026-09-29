/**
 * PERF DIAGNOSIS HARNESS — qualitative measurement of background load.
 *
 * User report: «Приложение стало неимоверно тупить на всех инструментах,
 * как будто что-то работает в фоне и мешает основному процессу».
 *
 * This script MEASURES instead of guessing:
 *   - /proc jiffie-delta CPU sampling (250ms) for the WHOLE Electron process
 *     tree (+ any git process touching the fixture), so we see exactly which
 *     process (main / renderer / gpu / poll-worker / git child) burns CPU.
 *   - Main-process event-loop lag (500ms heartbeat drift, p50/p95/max).
 *   - Renderer: PerformanceObserver 'longtask' entries + rAF frame-gap
 *     jitter + a 2s ping round-trip (proxy for UI responsiveness).
 *   - The app's own git command log (command-log:list — every main-process
 *     git spawn with duration), sliced per scenario window.
 *
 * Scenario timeline (idle windows, no user interaction inside them):
 *   W1 changes 90s → W2 history 45s → W3 search 25s → W4 blame 25s
 *   → W5 pulls 25s → W6 external mutation 45s → W7 changes 90s.
 *
 * Fixture: 3 repos — big (661 commits, current, local bare remote, background
 * fetch ON), dead (remote = TEST-NET-1 black hole, favorite, fetch ON),
 * fast (tiny, favorite, local bare remote, fetch ON). This reproduces both
 * the user's reachable-remote fetch and the dead/slow remote case.
 *
 * Usage: xvfb must be on :99.  DISPLAY=:99 node scripts/diagnose-perf.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/perf-diag';
const BIG = path.join(ROOT, 'big');
const DEAD = path.join(ROOT, 'dead');
const FAST = path.join(ROOT, 'fast');
const BARE = path.join(ROOT, 'bare-remote.git');
const OUT = path.join(ROOT, 'report.json');
fs.mkdirSync(ROOT, { recursive: true });

const CLK_TCK = Number(execSync('getconf CLK_TCK').toString().trim()) || 100;
const sh = (cmd, cwd) =>
  execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

// ── 1. Fixture ─────────────────────────────────────────────────────────────
console.log('── fixture ──');
fs.rmSync(path.join(ROOT, 'big'), { recursive: true, force: true });
fs.rmSync(path.join(ROOT, 'dead'), { recursive: true, force: true });
fs.rmSync(path.join(ROOT, 'fast'), { recursive: true, force: true });
fs.rmSync(BARE, { recursive: true, force: true });
execSync(`git clone -q --no-hardlinks /home/z/my-project/work/gitclient "${BIG}"`, { shell: '/bin/bash' });
sh(`git remote set-url origin "${BARE}"`, BIG);
execSync(`git init -q --bare "${BARE}"`, { shell: '/bin/bash' });
sh('git push -q origin HEAD:refs/heads/main', BIG);
sh(`git remote set-url origin "${BARE}"`, BIG);
// fresh clone keeps origin=file://...; push made bare the target.
sh(`git config user.email dev@prismgit.test && git config user.name "Dev Author"`, BIG);

fs.mkdirSync(DEAD);
sh('git init -q -b main && git config user.email d@p.test && git config user.name D', DEAD);
fs.writeFileSync(path.join(DEAD, 'a.txt'), 'a\n');
sh('git add -A && git commit -q -m init', DEAD);
sh('git remote add origin http://192.0.2.1:8082/web/git/dead.git', DEAD); // TEST-NET-1 black hole

fs.mkdirSync(FAST);
sh('git init -q -b main && git config user.email f@p.test && git config user.name F', FAST);
fs.writeFileSync(path.join(FAST, 'f.txt'), 'f\n');
sh('git add -A && git commit -q -m init', FAST);
sh(`git remote add origin "${BARE}"`, FAST);
sh('git push -q origin HEAD:refs/heads/fast-branch', FAST);

// ── 2. Settings fixture ─────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-perf-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru',
    repoRemoteCheckIntervalSec: 120, repoRemoteCheckScope: 'favorites',
    backgroundFetchRemotes: { [BIG]: ['origin'], [DEAD]: ['origin'], [FAST]: ['origin'] },
  },
  repositories: [
    { path: BIG, name: 'big', lastOpened: Date.now(), pinned: false },
    { path: DEAD, name: 'dead', lastOpened: 0, pinned: false },
    { path: FAST, name: 'fast', lastOpened: 0, pinned: false },
  ],
  repoMetadata: { [DEAD]: { favorite: true }, [FAST]: { favorite: true } },
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1500, height: 950 }, isMaximized: false, isFullScreen: false },
}, null, 2));

// ── 3. Launch ───────────────────────────────────────────────────────────────
console.log('── launch ──');
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
await page.locator('button:has-text("big")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-big"]').first().click();
});
await page.waitForTimeout(4000);

// ── 4. Samplers ─────────────────────────────────────────────────────────────
const rootPid = app.process().pid;
const cpuSamples = [];        // { t, pid, comm, cpuPct } (delta vs previous sample)
const procSeen = new Map();   // pid -> last {utime, stime, t}
const gitSpawns = [];         // { t, pid, comm, cmdline, cpuPct } — git processes seen alive
let prevTable = null;
let sampling = true;

function readProc() {
  const map = new Map();
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      let cmdline = '';
      try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch {}
      map.set(Number(pid), {
        pid: Number(pid), comm, ppid: Number(after[1]),
        utime: Number(after[11]), stime: Number(after[12]), cmdline,
      });
    } catch { /* raced */ }
  }
  return map;
}

function sampleOnce() {
  const now = Date.now();
  const table = readProc();
  // in-tree (ppid closure) + anything referencing our fixture/user-data
  const inTree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of table.values()) {
      if (inTree.has(p.ppid) && !inTree.has(p.pid)) { inTree.add(p.pid); grew = true; }
    }
  }
  const interesting = [];
  for (const p of table.values()) {
    const isGit = p.comm === 'git' || /(^|\/)git( |$)/.test(p.cmdline);
    const refsFixture = p.cmdline.includes(ROOT) || p.cmdline.includes(userDataDir);
    if (inTree.has(p.pid) || (isGit && (refsFixture || p.cmdline.includes('192.0.2.1'))) || refsFixture) {
      interesting.push(p);
    }
  }
  if (prevTable) {
    const dt = (now - prevT) / 1000;
    for (const p of interesting) {
      const prev = prevTable.get(p.pid);
      if (!prev) continue;
      const dsec = (p.utime - prev.utime + p.stime - prev.stime) / CLK_TCK;
      const cpuPct = Math.max(0, (dsec / dt) * 100);
      if (cpuPct > 0.1) {
        cpuSamples.push({ t: now, pid: p.pid, comm: p.comm, kind: p.comm === 'git' ? 'git' : (inTree.has(p.pid) ? 'app' : 'other'), cpuPct });
      }
      if (p.comm === 'git' || p.kind === 'git') {
        gitSpawns.push({ t: now, pid: p.pid, cmd: p.cmdline.slice(0, 160), cpuPct });
      }
    }
  }
  prevTable = table; prevT = now;
}
let prevT = Date.now();
const procTimer = setInterval(sampleOnce, 250);

// Main-process event-loop lag sampler (500ms heartbeat drift)
await app.evaluate(() => {
  const g = globalThis;
  g.__lag = [];
  g.__lagT = [];
  let last = process.hrtime.bigint();
  g.__lagTimer = setInterval(() => {
    const now = process.hrtime.bigint();
    const driftMs = Number(now - last) / 1e6 - 500;
    last = now;
    g.__lag.push(Math.max(0, driftMs));
    g.__lagT.push(Date.now());
  }, 500);
  return true;
});

// Renderer: long tasks + rAF gaps
await page.evaluate(() => {
  const w = window;
  w.__lt = [];
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__lt.push({ t: Date.now(), dur: e.duration });
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported */ }
  w.__raf = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    w.__raf.push({ t: Date.now(), gap: now - last });
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
});

// Ping sampler (2s) — renderer + CDP roundtrip latency
const pings = [];
const pingTimer = setInterval(async () => {
  const t0 = Date.now();
  try { await page.evaluate(() => 0); } catch { /* app closed */ }
  pings.push({ t: Date.now(), dt: Date.now() - t0 });
}, 2000);

// ── 5. Scenario timeline ────────────────────────────────────────────────────
const windows = [];
const goto = async (h) => {
  await page.evaluate((x) => { window.location.hash = x; }, h);
  await page.waitForTimeout(1500);
};
const openWindow = async (name, ms) => {
  const start = Date.now();
  await page.waitForTimeout(ms);
  windows.push({ name, start, end: Date.now() });
  console.log(`   window ${name}: ${Math.round(ms / 1000)}s done`);
};

console.log('── scenario ──');
await goto('#/changes');
await openWindow('W1-changes-idle-1', 90_000);
await goto('#/history');
await openWindow('W2-history', 45_000);
await goto('#/search');
await openWindow('W3-search', 25_000);
await goto('#/blame');
await openWindow('W4-blame', 25_000);
await goto('#/pulls');
await openWindow('W5-pulls', 25_000);
await goto('#/changes');
await openWindow('W6-external-mutation-pre', 5_000);
const mutT = Date.now();
sh('git commit -q --allow-empty -m "perf probe commit"', BIG);
fs.writeFileSync(path.join(BIG, 'churn.txt'), `churn ${Date.now()}\n`);
await openWindow('W6-external-mutation', 45_000);
await openWindow('W7-changes-idle-2', 90_000);

// ── 6. Collect & analyze ────────────────────────────────────────────────────
console.log('── collect ──');
sampling = false;
clearInterval(procTimer);
clearInterval(pingTimer);
const lag = await app.evaluate(() => {
  clearInterval(globalThis.__lagTimer);
  return { lag: globalThis.__lag, t: globalThis.__lagT };
});
const renderer = await page.evaluate(() => ({
  lt: window.__lt, raf: window.__raf,
}));
const cmdLog = await page.evaluate(() => window.smartgit?.commandLog?.list?.() ?? [])
  .catch(() => []);

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};
const inWin = (t, w) => t >= w.start && t <= w.end;

const report = { startedAt: windows[0].start, windows: [], totals: {}, cmdLogCount: cmdLog.length };
// command log field discovery
if (cmdLog.length) report.cmdLogSampleKeys = Object.keys(cmdLog[0]);

for (const w of windows) {
  const dur = (w.end - w.start) / 1000;
  // process CPU by comm
  const byComm = new Map();
  for (const s of cpuSamples) {
    if (!inWin(s.t, w)) continue;
    const key = s.kind === 'git' ? `git` : s.comm;
    byComm.set(key, (byComm.get(key) ?? 0) + s.cpuPct); // sum of % over samples ≈ %·samples; convert below
  }
  // convert: each sample is cpuPct over 250ms → total CPU seconds = Σ cpuPct/100*0.25
  const cpuByComm = {};
  for (const [k, v] of byComm) cpuByComm[k] = Math.round(v * 0.25 * 100) / 100; // CPU-seconds in window
  const gits = [...new Set(gitSpawns.filter((g) => inWin(g.t, w)).map((g) => g.pid + '|' + g.cmd))];
  const lts = renderer.lt.filter((e) => inWin(e.t, w)).map((e) => e.dur);
  const rafs = renderer.raf.filter((e) => inWin(e.t, w)).map((e) => e.gap);
  const pngs = pings.filter((e) => inWin(e.t, w)).map((e) => e.dt);
  const lagIdx = lag.t.map((t, i) => [t, i]).filter(([t]) => inWin(t, w)).map(([, i]) => lag.lag[i]);
  report.windows.push({
    name: w.name, seconds: Math.round(dur),
    cpuSecondsByProcess: Object.fromEntries(Object.entries(cpuByComm).sort((a, b) => b[1] - a[1]).slice(0, 10)),
    gitProcessesSeen: gits.length,
    gitSampleCommands: gits.slice(0, 8).map((g) => g.split('|')[1].slice(0, 110)),
    longTasks: { count: lts.length, totalMs: Math.round(lts.reduce((a, b) => a + b, 0)), p95ms: pct(lts, 95), maxMs: lts.length ? Math.round(Math.max(...lts)) : 0 },
    rafGapMs: { avg: rafs.length ? Math.round((rafs.reduce((a, b) => a + b, 0) / rafs.length) * 10) / 10 : 0, p95: pct(rafs, 95), max: rafs.length ? Math.round(Math.max(...rafs)) : 0 },
    pingMs: { p50: pct(pngs, 50), p95: pct(pngs, 95), max: pngs.length ? Math.max(...pngs) : 0 },
    mainLagMs: { p50: pct(lagIdx, 50), p95: pct(lagIdx, 95), max: lagIdx.length ? Math.round(Math.max(...lagIdx)) : 0 },
  });
}

// command-log frequency (whole run), grouped by git subcommand
const cmdFreq = new Map();
for (const e of cmdLog) {
  const raw = e.args ?? e.command ?? '';
  const args = (Array.isArray(raw) ? raw.join(' ') : String(raw)).split(/\s+/).filter(Boolean);
  const sub = args[0] === 'git' ? (args[1] ?? '') : (args[0] ?? '');
  const key = `git ${sub}`;
  cmdFreq.set(key, (cmdFreq.get(key) ?? 0) + 1);
}
report.cmdFreqWholeRun = Object.fromEntries([...cmdFreq.entries()].sort((a, b) => b[1] - a[1]));
// per-window command counts using startedAt/endedAt if present
const tKey = cmdLog.length ? (cmdLog[0].startedAt != null ? 'startedAt' : (cmdLog[0].timestamp != null ? 'timestamp' : null)) : null;
if (tKey) {
  for (const w of report.windows) {
    w.commandLogEntries = cmdLog.filter((e) => inWin(e[tKey], w)).length;
  }
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n════ PERF DIAGNOSIS REPORT ════');
for (const w of report.windows) {
  console.log(`\n● ${w.name} (${w.seconds}s)`);
  console.log(`   CPU-seconds: ${JSON.stringify(w.cpuSecondsByProcess)}`);
  console.log(`   git procs seen: ${w.gitProcessesSeen}${w.gitSampleCommands.length ? ' — e.g. ' + w.gitSampleCommands[0] : ''}`);
  console.log(`   longTasks: ${w.longTasks.count} (total ${w.longTasks.totalMs}ms, p95 ${w.longTasks.p95ms}ms)`);
  console.log(`   rAF gap: avg ${w.rafGapMs.avg}ms / p95 ${w.rafGapMs.p95}ms / max ${w.rafGapMs.max}ms`);
  console.log(`   ping: p50 ${w.pingMs.p50}ms / p95 ${w.pingMs.p95}ms / max ${w.pingMs.max}ms`);
  console.log(`   main-lag: p50 ${w.mainLagMs.p50}ms / p95 ${w.mainLagMs.p95}ms / max ${w.mainLagMs.max}ms`);
  if (w.commandLogEntries != null) console.log(`   command-log entries (main-proc spawns): ${w.commandLogEntries}`);
}
console.log('\n● git command frequency (whole run, MAIN-process spawns only):');
for (const [k, v] of Object.entries(report.cmdFreqWholeRun).slice(0, 25)) console.log(`   ${v}× ${k}`);
console.log(`\nreport → ${OUT}`);

await app.close().catch(() => {});
process.exit(0);
