#!/usr/bin/env node
/**
 * CPU-contention probe for the repo-switch wall time on the flat-wide
 * monster repo. Launches the app with the monster-switch repo list, clicks
 * heavy-repo (flat-wide, N files / M dirty), and samples per-process CPU
 * (main, git worker utilityProcess, renderer, git children) every 250ms
 * while the switch is in flight. Attributes the wall time:
 *
 *   - main pCPU high  → main itself is doing scaling work (app bug)
 *   - main pCPU low, others pegged → CPU starvation on a small box
 *     (container artifact, not an architecture violation)
 *
 * Usage: DISPLAY=:99 node scripts/probe-switch-cpu.mjs [--repos DIR]
 */
import { _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.argv.includes('--repos')
  ? process.argv[process.argv.indexOf('--repos') + 1]
  : '/tmp/prismgit-monster-switch';
const REPOS = [
  { dir: 'heavy-repo', name: 'heavy-repo' },
  { dir: 'medium-repo', name: 'medium-repo' },
  { dir: 'small-repo', name: 'small-repo' },
];

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-cpu-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true },
  repositories: REPOS.map((r) => ({ path: path.join(ROOT, r.dir), name: r.name, lastOpened: Date.now(), pinned: false })),
  repoMetadata: {},
}, null, 2));
fs.writeFileSync(path.join(userDataDir, 'prismgit-window-state.json'), JSON.stringify({
  windowState: { bounds: { x: 0, y: 0, width: 1440, height: 900 }, isMaximized: false, isFullScreen: false },
}, null, 2));

const app = await electron.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    path.join(process.cwd(), 'dist-electron/main.js')],
  env: {
    ...process.env, NODE_ENV: 'production',
    DISPLAY: process.env.DISPLAY || ':99',
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'ru',
  },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
async function clickRepo(name) {
  await page.locator(`[data-testid="repo-item-${name}"]`).first()
    .click({ timeout: 10000 })
    .catch(() => page.locator(`button:has-text("${name}")`).first().click({ timeout: 10000 }));
}
await page.locator('button:has-text("medium-repo")').first().click({ timeout: 10000 });
await page.waitForTimeout(2500);

// ── sample CPU across the whole process tree during the heavy switch ──
const pid = app.process().pid;
const samples = [];
const sampler = setInterval(() => {
  try {
    const out = execSync(
      `ps -eo pid,ppid,pcpu,rss,comm --no-headers | grep -E 'electron|git' || true`,
      { encoding: 'utf8', timeout: 2000 });
    for (const line of out.trim().split('\n').filter(Boolean)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
      if (m) samples.push({ t: Date.now(), pid: +m[1], ppid: +m[2], cpu: +m[3], rss: +m[4], comm: m[5].slice(0, 40) });
    }
  } catch { /* ps raced */ }
}, 250);

const t0 = Date.now();
await clickRepo("heavy-repo");
await page.locator('text=main').first().waitFor({ timeout: 30000 }).catch(() => {});
const wall = Date.now() - t0;
clearInterval(sampler);
await page.waitForTimeout(1500); // let sampler catch the tail
clearInterval(sampler);

// ── attribute: the electron root pid = main; tree children = worker/renderers/git ──
const childRanks = new Map();
for (const s of samples) {
  const key = s.pid;
  if (!childRanks.has(key)) childRanks.set(key, { comm: s.comm, ppid: s.ppid, cpuMax: 0, n: 0 });
  const r = childRanks.get(key);
  r.cpuMax = Math.max(r.cpuMax, s.cpu); r.n++;
}
const rows = [...childRanks.entries()].map(([p, r]) => ({ pid: p, ...r }))
  .sort((a, b) => b.cpuMax - a.cpuMax).slice(0, 12);
console.log(`switch wall click→'main' visible: ${wall}ms\n`);
console.log('pid        ppid  cpuMax  samples  comm');
for (const r of rows) console.log(String(r.pid).padEnd(9) + String(r.ppid).padEnd(7) + String(r.cpuMax).padEnd(8) + String(r.n).padEnd(9) + r.comm);
const mainRow = rows.find((r) => r.pid === pid);
console.log(`\nMAIN (pid ${pid}) cpuMax: ${mainRow ? mainRow.cpuMax : 'not sampled'}% — ${mainRow && mainRow.cpuMax < 60 ? 'starved (CPU contention), not self-blocking' : 'busy — main is doing scaling work'}`);
console.log(`\nTOTAL sampled pcpu>50 processes: ${rows.filter((r) => r.cpuMax > 50).length}`);
try { await app.close(); } catch {}
process.exit(0);
