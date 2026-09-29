#!/usr/bin/env node
/**
 * Smoke: the REAL built worker bundle (dist-electron/gitPollWorker.js +
 * gitPollCore chunk) against a REAL git repository, driven through a fake
 * process.parentPort — the exact channel shape a utilityProcess provides.
 *
 * Fixture: bare "remote" repo + clone with one local commit on top → the
 * poll job must fetch origin and report outgoing=1, the branch name, and
 * fetched=true. Exits 0 on success, 1 on any mismatch.
 */
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-poll-smoke-'));
const remote = path.join(root, 'remote.git');
const clone = path.join(root, 'clone');
const git = (cwd, ...args) => execSync(`git ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`, { cwd, encoding: 'utf8' });

execSync(`git init --bare -q "${remote}"`);
execSync(`git clone -q "${remote}" "${clone}"`);
git(clone, 'config', 'user.email', 'smoke@test');
git(clone, 'config', 'user.name', 'Smoke');
fs.writeFileSync(path.join(clone, 'hello.txt'), 'hello\n');
git(clone, 'add', '.');
git(clone, 'commit', '-q', '-m', 'local-only commit');
const branch = git(clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
console.log('fixture ready:', clone, '(branch:', branch + ')');

const port = new EventEmitter();
const replies = [];
port.postMessage = (m) => { replies.push(m); };

process.parentPort = port;
require(path.join(__dirname, '..', 'dist-electron', 'gitPollWorker.js'));

const timeout = setTimeout(() => { console.error('FAIL: no reply within 30s', replies); process.exit(1); }, 30_000);

port.on('message', (event) => {
  const data = event && event.data;
  if (!data || data.kind !== 'poll') return;
  console.log('received job, running…');
  // The job: fetch 'origin' (the bare repo), then count counters.
  // NOTE: checkedRemotes=['origin'] is what main resolves for an opted-in
  // remote; sshEnvVars/authArgs empty is correct for a local file remote.
  const request = {
    repoPath: clone,
    checkedRemotes: ['origin'],
    sshEnvVars: {},
    authArgs: {},
    fetchTimeoutMs: 60_000,
  };
  if (JSON.stringify(data.request) !== JSON.stringify(request)) {
    console.error('FAIL: request mismatch', data.request);
    process.exit(1);
  }
});

// Worker posted 'ready' at require time — the test sends the job now.
const sendJob = () => {
  const request = {
    repoPath: clone,
    checkedRemotes: ['origin'],
    sshEnvVars: {},
    authArgs: {},
    fetchTimeoutMs: 60_000,
  };
  port.emit('message', { data: { kind: 'poll', id: 1, request } });
};

const ready = replies.find((r) => r && r.kind === 'ready');
if (ready) sendJob();

port.on('reply', () => {}); // (postMessage pushes into `replies`; poll below)

const pollReplies = setInterval(() => {
  const result = replies.find((r) => r && r.kind === 'poll-result');
  if (!result) return;
  clearTimeout(timeout);
  clearInterval(pollReplies);
  const { result: res } = result;
  const ok =
    res.fetched === true &&
    res.error == null &&
    res.branch === branch &&
    res.incoming === 0 &&
    res.outgoing === 1 &&
    res.dirty === 0;
  console.log('poll-result:', JSON.stringify(res));
  if (!ok) { console.error('FAIL: unexpected result'); process.exit(1); }
  console.log('SMOKE OK — built worker bundle runs the real poll job end-to-end');
  process.exit(0);
}, 25);
