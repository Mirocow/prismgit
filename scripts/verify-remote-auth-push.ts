/**
 * Task 27 — verification of per-remote authorization + push hardening
 * against a REAL git HTTP server (git http-backend CGI) protected by
 * Basic auth — reproducing the user's "Push failed: RPC failed; HTTP 400 /
 * remote hung up / couldn't push a new branch" scenario:
 *
 *   1. buildHttpAuthArgs: http(s) URL + creds → header args; ssh/local/empty → []
 *   2. push WITHOUT credentials → fails with an actionable auth hint
 *   3. push WITH stored credentials (app settings remoteAuth) → succeeds,
 *      upstream auto-set (-u)
 *   4. NEW branch push (the user's exact failing case) → succeeds
 *   5. listRemote (ls-remote preview in the Remotes tool) with creds → works
 *   6. pollRemoteSummary: fetches ONLY remotes with the background-fetch
 *      checkbox; none checked → zero network requests
 *   7. fetchAll with creds configured → per-remote fetch works
 *   8. WRONG password stored → fails with auth hint (no hang, no leak)
 *
 * Run: npx tsx scripts/verify-remote-auth-push.ts
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

/** Basic-auth-protected smart-HTTP git server (wraps `git http-backend`). */
class GitHttpServer {
  server: http.Server;
  port = 0;
  /** Access log: "METHOD path auth=ok|anon|bad". */
  log: string[] = [];

  constructor(private rootDir: string, private user: string, private pass: string) {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const hdr = String(req.headers.authorization ?? '');
    const expected = 'Basic ' + Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    const authState = hdr === expected ? 'ok' : hdr ? 'bad' : 'anon';
    this.log.push(`${req.method} ${req.url} auth=${authState}`);

    if (authState !== 'ok') {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="verify"' });
      res.end('Authentication required');
      return;
    }

    const url = req.url || '/';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_PROJECT_ROOT: this.rootDir,
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: decodeURIComponent(url.split('?')[0]),
      QUERY_STRING: url.split('?')[1] ?? '',
      REQUEST_METHOD: req.method ?? 'GET',
      CONTENT_TYPE: String(req.headers['content-type'] ?? ''),
      REMOTE_USER: this.user,
      // Protocol v2 hint from the client must reach the CGI.
      GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
    };
    const len = req.headers['content-length'];
    if (len) env.CONTENT_LENGTH = String(len);

    const cgi: ChildProcessWithoutNullStreams = spawn('git', ['http-backend'], { env });
    req.pipe(cgi.stdin);

    let buf = Buffer.alloc(0);
    let headersSent = false;
    cgi.stdout.on('data', (chunk: Buffer) => {
      if (headersSent) {
        res.write(chunk);
        return;
      }
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
  // Isolate the app-settings store BEFORE importing electron modules that
  // read it (dynamic import keeps evaluation after this assignment).
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'task27-store-'));
  process.env.PRISMGIT_USER_DATA = userData;

  const svc = await import('../electron/services/git');
  const storage = await import('../electron/services/storage');

  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'task27-'));
  const work = path.join(ROOT, 'work');
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'pub', 'repo.git'), { recursive: true });
  await simpleGit(path.join(ROOT, 'pub', 'repo.git')).init(true); // bare "server" repo

  const server = new GitHttpServer(path.join(ROOT, 'pub'), 'john', 's3cret');
  await server.start();

  const git = simpleGit(work);
  await git.init();
  await git.addConfig('user.email', 't@t.local');
  await git.addConfig('user.name', 'T');
  await fs.promises.writeFile(path.join(work, 'a.txt'), 'hello\n');
  await git.add(['a.txt']);
  await git.commit('init');
  await svc.addRemote(work, 'origin', server.url());

  console.log('── 1. buildHttpAuthArgs ──');
  const hdr = svc.buildHttpAuthArgs('http://example.com/x.git', { username: 'u', password: 'p' });
  check('http URL + creds → Authorization header', hdr.length === 2 && /Basic /.test(hdr[1]));
  const expectedB64 = Buffer.from('u:p').toString('base64');
  check('header carries base64(user:pass)', hdr[1]?.endsWith(expectedB64) ?? false, hdr[1]);
  check('ssh URL → no args', svc.buildHttpAuthArgs('git@host:x.git', { username: 'u', password: 'p' }).length === 0);
  check('local path → no args', svc.buildHttpAuthArgs('/tmp/x.git', { username: 'u', password: 'p' }).length === 0);
  check('empty creds → no args', svc.buildHttpAuthArgs('http://example.com/x.git', {}).length === 0);
  check('url with embedded creds → no double auth', svc.buildHttpAuthArgs('http://u:p@example.com/x.git', { username: 'u', password: 'p' }).length === 0);

  console.log('── 2. push WITHOUT credentials → clear auth error ──');
  const requestsBefore = server.log.length;
  let noCredErr = '';
  try {
    await svc.push(work);
  } catch (e) {
    noCredErr = e instanceof Error ? e.message : String(e);
  }
  check('push fails without credentials', noCredErr.length > 0, 'expected rejection');
  check('error explains WHERE to set credentials', /Repository Settings → Remotes|Remotes tool/.test(noCredErr), noCredErr.slice(0, 120));
  check('server saw the 401 probe', server.log.slice(requestsBefore).some((l) => l.includes('auth=anon')), server.log.slice(requestsBefore).join(' | '));

  console.log('── 3. push WITH stored credentials → succeeds, -u auto ──');
  storage.setSetting('remoteAuth', {
    [work]: { origin: { username: 'john', password: 's3cret' } },
  });
  await svc.push(work); // default branch, no upstream → -u
  const cur = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const bareRefs = await simpleGit(path.join(ROOT, 'pub/repo.git')).raw(['for-each-ref', '--format=%(refname:short)']);
  check('branch landed on the server', bareRefs.includes(cur), `${cur} vs: ${bareRefs}`);
  const upstream = (await git.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
  check('upstream auto-set (-u)', upstream === `origin/${cur}`, upstream);

  console.log('── 4. NEW branch push (the exact failing case of the user) ──');
  await git.checkoutLocalBranch('feature/new');
  await fs.promises.writeFile(path.join(work, 'b.txt'), 'new\n');
  await git.add(['b.txt']);
  await git.commit('feature work');
  await svc.push(work, 'origin', 'feature/new', true); // explicit -u like the Push dialog
  const bareRefs2 = await simpleGit(path.join(ROOT, 'pub/repo.git')).raw(['for-each-ref', '--format=%(refname:short)']);
  check('NEW branch pushed to the server', /feature\/new/.test(bareRefs2), bareRefs2);

  console.log('── 5. listRemote with credentials (Remotes tool preview) ──');
  const ls = await svc.listRemote(work, 'origin');
  check('ls-remote authenticated', /refs\/heads\/feature\/new/.test(ls), ls.split('\n')[0]);

  console.log('── 6. pollRemoteSummary: only checkbox-enabled remotes hit the network ──');
  // Checkbox OFF → zero network, no fetch
  const logBefore = server.log.length;
  storage.setSetting('backgroundFetchRemotes', {});
  const s1 = await svc.pollRemoteSummary(work);
  check('no checked remotes → no fetch', s1.fetched === false);
  check('no checked remotes → zero network requests', server.log.length === logBefore, `+${server.log.length - logBefore} requests`);
  // Checkbox ON → fetch origin
  storage.setSetting('backgroundFetchRemotes', { [work]: ['origin'] });
  const s2 = await svc.pollRemoteSummary(work);
  check('checked remote → fetch executed', s2.fetched === true, JSON.stringify(s2.error ?? ''));
  check('checked remote → network happened', server.log.length > logBefore);

  console.log('── 7. fetchAll with credentials → per-remote authenticated fetch ──');
  let fetchAllErr = '';
  try {
    await svc.fetchAll(work, true);
  } catch (e) {
    fetchAllErr = e instanceof Error ? e.message : String(e);
  }
  check('fetchAll succeeds with creds', fetchAllErr === '', fetchAllErr);

  console.log('── 8. WRONG credentials → auth hint, no leak, no hang ──');
  storage.setSetting('remoteAuth', {
    [work]: { origin: { username: 'john', password: 'WRONG' } },
  });
  let badErr = '';
  try {
    await svc.push(work, 'origin', 'feature/new');
  } catch (e) {
    badErr = e instanceof Error ? e.message : String(e);
  }
  check('wrong password → push rejected', badErr.length > 0);
  check('wrong password → actionable hint', /Authentication failed/.test(badErr), badErr.slice(0, 120));
  check('password value never appears in the error', !badErr.includes('WRONG'));

  await server.stop();
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
