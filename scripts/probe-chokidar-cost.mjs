/**
 * Measures how much chokidar's initial workdir scan blocks the Node event
 * loop — replicating electron/services/watcher.ts's startWatching() options
 * exactly (persistent:false, ignoreInitial:true, ignored: WORKTREE_IGNORED,
 * awaitWriteFinish).
 *
 * Event-loop lag is sampled every 5ms; any lag > 50ms = visible jank for a
 * process that must also answer every renderer IPC.
 *
 * Usage: node scripts/probe-chokidar-cost.mjs /path/to/repo
 */
import chokidar from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repo = process.argv[2];
if (!repo || !fs.existsSync(path.join(repo, '.git'))) {
  console.error('usage: node scripts/probe-chokidar-cost.mjs /path/to/repo');
  process.exit(1);
}

const WORKTREE_IGNORED = (testPath) => (
  /(^|[/\\])(node_modules|dist|build|target|out|\.next|\.cache|\.turbo|\.parcel-cache|coverage)([/\\]|$)/.test(testPath) ||
  /(^|[/\\])\.git([/\\]|$)/.test(testPath) ||
  /(^|[/\\])\.DS_Store$/.test(testPath) ||
  /\.log$/.test(testPath) ||
  /\.swp$/.test(testPath) ||
  /\.lock$/.test(testPath)
);

// Event-loop lag sampler.
let maxLag = 0;
const lags = [];
let sampling = true;
(function tick(prev) {
  if (!sampling) return;
  const now = Date.now();
  const lag = now - prev - 5;
  if (lag > 0) { lags.push(lag); if (lag > maxLag) maxLag = lag; }
  setTimeout(() => tick(now), 5);
})(Date.now());

const t0 = Date.now();
const w = chokidar.watch(repo, {
  persistent: false,
  ignoreInitial: true,
  ignored: WORKTREE_IGNORED,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
});
// chokidar emits 'ready' when the initial scan completes.
await new Promise((res) => w.on('ready', res));
const scanMs = Date.now() - t0;
await new Promise((r) => setTimeout(r, 300)); // trailing settle
sampling = false;
await w.close();

let dirCount = 0;
try { dirCount = w.getWatched ? Object.keys(w.getWatched() ?? {}).length : -1; } catch { dirCount = -1; }

const p = (a, q) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q / 100 * a.length))] : 0);
console.log(`repo: ${repo}`);
console.log(`initial scan wall: ${scanMs}ms`);
console.log(`event-loop lag during scan: p50=${p(lags, 50)}ms p95=${p(lags, 95)}ms max=${maxLag}ms (n=${lags.length})`);
console.log(`lag>100ms samples: ${lags.filter((l) => l > 100).length}`);
process.exit(0);
