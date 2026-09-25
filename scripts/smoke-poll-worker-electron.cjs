#!/usr/bin/env node
/**
 * Smoke: REAL Electron utilityProcess.fork() of the built git-poll worker
 * (dist-electron/gitPollWorker.js). Mirrors gitPollProcess.ensureWorker():
 * fork → wait for 'ready' → send one poll job → await 'poll-result' → quit.
 *
 * Fixture: bare remote + clone with one local-only commit (outgoing=1).
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

app.whenReady().then(() => {
  const proc = utilityProcess.fork(
    path.join(__dirname, '..', 'dist-electron', 'gitPollWorker.js'),
    [],
    { serviceName: 'prismgit-git-poll' }
  );

  const fail = (msg) => { console.error('FAIL:', msg); app.exit(1); };
  const watchdog = setTimeout(() => fail('timeout waiting for poll-result'), 60_000);

  let sent = false;
  proc.on('message', (message) => {
    if (!message || typeof message.kind !== 'string') return;
    if (message.kind === 'ready') {
      console.log('worker ready — dispatching job');
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
      sent = true;
      return;
    }
    if (message.kind === 'poll-result' && sent) {
      clearTimeout(watchdog);
      const res = message.result;
      const ok =
        res.fetched === true &&
        res.error == null &&
        res.branch === branch &&
        res.incoming === 0 &&
        res.outgoing === 1 &&
        res.dirty === 0;
      console.log('poll-result:', JSON.stringify(res));
      proc.kill();
      if (!ok) { fail('unexpected result'); return; }
      console.log('SMOKE OK — real utilityProcess fork runs the poll job');
      app.exit(0);
    }
    if (message.kind === 'poll-error') {
      fail('worker reported poll-error: ' + message.message);
    }
  });

  proc.on('exit', (code) => {
    if (sent && code != null && code !== 0) fail(`worker exited with code ${code} before answering`);
  });
}).catch((e) => { console.error('FAIL:', e); app.exit(1); });
