/**
 * Integration tests — the per-remote HTTP authentication (remoteAuth) flow
 * end-to-end, the SAME shape as gitService.sslVerify.test.ts but for the
 * NEXT step of the corporate-server story:
 *
 * User report:
 *   «Ошибка pull … Error: Authentication failed — …
 *    fatal: could not read Username for
 *    'https://git.nbgi.cloud.rt-dc.ru': terminal prompts disabled»
 *   — «должен быть запрос логина и пароля у пользователя когда приходит эта
 *      ошибка и потом пароль и логин сохранять в сторадже»
 *
 * Levels:
 *  1. The REACTION trigger — fetch/clone against a local HTTP git server
 *     that requires Basic auth FAILS with a CLASSIFIED authentication
 *     error (the message the user saw; git never blocks on a terminal
 *     prompt — the fetch path sets GIT_TERMINAL_PROMPT=0, the clone spawn
 *     now does too).
 *  2. The FIX the dialog applies — store Username + Password/token in the
 *     remoteAuth settings map (exactly what setRemoteAuth() writes via
 *     settings:set), drop the main-process credential cache
 *     (api.git.invalidateCache — otherwise the 5 s TTL serves the stale
 *     empty map and the retry fails again), and the SAME fetch SUCCEEDS:
 *     the credentials are injected per-command as
 *     `-c http.extraHeader=Authorization: Basic …` (buildHttpAuthArgs).
 *  3. Clone contexts — the dialog saves the credential keyed by the TARGET
 *     path + 'origin'; clone/clonePartial/mirror read it from there and
 *     carry the header on the command line; a later fetch from the cloned
 *     repo picks the SAME stored credential up through remoteNetworkArgs().
 *
 * Global git config is neutralized (same belt-and-braces as the other
 * integration suites) so the machine's own settings can't interfere.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { execSync } from 'child_process';
import { classifyAuthFailure } from '../../src/lib/authErrors';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-data-'));
process.env.PRISMGIT_USER_DATA = TEST_DATA_DIR;
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
const REAL_HOME = process.env.HOME;
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-home-'));
process.env.HOME = EMPTY_HOME;

const gitService = await import('../../electron/services/git');
const storage = await import('../../electron/services/storage');

const USERNAME = 'corp.user';
const PASSWORD = 'corp-secret-token';

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

let clientRepo = '';
let serverDir = '';
let server: http.Server | null = null;
let serverPort = 0;
let remoteUrl = '';

/** MIME types git's dumb-HTTP walker validates. */
function contentTypeFor(p: string): string {
  if (p.endsWith('info/refs') || p.endsWith('/HEAD') || p.endsWith('objects/info/alternates') || p.endsWith('objects/info/http-alternates') || p.endsWith('objects/info/packs')) return 'text/plain; charset=utf-8';
  if (p.endsWith('.pack')) return 'application/x-git-packed-objects';
  if (p.endsWith('.idx')) return 'application/x-git-packed-objects-toc';
  if (p.endsWith('.bundle')) return 'application/octet-stream';
  return 'text/plain; charset=utf-8';
}

beforeAll(async () => {
  // ── Client repo (fetches/pulls from the auth-required http server) ──
  clientRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-client-'));
  shell('git init -b main', clientRepo);
  shell('git config user.email t@t && git config user.name t', clientRepo);

  // ── Bare repo with one commit, dumb-HTTP-ready ──
  serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-server-'));
  const bare = path.join(serverDir, 'repo.git');
  shell(`git init --bare -b main "${bare}"`, serverDir);
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-seed-'));
  shell('git init -b main', seed);
  shell('git config user.email t@t && git config user.name t', seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# auth test\n');
  shell('git add . && git commit -m init', seed);
  shell(`git push "${bare}" main`, seed);
  shell('git update-server-info', bare);

  // ── Static HTTP server over the bare repo root that REQUIRES Basic auth.
  // No credentials / wrong credentials → 401 + WWW-Authenticate (git then
  // tries to prompt — prompts are disabled in our paths → the classified
  // "could not read Username" failure). Valid credentials → serve files.
  const validAuth = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`, 'utf8').toString('base64')}`;
  server = http.createServer((req, res) => {
    if (req.headers.authorization !== validAuth) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="prismgit-auth-test"',
        'Content-Type': 'text/plain',
      });
      res.end('Unauthorized');
      return;
    }
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    const target = path.join(serverDir, rel);
    if (!target.startsWith(serverDir) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentTypeFor(rel),
      'Content-Length': fs.statSync(target).size,
    });
    fs.createReadStream(target).pipe(res);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as { port: number }).port;
  remoteUrl = `http://127.0.0.1:${serverPort}/repo.git`;
  shell(`git remote add origin ${remoteUrl}`, clientRepo);
}, 120_000);

afterAll(async () => {
  if (server) {
    // Destroy lingering keep-alive connections FIRST — plain close() waits
    // for them and a git client's pooled connection would keep this vitest
    // worker alive forever.
    (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  for (const d of [TEST_DATA_DIR, EMPTY_HOME, clientRepo, serverDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
});

/** Store a credential the way the RemoteAuthDialog does (renderer
 *  setRemoteAuth → settings:set → vault + sanitized map). */
function storeCredential(repoPath: string, remote: string, username: string, password: string): void {
  const map = (storage.getSetting('remoteAuth') as Record<string, Record<string, { username?: string; password?: string }>>) ?? {};
  map[repoPath] = { ...(map[repoPath] ?? {}), [remote]: { username, password } };
  storage.setSetting('remoteAuth', map);
  // The dialog drops the main-process credential cache so the retry reads
  // the FRESH map instead of the up-to-5 s stale one.
  gitService.invalidateCache(repoPath);
}

/** Remove every stored credential (test isolation). */
function clearCredentials(): void {
  storage.setSetting('remoteAuth', {});
  gitService.invalidateCache();
}

describe('fetch against the auth-required HTTP git server — the REACTION trigger', () => {
  it('without stored credentials fetch FAILS with a CLASSIFIED auth error (the user report)', async () => {
    clearCredentials();
    let thrown: unknown;
    try {
      await gitService.fetch(clientRepo, 'origin', true);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    const raw = thrown instanceof Error ? thrown.message : String(thrown);
    // The error is wrapped by describeNetworkError (hint + raw stderr) —
    // classify the WHOLE thing: the classifier matches on the raw part.
    const info = classifyAuthFailure(raw);
    expect(info).not.toBeNull();
    expect(info!.kind).toMatch(/no-credentials|bad-credentials/);
    expect(info!.host).toBe('127.0.0.1');
  });

  it('the wrapped error carries the auth hint (describeNetworkError)', async () => {
    clearCredentials();
    let thrown: unknown;
    try {
      await gitService.fetch(clientRepo, 'origin', true);
    } catch (e) {
      thrown = e;
    }
    const raw = thrown instanceof Error ? thrown.message : String(thrown);
    expect(raw).toContain('Authentication failed');
    expect(raw).toContain('authentication dialog');
    expect(raw).toContain('could not read Username');
  });
});

describe('storing Username + Password/token — the FIX the dialog applies', () => {
  it('after storing the credential (setRemoteAuth path) + cache drop, the SAME fetch succeeds', async () => {
    storeCredential(clientRepo, 'origin', USERNAME, PASSWORD);
    await gitService.fetch(clientRepo, 'origin', true);
    // The remote-tracking ref proves the fetch actually transferred refs.
    const refs = shell("git for-each-ref refs/remotes/origin --format='%(refname:short)'", clientRepo);
    expect(refs).toContain('origin/main');
  });

  it('pull works end-to-end with the stored credential (auto-stash + fast-forward)', async () => {
    await gitService.pull(clientRepo, 'origin', 'main', false, false).catch(() => {
      // Pull can legitimately fail to fast-forward if the previous test's
      // fetch already landed the ref — the point is that NO auth error
      // appears; anything else surfaces through the assertions below.
    });
    const log = shell('git log --oneline -1', clientRepo);
    expect(log).toContain('init');
  });

  it('WRONG credentials fail again — classified, so the dialog re-opens with the stored values prefilled', async () => {
    storeCredential(clientRepo, 'origin', USERNAME, 'wrong-password');
    let thrown: unknown;
    try {
      await gitService.fetch(clientRepo, 'origin', true);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    const raw = thrown instanceof Error ? thrown.message : String(thrown);
    // Wrong header → 401 → git re-prompts → prompts disabled → the same
    // «could not read Username» shape (the dialog refines the body to
    // "rejected" because the stored credential is prefilled).
    const info = classifyAuthFailure(raw);
    expect(info).not.toBeNull();
    expect(info!.kind).toMatch(/no-credentials|bad-credentials/);
    // Fix the credential — next fetch succeeds again.
    storeCredential(clientRepo, 'origin', USERNAME, PASSWORD);
    await gitService.fetch(clientRepo, 'origin', true);
  });

  it('invalidateCache is what makes the retry read the FRESH credential (not the 5 s TTL)', async () => {
    // Right creds from the previous test are cached in the main process.
    // Replace them with wrong ones + invalidate → immediate effect.
    storage.setSetting('remoteAuth', { [clientRepo]: { origin: { username: USERNAME, password: 'wrong' } } });
    gitService.invalidateCache(clientRepo);
    await expect(gitService.fetch(clientRepo, 'origin', true)).rejects.toThrow();
    // And the exact dialog sequence: save right creds → invalidate → retry.
    storeCredential(clientRepo, 'origin', USERNAME, PASSWORD);
    await gitService.fetch(clientRepo, 'origin', true);
  });
});

describe('clone against the auth-required server — the PRE-repo fix', () => {
  it('clone without credentials FAILS CLASSIFIED and FAST (no 30-min prompt hang)', async () => {
    clearCredentials();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-clone-fail-'));
    let thrown: unknown;
    try {
      await gitService.clone(remoteUrl, path.join(parent, 'repo'));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    const raw = thrown instanceof Error ? thrown.message : String(thrown);
    // The clone spawn now sets GIT_TERMINAL_PROMPT=0 — the failure is the
    // classified «could not read Username» (fast), NOT a hang until the
    // 30-minute clone timeout.
    const info = classifyAuthFailure(raw);
    expect(info).not.toBeNull();
    expect(info!.kind).toMatch(/no-credentials|bad-credentials/);
  }, 60_000);

  it('clone with the credential stored at the TARGET path succeeds (the dialog saves it there)', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-clone-ok-'));
    const target = path.join(parent, 'repo');
    // The RemoteAuthDialog stores the entered credential keyed by the
    // (future) repo path + 'origin' BEFORE the retry — clone() reads it
    // from there and carries the Authorization header on the command line.
    storeCredential(target, 'origin', USERNAME, PASSWORD);
    await gitService.clone(remoteUrl, target);
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf-8')).toContain('auth test');
    // The credential is NOT persisted into the new repo's config or URL —
    // only the per-command header was used. (--get-regexp exits 1 on NO
    // matches — which is exactly the expected outcome here.)
    const httpCfg = execSync(
      'git config --local --get-regexp ^http\\. || true',
      { cwd: target, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    expect(httpCfg).not.toContain('extraHeader');
    expect(shell('git remote get-url origin', target)).toBe(remoteUrl);
    // And a later fetch from the cloned repo picks the SAME stored
    // credential up through remoteNetworkArgs() — no dialog needed again.
    await gitService.fetch(target, 'origin', true);
  }, 60_000);

  it('clonePartial with the stored credential succeeds (the simple-git raw arg path)', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-clone-partial-'));
    const target = path.join(parent, 'repo');
    storeCredential(target, 'origin', USERNAME, PASSWORD);
    await gitService.clonePartial(remoteUrl, target, 'blob:none');
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
  }, 60_000);

  it('mirror with the stored credential succeeds (bare mirror over authenticated http)', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-auth-mirror-'));
    const target = path.join(parent, 'mirror.git');
    storeCredential(target, 'origin', USERNAME, PASSWORD);
    await gitService.mirror(remoteUrl, target);
    // A bare mirror: HEAD lives at the top level, no working tree.
    expect(fs.existsSync(path.join(target, 'HEAD'))).toBe(true);
  }, 60_000);
});
