#!/usr/bin/env node
/**
 * Verify the watcher-driven `git status` refreshes run in the WORKER
 * process, not in Electron main ("фоновые status-обновления watcher'а в
 * отдельном процессе").
 *
 * Launches the built app against a real repo, opens it, then generates a
 * watcher storm (touch tracked files every 400 ms — exactly the IDE
 * auto-save pattern). While the storm runs, the script samples /proc:
 * every `git` subprocess is attributed to its PARENT —
 *   - the utility process (dist-electron/gitPollWorker.js) → WORKER-born
 *     (the whole point of the change),
 *   - the electron main process                  → MAIN-born
 *     (foreground work: repo-open burst, etc).
 *
 * Success criteria: status-family spawns during the storm
 * (status/symbolic-rev/rev-parse reads) are attributed to the WORKER.
 *
 * Usage: DISPLAY=:99 node scripts/verify-watcher-worker.mjs
 */
import { _electron as electron } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── fixture: heavy repo by default (a longer-running `git status` is easier
// to catch while sampling /proc) ──
const repo = process.env.PRISMGIT_VERIFY_REPO || '/tmp/prismgit-perf-repos/heavy-repo';
if (!fs.existsSync(repo)) {
  console.error('fixture repo not found — run scripts/perf-make-heavy-repo.sh first or pass PRISMGIT_VERIFY_REPO');
  process.exit(1);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-verify-ud-'));
fs.writeFileSync(path.join(userDataDir, 'prismgit-settings.json'), JSON.stringify({
  settings: { theme: 'light', tourCompleted: true, autoRefresh: true, repoRemoteCheckIntervalSec: 120 },
  repositories: [{ path: repo, name: path.basename(repo), lastOpened: Date.now(), pinned: false }],
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
    PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'en',
  },
  timeout: 30000,
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1200);

// open the repo
const btn = page.locator(`button:has-text("${path.basename(repo)}")`).first();
await btn.click();
await page.locator('#commit-message-input').waitFor({ state: 'visible', timeout: 30000 });
console.log('repo opened — collecting process map');

/** pid → { ppid, cmd } snapshot of the whole process table. */
function snapshot() {
  const map = new Map();
  const out = execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf-8' });
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
  }
  return map;
}

const procs = snapshot();
// The app pid: electron.launch exposes process.pid.
const appPid = app.process().pid;
// The worker: Electron marks utilityProcess children with the NodeService
// sub-type in argv (the worker JS path itself is passed over IPC, not argv).
// The other utility child (NetworkService) is Chromium's network service.
function findWorker(snap) {
  for (const [pid, p] of snap) {
    if (p.ppid === appPid && p.cmd.includes('--utility-sub-type=node.mojom.NodeService')) return pid;
  }
  return null;
}
let workerPid = findWorker(procs);
if (workerPid == null) {
  // The worker forks lazily — trigger one background status refresh by
  // touching a tracked file; the renderer's watcher → statusBackground.
  try { fs.appendFileSync(path.join(repo, 'src', 'a', 'file1.ts'), '// poke\n'); } catch { /* fixture layout */ }
  await page.waitForTimeout(7000); // 500ms debounce + 5s renderer rate-limit
  workerPid = findWorker(snapshot());
}
console.log(`app pid=${appPid}, worker pid=${workerPid ?? 'NOT FOUND'}`);

// ── storm + tight sampling (git subprocesses are short-lived — sample as
// fast as `ps` allows, no sleep) ──
const stormDir = fs.existsSync(path.join(repo, 'src', 'a')) ? path.join(repo, 'src', 'a') : repo;
const storm = spawn('sh', ['-c',
  `i=0; while [ $i -lt 80 ]; do for f in file1 file2 file3; do printf '%s\\n' "$i" > "${stormDir}/$f.ts" 2>/dev/null || true; done; touch "${repo}/history.log" 2>/dev/null || true; i=$((i+1)); sleep 0.4; done`],
  { stdio: 'ignore', detached: true });
storm.unref();

const ATTR = { worker: 0, main: 0, other: 0, workerCmds: new Map(), mainCmds: new Map() };
const STORM_MS = 35000; // ~7 background refreshes behind the 5s renderer rate-limit
const deadline = Date.now() + STORM_MS;
while (Date.now() < deadline) {
  const snap = snapshot();
  for (const [pid, p] of snap) {
    if (!p.cmd || pid === appPid || pid === workerPid) continue;
    // Only git SUBPROCESSES spawned by our processes (cmd starts with git).
    const isGit = /(^|\/)git( |$)/.test(p.cmd) && !p.cmd.includes('gitPollWorker');
    if (!isGit) continue;
    if (workerPid != null && p.ppid === workerPid) {
      ATTR.worker++;
      const key = p.cmd.replace(/^.*?git /, 'git ').slice(0, 60);
      ATTR.workerCmds.set(key, (ATTR.workerCmds.get(key) ?? 0) + 1);
    } else if (p.ppid === appPid) {
      ATTR.main++;
      const key = p.cmd.replace(/^.*?git /, 'git ').slice(0, 60);
      ATTR.mainCmds.set(key, (ATTR.mainCmds.get(key) ?? 0) + 1);
    } else {
      ATTR.other++;
    }
  }
  await new Promise((r) => setTimeout(r, 25));
}

console.log('\n================ WATCHER STORM GIT SPAWNS ================');
console.log(`spawned by the WORKER process: ${ATTR.worker}`);
for (const [c, n] of [...ATTR.workerCmds].sort((a, b) => b[1] - a[1])) console.log(`   ×${n}  ${c}`);
console.log(`spawned by MAIN (foreground):  ${ATTR.main}`);
for (const [c, n] of [...ATTR.mainCmds].sort((a, b) => b[1] - a[1])) console.log(`   ×${n}  ${c}`);
console.log(`other (unrelated parents):      ${ATTR.other}`);

const statusInWorker = [...ATTR.workerCmds.keys()].some((c) => /status|rev-parse|symbolic-ref|config/.test(c));
const statusInMain = [...ATTR.mainCmds.keys()].some((c) => /status/.test(c));
const verdict = workerPid != null && statusInWorker && (ATTR.main === 0 || !statusInMain)
  ? 'OK — watcher-driven status work runs in the worker process'
  : 'FAIL — status work still attributed to main';
console.log(`\nVERDICT: ${verdict}`);

try { await app.close(); } catch { /* ignore */ }
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(verdict.startsWith('OK') ? 0 : 1);
