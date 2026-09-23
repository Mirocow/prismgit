/**
 * Verify the watcher fix: chokidar CAN observe a file that does not exist
 * yet (MERGE_HEAD pattern) — creation AND deletion events must fire.
 * (fs.watch + existsSync never watched such files — that was the staleness bug.)
 */
import chokidar from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = '/tmp/watcher-fix-test';
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, '.git'), { recursive: true });

const target = path.join(ROOT, '.git', 'MERGE_HEAD');
const events = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exactly the options the fixed watcher.ts uses for missing state files:
const watcher = chokidar.watch(target, {
  persistent: false,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
});
watcher.on('all', (evt) => events.push(evt));

// Watcher is registered while MERGE_HEAD does NOT exist (as at app start).
await sleep(300);
fs.writeFileSync(target, 'abc123\n');          // git starts a conflicted merge
await sleep(400);
fs.rmSync(target);                             // merge committed / aborted
await sleep(400);

console.log('events:', events.join(', '));
const created = events.includes('add');
const removed = events.includes('unlink');
console.log(created ? '✓ creation observed (conflict state becomes visible)' : '✗ creation MISSED');
console.log(removed ? '✓ deletion observed (banner clears after abort/commit)' : '✗ deletion MISSED');
process.exit(created && removed ? 0 : 1);
