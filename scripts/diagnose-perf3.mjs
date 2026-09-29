/**
 * PERF DIAGNOSIS v3 — per-TOOL main-loop blocking on a BIG repo.
 *
 * Static finding: HistoryPage/BranchesPage/Tags/Stashes/Reflog/Blame/Search
 * all load through MAIN-process simple-git spawns (git log -N, for-each-ref,
 * stash list, rev-list walks, blame). The main process is also the IPC broker
 * for every renderer call — while it is busy streaming/awaiting git output,
 * EVERY tool's clicks and refreshes queue behind it ("тупит на всех
 * инструментах, как будто что-то работает в фоне и мешает основному
 * процессу").
 *
 * This harness synthesizes a 20k-commit / 31-branch / 20-tag repo, opens it
 * in the real app, walks every tool, and measures per phase:
 *   - main-process event-loop lag (500ms heartbeat drift — how long main
 *     was blocked),
 *   - the app's own command log (main-process git spawns + durationMs),
 *   - git child process lifetimes (pid tracking),
 *   - renderer long tasks.
 *
 * Usage: DISPLAY=:99 node scripts/diagnose-perf3.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = '/home/z/my-project/work/perf-diag3';
const BIG = path.join(ROOT, 'big20k');
const BARE = path.join(ROOT, 'bare.git');
const OUT = path.join(ROOT, 'report.json');
fs.mkdirSync(ROOT, { recursive: true });
const sh = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', shell: '/bin/bash', stdio: ['pipe', 'pipe', 'pipe'] });

// ── 1. Synthesize the big repo (fast-import: 20k commits, 31 branches, 20 tags) ──
if (!fs.existsSync(path.join(BIG, '.git'))) {
  console.log('── synthesizing 20k-commit repo (fast-import) ──');
  fs.mkdirSync(BIG, { recursive: true });
  sh('git init -q -b main', BIG);
  sh('git config user.email d@p.test && git config user.name D', BIG);
  const N = 20_000;
  // Stream format mirrors `git fast-export` byte-for-byte (verified):
  // blob data length = exact payload bytes incl. trailing \n; commit message
  // data = msg + \n; `from` after the message data; blank line ends a commit.
  let stream = '';
  const blobMark = (i) => 1_000_000 + i;
  for (let i = 1; i <= N; i++) {
    const msg = `commit ${i} ${'x'.repeat(20)}`;
    const content = `content ${i}\n${'y'.repeat(40)}\n`;
    stream += `blob\nmark :${blobMark(i)}\ndata ${content.length}\n${content}\n`;
    const t = 1700000000 + i * 60;
    stream += `commit refs/heads/main\nmark :${i}\n`;
    stream += `author Dev <dev@p.test> ${t} +0000\ncommitter Dev <dev@p.test> ${t} +0000\n`;
    stream += `data ${msg.length + 1}\n${msg}\n`;
    if (i > 1) stream += `from :${i - 1}\n`;
    stream += `M 100644 :${blobMark(i)} file${i % 200}.txt\n\n`;
  }
  for (let b = 1; b <= 30; b++) {
    stream += `reset refs/heads/feature/${b}\nfrom :${Math.floor(N * b / 31)}\n\n`;
  }
  for (let t = 1; t <= 20; t++) {
    const msg = `tag msg ${t}`;
    stream += `tag v1.${t}\nfrom :${Math.floor(N * t / 21)}\ntagger T <t@p.test> ${1700000000 + t * 999} +0000\ndata ${msg.length + 1}\n${msg}\n\n`;
  }
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['fast-import', '--quiet', '--done'], {
    cwd: BIG, input: stream + 'done\n', maxBuffer: 1024 * 1024 * 512,
  });
  sh('git checkout -q -f main', BIG);
  fs.writeFileSync(path.join(BIG, 'README.md'), '# big\n');
  execSync(`git init -q --bare "${BARE}"`, { shell: '/bin/bash' });
  sh(`git remote add origin "${BARE}"`, BIG);
  sh('git push -q origin --all && git push -q origin --tags', BIG);
  console.log(`   ${sh('git rev-list --count HEAD', BIG).trim()} commits ready`);
} else {
  console.log('── big20k fixture exists ──');
}

// ── 2. Settings fixture ─────────────────────────────────────────────────────
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-perf3-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: {
    theme: 'light', tourCompleted: true, autoRefresh: true, locale: 'ru',
    repoRemoteCheckIntervalSec: 120, repoRemoteCheckScope: 'favorites',
    backgroundFetchRemotes: { [BIG]: ['origin'] },
  },
  repositories: [{ path: BIG, name: 'big20k', lastOpened: Date.now(), pinned: false }],
  repoMetadata: {},
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
await page.locator('button:has-text("big20k")').first().click().catch(async () => {
  await page.locator('[data-testid="repo-item-big20k"]').first().click();
});
await page.waitForTimeout(5000);

// ── 4. Samplers ─────────────────────────────────────────────────────────────
const rootPid = app.process().pid;
const gitPids = new Map(); // pid -> { cmd, first, last, cpu }
let prevTable = null;
let prevT = Date.now();
const readProc = () => {
  const map = new Map();
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      let cmdline = '';
      try { cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch {}
      map.set(Number(pid), { pid: Number(pid), comm, ppid: Number(after[1]), utime: Number(after[11]), stime: Number(after[12]), cmdline });
    } catch { /* raced */ }
  }
  return map;
};
const procTimer = setInterval(() => {
  const now = Date.now();
  const table = readProc();
  if (prevTable) {
    for (const p of table.values()) {
      if (p.comm !== 'git' && !/(^|\/)git( |$)/.test(p.cmdline)) continue;
      // only git children of the app tree
      let cur = p, ok = false;
      for (let i = 0; i < 6 && cur; i++) {
        if (cur.pid === rootPid) { ok = true; break; }
        cur = table.get(cur.ppid);
        if (!cur) break;
      }
      if (!ok) continue;
      const prev = prevTable.get(p.pid);
      const dsec = prev ? (p.utime - prev.utime + p.stime - prev.stime) / 100 : 0;
      const g = gitPids.get(p.pid) ?? { cmd: p.cmdline.slice(0, 140), first: now, last: now, cpu: 0 };
      g.last = now; g.cpu += dsec;
      gitPids.set(p.pid, g);
    }
  }
  prevTable = table; prevT = now;
}, 120);

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
await page.evaluate(() => {
  const w = window; w.__lt = [];
  try {
    const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push({ t: Date.now(), dur: e.duration }); });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {}
  return true;
});

// ── 5. Per-tool scenario ────────────────────────────────────────────────────
const phases = [];
const phase = async (name, fn) => {
  const start = Date.now();
  const cmdBefore = (await page.evaluate(() => window.smartgit?.commandLog?.list?.() ?? []).catch(() => [])).length;
  const lagBefore = await app.evaluate(() => globalThis.__lag.length);
  try { await fn(); } catch (e) { console.log(`   ! ${name}: ${e.message.slice(0, 120)}`); }
  await page.waitForTimeout(1500);
  const lagAfter = await app.evaluate(() => globalThis.__lag.length);
  const cmdLog = await page.evaluate(() => window.smartgit?.commandLog?.list?.() ?? []).catch(() => []);
  phases.push({
    name, start, end: Date.now(), cmdCount: cmdLog.length - cmdBefore,
    cmds: cmdLog.slice(cmdBefore).map((e) => ({ ts: e.timestamp, ms: e.durationMs, cmd: (Array.isArray(e.args) ? e.args.join(' ') : String(e.args)).slice(0, 110) })),
    lagSlice: [lagBefore, lagAfter],
  });
  console.log(`   ▣ ${name} (${Math.round((Date.now() - start) / 100) / 10}s)`);
};

const goto = async (h) => { await page.evaluate((x) => { window.location.hash = x; }, h); };

console.log('── per-tool walk ──');
await phase('P1-open-changes', async () => { await goto('#/changes'); await page.waitForTimeout(4000); });
await phase('P2-open-history', async () => { await goto('#/history'); await page.waitForTimeout(6000); });
await phase('P3-history-scroll-loadmore', async () => {
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 4000); await page.waitForTimeout(700); }
  await page.waitForTimeout(3000);
});
await phase('P4-open-branches', async () => { await goto('#/branches'); await page.waitForTimeout(8000); });
await phase('P5-open-tags', async () => { await goto('#/tags'); await page.waitForTimeout(5000); });
await phase('P6-open-stashes', async () => { await goto('#/stashes'); await page.waitForTimeout(4000); });
await phase('P7-open-reflog', async () => { await goto('#/reflog'); await page.waitForTimeout(4000); });
await phase('P8-open-search', async () => {
  await goto('#/search');
  await page.waitForTimeout(2000);
  const input = page.locator('input[type="text"], input[placeholder*="поиск" i], input[placeholder*="search" i]').first();
  await input.fill('commit 19999').catch(() => {});
  await page.waitForTimeout(5000);
});
await phase('P9-open-blame', async () => { await goto('#/blame'); await page.waitForTimeout(5000); });
await phase('P10-idle-after', async () => { await goto('#/changes'); await page.waitForTimeout(8000); });

// ── 6. Report ───────────────────────────────────────────────────────────────
clearInterval(procTimer);
const lag = await app.evaluate(() => {
  clearInterval(globalThis.__lagTimer);
  return { lag: globalThis.__lag, t: globalThis.__lagT };
});
const lt = await page.evaluate(() => window.__lt ?? []);

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};

const report = { phases: [] };
for (const ph of phases) {
  const lagVals = lag.lag.slice(ph.lagSlice[0], ph.lagSlice[1]);
  const lts = lt.filter((e) => e.t >= ph.start && e.t <= ph.end).map((e) => e.dur);
  const gits = [...gitPids.values()].filter((g) => g.last >= ph.start && g.first <= ph.end);
  report.phases.push({
    name: ph.name,
    wallMs: ph.end - ph.start,
    mainLag: { p50: pct(lagVals, 50), p95: pct(lagVals, 95), max: lagVals.length ? Math.round(Math.max(...lagVals)) : 0, blockedOver100ms: lagVals.filter((v) => v > 100).length, blockedOver400ms: lagVals.filter((v) => v > 400).length },
    longTasks: { count: lts.length, totalMs: Math.round(lts.reduce((a, b) => a + b, 0)), maxMs: lts.length ? Math.round(Math.max(...lts)) : 0 },
    mainProcGitSpawns: ph.cmdCount,
    slowestMainSpawns: ph.cmds.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map((c) => `${Math.round(c.ms)}ms ${c.cmd}`),
    gitChildLifetimes: gits.map((g) => `${Math.round(g.last - g.first)}ms cpu=${Math.round(g.cpu * 100) / 100}s ${g.cmd.slice(0, 80)}`).sort((a, b) => parseInt(b) - parseInt(a)).slice(0, 6),
  });
}
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('\n════ PERF v3 — per-tool main-loop blocking (20k commits, 31 branches) ════');
for (const p of report.phases) {
  console.log(`\n● ${p.name} (wall ${Math.round(p.wallMs / 100) / 10}s)`);
  console.log(`   main-lag: p50 ${p.mainLag.p50}ms / p95 ${p.mainLag.p95}ms / MAX ${p.mainLag.max}ms — blocked>100ms ×${p.mainLag.blockedOver100ms}, >400ms ×${p.mainLag.blockedOver400ms}`);
  console.log(`   renderer longTasks: ${p.longTasks.count} (${p.longTasks.totalMs}ms, max ${p.longTasks.maxMs}ms)`);
  console.log(`   main-process git spawns: ${p.mainProcGitSpawns}${p.slowestMainSpawns.length ? ' — slowest: ' + p.slowestMainSpawns.join(' | ') : ''}`);
  if (p.gitChildLifetimes.length) console.log(`   git children (any process): ${p.gitChildLifetimes.slice(0, 3).join('  ;  ')}`);
}
console.log(`\nreport → ${OUT}`);
await app.close().catch(() => {});
process.exit(0);
