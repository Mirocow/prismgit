#!/usr/bin/env node
/**
 * Smoke: REAL Electron utilityProcess.fork() of the built background git
 * worker (dist-electron/gitPollWorker.js). Mirrors gitPollProcess's manager:
 * fork → wait for 'ready' → send jobs → await results → quit.
 *
 * Fixture: bare remote + clone with one local-only commit (outgoing=1).
 * Sends BOTH job kinds the worker serves:
 *  - 'poll'   (remote check): expects fetched:true, outgoing:1;
 *  - 'status' (watcher refresh): expects the same working-tree answer the
 *             foreground status() computes — branch, file classification,
 *             HEAD hash, clean/dirty flag.
 * Run: xvfb-run -a npx electron scripts/smoke-poll-worker-electron.cjs
 * Exits 0 on success; app.exit codes surface as process exits.
 */
const { app, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-poll-electron-'));
const remote = path.join(root, 'remote.git');
const clone = path.join(root, 'clone');
const git = (cwd, ...args) =>
  execSync(`git ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`, { cwd, encoding: 'utf8' });

execSync(`git init --bare -q "${remote}"`);
execSync(`git clone -q "${remote}" "${clone}"`);
git(clone, 'config', 'user.email', 'smoke@test');
git(clone, 'config', 'user.name', 'Smoke');
fs.writeFileSync(path.join(clone, 'hello.txt'), 'hello\n');
git(clone, 'add', '.');
git(clone, 'commit', '-q', '-m', 'local-only commit');
const branch = git(clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
const headSha = git(clone, 'rev-parse', 'HEAD').trim();
// One dirty file so the status job has something to classify.
fs.writeFileSync(path.join(clone, 'dirty.txt'), 'dirty\n');

app.whenReady().then(() => {
  const proc = utilityProcess.fork(
    path.join(__dirname, '..', 'dist-electron', 'gitPollWorker.js'),
    [],
    { serviceName: 'prismgit-git-poll' }
  );

  const fail = (msg) => { console.error('FAIL:', msg); app.exit(1); };
  const watchdog = setTimeout(() => fail('timeout waiting for job results'), 60_000);

  let sentPoll = false;
  let sentStatus = false;
  let pollOk = false;
  let statusOk = false;
  const maybeDone = () => {
    if (pollOk && statusOk) {
      clearTimeout(watchdog);
      proc.kill();
      console.log('SMOKE OK — poll + status jobs run in the real worker process');
      app.exit(0);
    }
  };
  proc.on('message', (message) => {
    if (!message || typeof message.kind !== 'string') return;
    if (message.kind === 'ready') {
      console.log('worker ready — dispatching poll + status jobs');
      proc.postMessage({
        kind: 'poll',
        id: 1,
        request: {
          repoPath: clone,
          checkedRemotes: ['origin'],
          sshEnvVars: {},
          authArgs: {},
          fetchTimeoutMs: 60_000,
        },
      });
      sentPoll = true;
      proc.postMessage({
        kind: 'status',
        id: 2,
        request: { repoPath: clone, gitDir: path.join(clone, '.git') },
      });
      sentStatus = true;
      return;
    }
    if (message.kind === 'poll-result' && sentPoll && message.id === 1) {
      const res = message.result;
      const ok =
        res.fetched === true &&
        res.error == null &&
        res.branch === branch &&
        res.incoming === 0 &&
        res.outgoing === 1 &&
        res.dirty === 1;
      console.log('poll-result:', JSON.stringify(res));
      if (!ok) { proc.kill(); fail('unexpected poll result'); return; }
      console.log('SMOKE OK (poll) — real utilityProcess fork runs the remote check');
      pollOk = true;
      maybeDone();
    }
    if (message.kind === 'status-result' && sentStatus && message.id === 2) {
      const res = message.result;
      // Mirror of gitService.status(): branch + one untracked file + HEAD hash.
      const ok =
        res.current === branch &&
        Array.isArray(res.not_added) && res.not_added.includes('dirty.txt') &&
        res.head === headSha &&
        res.isClean === false &&
        res.isMerging === false &&
        res.isRebasing === false &&
        res.isCherryPicking === false &&
        res.detached === false;
      console.log('status-result:', JSON.stringify({ current: res.current, not_added: res.not_added, head: res.head, isClean: res.isClean }));
      if (!ok) { proc.kill(); fail('unexpected status result'); return; }
      console.log('SMOKE OK (status) — the watcher-refresh job runs in the real worker process');
      statusOk = true;
      maybeDone();
    }
    if (message.kind === 'poll-error' || message.kind === 'status-error') {
      fail('worker reported ' + message.kind + ': ' + message.message);
    }
  });

  proc.on('exit', (code) => {
    if ((sentPoll || sentStatus) && code != null && code !== 0) fail(`worker exited with code ${code} before answering`);
  });
}).catch((e) => { console.error('FAIL:', e); app.exit(1); });
