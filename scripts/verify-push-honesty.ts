/**
 * Task 29 — verification of HONEST push reporting against a REAL git HTTP
 * server (git http-backend CGI). Reproduces the user's report:
 * "Pushed to main on a GitHub remote — got a success message, but the
 * remote branch was NOT updated."
 *
 * git exits 0 in several cases where the user's intent is NOT fulfilled:
 *   - "Everything up-to-date" (commits are on another branch / not committed)
 *   - pushing `Main` when the remote branch is `main` (new branch appears)
 * The service now parses the push output AND verifies via ls-remote that the
 * remote branch really points at the local commit after the push.
 *
 *   1. normal push → updated + verified (remote hash == local hash)
 *   2. re-push → up-to-date, honest summary (NOT "pushed successfully")
 *   3. new commit → push → verification matches
 *   4. new branch → created + verified
 *   5. case-mismatch (Main vs main) → remote 'Main' created, remote 'main'
 *      UNCHANGED — result makes the mismatch visible
 *   6. protected branch (pre-receive hook declines main) → clear error,
 *      remote main untouched
 *   7. non-fast-forward → clear error with pull-first hint
 *
 * Run: npx tsx scripts/verify-push-honesty.ts
 */
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { simpleGit } from 'simple-git';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** Smart-HTTP git server (wraps `git http-backend`). */
class GitHttpServer {
  server: http.Server;
  port = 0;

  constructor(private rootDir: string) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_PROJECT_ROOT: this.rootDir,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.split('?')[0]),
      QUERY_STRING: url.split('?')[1] ?? '',
      REQUEST_METHOD: req.method ?? 'GET',
      CONTENT_TYPE: String(req.headers['content-type'] ?? ''),
      GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
    };
    const len = req.headers['content-length'];
    if (len) env.CONTENT_LENGTH = String(len);

    const cgi: ChildProcessWithoutNullStreams = spawn('git', ['http-backend'], { env });
    req.pipe(cgi.stdin);

    let buf = Buffer.alloc(0);
    let headersSent = false;
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (headersSent) { res.write(chunk); return; }
      buf = Buffer.concat([buf, chunk]);
      const sepCrlf = buf.indexOf('\r\n\r\n');
      const sepLf = buf.indexOf('\n\n');
      const sep = sepCrlf !== -1 ? sepCrlf : sepLf;
      if (sep === -1) return;
      headersSent = true;
      const head = buf.subarray(0, sep).toString('utf8');
      const body = buf.subarray(sep + (sep === sepCrlf ? 4 : 2));
      const status = /Status:\s*(\d+)/i.exec(head)?.[1];
      const contentType = /Content-Type:\s*(\S+)/i.exec(head)?.[1];
      if (!res.headersSent) {
        res.writeHead(status ? parseInt(status, 10) : 200, {
          'Content-Type': contentType ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
      }
      if (body.length) res.write(body);
      cgi.stdout.resume();
    });
    cgi.stderr.on('data', () => { /* diag only */ });
    cgi.on('close', () => { if (!res.writableEnded) res.end(); });
    cgi.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      if (!res.writableEnded) res.end();
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  }

  url(repoName = 'repo.git'): string {
    return `http://127.0.0.1:${this.port}/${repoName}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'task29-store-'));
  process.env.PRISMGIT_USER_DATA = userData;

  const svc = await import('../electron/services/git');
  const storage = await import('../electron/services/storage');

  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'task29-'));
  const work = path.join(ROOT, 'work');
  const work2 = path.join(ROOT, 'work2'); // second client for divergence cases
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(work2, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'pub', 'repo.git'), { recursive: true });
  const bare = simpleGit(path.join(ROOT, 'pub/repo.git'));
  await bare.init(true);
  // git http-backend refuses anonymous receive-pack unless explicitly enabled
  await bare.addConfig('http.receivepack', 'true');

  const server = new GitHttpServer(path.join(ROOT, 'pub'));
  await server.start();

  const git = simpleGit(work);
  await git.init();
  await git.addConfig('user.email', 't@t.local');
  await git.addConfig('user.name', 'T');
  await fs.promises.writeFile(path.join(work, 'a.txt'), 'hello\n');
  await git.add(['a.txt']);
  await git.commit('init');
  await svc.addRemote(work, 'origin', server.url());

  // Second client pushes through the same server (branch divergence case)
  const git2 = simpleGit(work2);
  await git2.clone(server.url(), work2);
  await git2.addConfig('user.email', 't2@t.local');
  await git2.addConfig('user.name', 'T2');

  storage.setSetting('remoteAuth', {
    [work]: { origin: { username: '', password: '' } },
    // no auth needed on this open server — placeholder keeps map shape
  });

  console.log('── 1. normal push → updated + verified ──');
  const r1 = await svc.push(work, 'origin', 'main', true);
  const local1 = (await git.raw(['rev-parse', 'main'])).trim();
  check('push reports an update', r1.updated === true && r1.upToDate === false);
  // First push to an empty server repo legitimately reports [new branch]
  check('remote ref line parsed', r1.refs[0]?.remoteRef === 'main' && (r1.refs[0]?.created === true || r1.refs[0]?.newHash === local1), JSON.stringify(r1.refs));
  check('verification: remote == local', r1.verification?.ok === true && r1.verification.remoteHash === local1, JSON.stringify(r1.verification));
  check('summary names the branch', /main/.test(r1.summary), r1.summary);

  console.log('── 2. re-push → honest up-to-date (NOT "pushed successfully") ──');
  const r2 = await svc.push(work, 'origin', 'main');
  check('up-to-date detected', r2.upToDate === true && r2.updated === false, JSON.stringify(r2));
  check('summary says nothing was pushed', /up-to-date/i.test(r2.summary), r2.summary);
  check('verification still ok', r2.verification?.ok === true);

  console.log('── 3. new commit → push → verification matches ──');
  await fs.promises.writeFile(path.join(work, 'b.txt'), 'two\n');
  await git.add(['b.txt']);
  await git.commit('second');
  const r3 = await svc.push(work, 'origin', 'main');
  const local3 = (await git.raw(['rev-parse', 'main'])).trim();
  check('update reported', r3.updated === true);
  check('verification: remote == new local hash', r3.verification?.ok === true && r3.verification.remoteHash === local3);

  console.log('── 4. new branch → created + verified ──');
  await git.checkoutLocalBranch('feature/one');
  await fs.promises.writeFile(path.join(work, 'c.txt'), 'f\n');
  await git.add(['c.txt']);
  await git.commit('feature');
  const r4 = await svc.push(work, 'origin', 'feature/one', true);
  check('created flag reported', r4.refs[0]?.created === true, JSON.stringify(r4.refs));
  check('verification ok for new branch', r4.verification?.ok === true);
  check('summary says published', /Published/.test(r4.summary), r4.summary);

  console.log('── 5. case-mismatch Main vs main → mismatch made visible ──');
  await git.checkoutLocalBranch('Main');
  await fs.promises.writeFile(path.join(work, 'd.txt'), 'case\n');
  await git.add(['d.txt']);
  await git.commit('case typo');
  const r5 = await svc.push(work, 'origin', 'Main');
  const bareMain = (await bare.raw(['rev-parse', 'refs/heads/main'])).trim();
  check('git created a SEPARATE remote branch Main', r5.refs[0]?.created === true && r5.refs[0]?.remoteRef === 'Main', JSON.stringify(r5.refs));
  check('remote main is UNCHANGED (the user-side confusion)', r5.verification && r5.verification.branch === 'Main' && bareMain !== r5.verification.localHash, `bare main=${bareMain.slice(0, 7)}`);
  check('verification for Main is ok (branch really exists remotely)', r5.verification?.ok === true);

  console.log('── 6. protected branch (pre-receive declines main) → clear error ──');
  const hooksDir = path.join(ROOT, 'pub/repo.git/hooks');
  const hook = `#!/bin/sh
while read old new ref; do
  if [ "$ref" = "refs/heads/main" ]; then
    echo "remote: error: GH006: Protected branch update failed for refs/heads/main" >&2
    exit 1
  fi
done
exit 0
`;
  fs.writeFileSync(path.join(hooksDir, 'pre-receive'), hook);
  fs.chmodSync(path.join(hooksDir, 'pre-receive'), 0o755);
  await git.checkout('main');
  await fs.promises.writeFile(path.join(work, 'e.txt'), 'blocked\n');
  await git.add(['e.txt']);
  await git.commit('must be rejected');
  let protErr = '';
  try {
    await svc.push(work, 'origin', 'main');
  } catch (e) {
    protErr = e instanceof Error ? e.message : String(e);
  }
  check('push to protected main FAILS', protErr.length > 0, 'expected rejection');
  check('error explains protected branch', /protected|remote rejected|GH006/i.test(protErr), protErr.slice(0, 160));
  const bareMainAfter = (await bare.raw(['rev-parse', 'refs/heads/main'])).trim();
  check('remote main NOT changed by rejected push', bareMainAfter === bareMain, bareMainAfter.slice(0, 7));
  fs.rmSync(path.join(hooksDir, 'pre-receive'));

  console.log('── 7. non-fast-forward → pull-first hint ──');
  // Second client advances main; first client is now behind.
  // git2 was cloned early — sync it to the CURRENT remote main first.
  await git2.fetch('origin');
  await git2.raw(['reset', '--hard', 'origin/main']);
  await fs.promises.writeFile(path.join(work2, 'f.txt'), 'from work2\n');
  await git2.add(['f.txt']);
  await git2.commit('advance from work2');
  await git2.push('origin', 'main');
  await fs.promises.writeFile(path.join(work, 'g.txt'), 'behind\n');
  await git.add(['g.txt']);
  await git.commit('local-only work');
  let nffErr = '';
  try {
    await svc.push(work, 'origin', 'main');
  } catch (e) {
    nffErr = e instanceof Error ? e.message : String(e);
  }
  check('non-fast-forward push FAILS', nffErr.length > 0, 'expected rejection');
  check('error suggests pull first', /non-fast-forward|fetch first|pull first|behind/i.test(nffErr), nffErr.slice(0, 160));

  await server.stop();
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
