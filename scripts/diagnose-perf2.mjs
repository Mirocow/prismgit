/**
 * PERF DIAGNOSIS v2 — per-PID CPU attribution.
 *
 * v1 findings: ~3 CPU-cores of "electron" CPU at idle, renderer main thread
 * idle (rAF 16.7ms, no longtasks, ping 2ms), main-process loop idle (0.7ms),
 * ZERO git spawns, ZERO main-process command-log entries during windows.
 * v1 aggregated CPU by comm ("electron") — every process in the tree shares
 * that comm, so the burner is unidentified. v2:
 *   - per-PID cpuSeconds with the process's cmdline label (type=renderer /
 *     gpu / utility-sub-type / poll worker / node fork).
 *   - NO rAF/longtask sampler in phase A (v1's own rAF loop may have forced
 *     60fps compositing on Xvfb software raster — self-inflicted CPU).
 *   - manual poll trigger (pollRemoteSummaries IPC) + 100ms /proc scanning
 *     to catch the background fetch + counter reads.
 *   - phase B: rAF sampler ON for 30s to measure the delta it causes.
 *
 * Usage: DISPLAY=:99 node scripts/diagnose-perf2.mjs
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
const OUT = path.join(ROOT, 'report2.json');

const CLK_TCK = Number(execSync('getconf CLK_TCK').toString().trim()) || 100;
const sh = (cmd, cwd) =>
  execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

const exists = fs.existsSync(path.join(BIG, '.git'));
if (!exists) {
  console.log('fixture missing — recreating');
  const BARE = path.join(ROOT, 'bare-remote.git');
  execSync(`git clone -q --no-hardlinks /home/z/my-project/work/gitclient "${BIG}"`, { shell: '/bin/bash' });
  execSync(`git init -q --bare "${BARE}"`, { shell: '/bin/bash' });
  sh(`git remote set-url origin "${BARE}"`, BIG);
  sh('git push -q origin HEAD:refs/heads/main', BIG);
  sh('git config user.email dev@prismgit.test && git config user.name "Dev Author"', BIG);
  fs.mkdirSync(path.join(ROOT, 'dead'), { recursive: true });
  sh('git init -q -b main && git config user.email d@p.test && git config user.name D', path.join(ROOT, 'dead'));
  fs.writeFileSync(path.join(ROOT, 'dead/a.txt'), 'a\n');
  sh('git add -A && git commit -q -m init', path.join(ROOT, 'dead'));
  sh('git remote add origin http://192.0.2.1:8082/web/git/dead.git', path.join(ROOT, 'dead'));
  fs.mkdirSync(path.join(ROOT, 'fast'), { recursive: true });
  sh('git init -q -b main && git config user.email f@p.test && git config user.name F', path.join(ROOT, 'fast'));
  fs.writeFileSync(path.join(ROOT, 'fast/f.txt'), 'f\n');
  sh('git add -A && git commit -q -m init', path.join(ROOT, 'fast'));
  sh(`git remote add origin "${BARE}"`, path.join(ROOT, 'fast'));
  sh('git push -q origin HEAD:refs/heads/fast-branch', path.join(ROOT, 'fast'));
} else {
  // make sure big's HEAD is stable across re-runs (probe commit may exist)
  sh('git reset -q --hard HEAD', BIG);
  sh('git clean -qfd', BIG);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-perf2-'));
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

// ── samplers ────────────────────────────────────────────────────────────────
const rootPid = app.process().pid;
const cpuAcc = new Map();   // pid -> { label, comm, cpuSec, samples }
const pidLabel = new Map(); // pid -> cmdline label (first sight)
const gitSightings = [];    // { t, cmd, cpuPct }
let prevTable = null;
let prevT = Date.now();
let scanIntervalMs = 200;

function labelFor(p) {
  const c = p.cmdline || '';
  if (c.includes('--type=gpu-process') || c.includes('--type=gpu')) return 'gpu';
  if (c.includes('--type=renderer') || c.includes('--type=utility')) {
    if (c.includes('node.mojom')) return `utility-node(${(c.match(/utility-sub-type=node\.mojom\.(\w+)/) || [])[1] ?? '?'})`;
    if (c.includes('--type=renderer')) return 'renderer';
    return 'utility';
  }
  if (c.includes('gitPoll') || c.includes('poll-worker')) return 'poll-worker';
  if (c === '' ) return `kernel-helper(${p.comm})`;
  return c.split(' ').filter(Boolean).slice(-1)[0]?.slice(0, 40) || p.comm;
}

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
  const inTree = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of table.values()) {
      if (inTree.has(p.ppid) && !inTree.has(p.pid)) { inTree.add(p.pid); grew = true; }
    }
  }
  if (prevTable) {
    const dt = Math.max(0.05, (now - prevT) / 1000);
    for (const p of table.values()) {
      if (!inTree.has(p.pid)) continue;
      if (!pidLabel.has(p.pid)) pidLabel.set(p.pid, labelFor(p));
      const prev = prevTable.get(p.pid);
      const dsec = prev ? Math.max(0, (p.utime - prev.utime + p.stime - prev.stime) / CLK_TCK) : 0;
      const acc = cpuAcc.get(p.pid) ?? { label: pidLabel.get(p.pid), comm: p.comm, cpuSec: 0, samples: 0, maxCpuPct: 0 };
      acc.cpuSec += dsec;
      acc.samples += 1;
      acc.maxCpuPct = Math.max(acc.maxCpuPct, (dsec / dt) * 100);
      cpuAcc.set(p.pid, acc);
      if (p.comm === 'git' || /(^|\/)git( |$)/.test(p.cmdline)) {
        gitSightings.push({ t: now, cmd: p.cmdline.slice(0, 120), cpuPct: Math.round((dsec / dt) * 1000) / 10 });
      }
    }
  }
  prevTable = table;
  prevT = now;
}
const procTimer = setInterval(sampleOnce, scanIntervalMs);

// main-process event-loop lag
await app.evaluate(() => {
  const g = globalThis;
  g.__lag = []; g.__lagT = [];
  let last = process.hrtime.bigint();
  g.__lagTimer = setInterval(() => {
    const now = process.hrtime.bigint();
    g.__lag.push(Math.max(0, Number(now - last) / 1e6 - 500));
    last = now;
    g.__lagT.push(Date.now());
  }, 500);
  return true;
});

// ── scenario ────────────────────────────────────────────────────────────────
const windows = [];
const snap = (name) => { windows.push({ name, t: Date.now(), cpu: snapshotCpu() }); console.log(`   ▣ ${name}`); };
function snapshotCpu() {
  const out = {};
  for (const [pid, acc] of cpuAcc) out[`${pid}|${acc.label}`] = Math.round(acc.cpuSec * 100) / 100;
  return out;
}
const wait = (ms) => page.waitForTimeout(ms);

console.log('── scenario (phase A: NO rAF sampler) ──');
await page.evaluate((x) => { window.location.hash = x; }, '#/changes');
await wait(1000);
snap('A0-start');
await wait(60_000); snap('A1-changes-idle-60s');
await page.evaluate((x) => { window.location.hash = x; }, '#/history');
await wait(1500); snap('A2-history-nav');
await wait(30_000); snap('A3-history-idle-30s');

// external mutation
sh('git commit -q --allow-empty -m "perf probe 2"', BIG);
fs.writeFileSync(path.join(BIG, 'churn2.txt'), `churn ${Date.now()}\n`);
await wait(45_000); snap('A4-post-mutation-45s');

// manual poll trigger — watch 75s (dead remote fetch is 60s-timeout)
scanIntervalMs = 100;
const pollT = Date.now();
await page.evaluate((ps) => window.smartgit.git.pollRemoteSummaries(ps), [BIG, DEAD, FAST]).catch((e) => console.log('poll IPC error:', e.message));
await wait(75_000); snap('A5-manual-poll-75s');

// phase B: rAF sampler ON for 30s
await page.evaluate(() => {
  const w = window; w.__raf = [];
  let last = performance.now();
  const tick = () => { const n = performance.now(); w.__raf.push(n - last); last = n; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
});
snap('B0-raf-on');
await wait(30_000); snap('B1-raf-30s');

// ── collect ─────────────────────────────────────────────────────────────────
clearInterval(procTimer);
const lag = await app.evaluate(() => {
  clearInterval(globalThis.__lagTimer);
  return { lag: globalThis.__lag, t: globalThis.__lagT };
});
const cmdLog = await page.evaluate(() => window.smartgit?.commandLog?.list?.() ?? []).catch(() => []);

const raf = await page.evaluate(() => window.__raf ?? []).catch(() => []);
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};

// per-window deltas from snapshots
const perWin = [];
for (let i = 1; i < windows.length; i++) {
  const a = windows[i - 1], b = windows[i];
  const dt = (b.t - a.t) / 1000;
  const delta = {};
  const keys = new Set([...Object.keys(a.cpu), ...Object.keys(b.cpu)]);
  for (const k of keys) delta[k] = Math.round(((b.cpu[k] ?? 0) - (a.cpu[k] ?? 0)) * 100) / 100;
  const sorted = Object.fromEntries(Object.entries(delta).filter(([, v]) => v > 0.05).sort((x, y) => y[1] - x[1]));
  const total = Math.round(Object.values(delta).reduce((s, v) => s + v, 0) * 100) / 100;
  perWin.push({ from: a.name, to: b.name, seconds: Math.round(dt), totalCpuSec: total, cores: Math.round((total / dt) * 100) / 100, procs: sorted });
}

const totalCpu = {};
for (const [, acc] of cpuAcc) {
  totalCpu[`${acc.label}`] = Math.round(((totalCpu[acc.label] ?? 0) + acc.cpuSec) * 100) / 100;
}

const report = {
  rootPid, totalRuntimeSec: Math.round((Date.now() - windows[0].t + 65_000) / 1000),
  cpuSecondsByLabel: Object.fromEntries(Object.entries(totalCpu).sort((a, b) => b[1] - a[1])),
  windows: perWin,
  gitSightings: gitSightings.slice(0, 80).map((g) => `${new Date(g.t).toISOString().slice(14, 19)} cpu=${g.cpuPct}% ${g.cmd}`),
  gitSightingCount: gitSightings.length,
  mainLag: { p50: pct(lag.lag, 50), p95: pct(lag.lag, 95), max: lag.lag.length ? Math.round(Math.max(...lag.lag)) : 0 },
  rafPhaseB: { avg: raf.length ? Math.round((raf.reduce((a, b) => a + b, 0) / raf.length) * 10) / 10 : 0, p95: pct(raf, 95), max: raf.length ? Math.round(Math.max(...raf)) : 0, n: raf.length },
  cmdLogEntries: cmdLog.length,
  cmdLogTail: cmdLog.slice(-25).map((e) => `${new Date(e.timestamp).toISOString().slice(14, 19)} ${Math.round(e.durationMs)}ms ${(e.args ?? []).join(' ').slice(0, 100)}`),
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log('\n════ PERF v2 REPORT ════');
console.log(`total CPU-seconds by process label: ${JSON.stringify(report.cpuSecondsByLabel)}`);
console.log(`main-lag: ${JSON.stringify(report.mainLag)}`);
console.log(`git sightings: ${report.gitSightingCount}`);
report.gitSightings.slice(0, 12).forEach((g) => console.log('   ' + g));
console.log(`rAF (phase B): ${JSON.stringify(report.rafPhaseB)}`);
console.log('\nper-window CPU (top processes):');
for (const w of perWin) {
  console.log(`● ${w.from} → ${w.to} (${w.seconds}s): total ${w.totalCpuSec}s = ${w.cores} cores`);
  for (const [k, v] of Object.entries(w.procs).slice(0, 6)) console.log(`     ${v}s  ${k}`);
}
console.log(`\ncommand-log: ${cmdLog.length} entries (last 12):`);
report.cmdLogTail.slice(-12).forEach((e) => console.log('   ' + e));
console.log(`\nreport → ${OUT}`);
await app.close().catch(() => {});
process.exit(0);
