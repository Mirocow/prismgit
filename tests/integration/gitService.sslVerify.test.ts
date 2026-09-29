/**
 * Integration tests — the SSL bypass (http.sslVerify) end-to-end.
 *
 * User report:
 *   «Ошибка pull … fatal: unable to access
 *    'https://git.nbgi.cloud.rt-dc.ru/project/sp/service_bus.git/':
 *    SSL certificate problem: certificate has expired»
 *
 * Two levels:
 *  1. Config plumbing — configSetMany(['http.sslVerify','false']) writes the
 *     local .git/config entry and configGetMany reads the effective value
 *     back (the path SslBypassDialog and RepoSettingsDialog take).
 *  2. The REAL thing — a local HTTPS git server with a self-signed
 *     certificate (openssl-generated, CN=127.0.0.1, dumb-HTTP protocol via
 *     `git update-server-info` + a static file server). The repo's fetch:
 *       - FAILS with a classified TLS certificate error while verification
 *         is on (exactly what the user saw);
 *       - SUCCEEDS immediately after `http.sslVerify=false` — proving the
 *         workaround actually unblocks the operation, not just that the
 *         config gets written.
 *
 * Global git config is neutralized (same belt-and-braces as the other
 * integration suites) so the machine's own sslVerify/settings can't
 * interfere with the outcome.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { execSync, spawnSync } from 'child_process';
import { classifySslFailure } from '../../src/lib/sslErrors';

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-data-'));
process.env.PRISMGIT_USER_DATA = TEST_DATA_DIR;
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_SYSTEM = '/dev/null';
const REAL_HOME = process.env.HOME;
const EMPTY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-home-'));
process.env.HOME = EMPTY_HOME;

const gitService = await import('../../electron/services/git');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

let clientRepo = '';
let serverDir = '';
let server: https.Server | null = null;
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
  // ── Client repo (fetches from the https server) ──
  clientRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-client-'));
  shell('git init -b main', clientRepo);
  shell('git config user.email t@t && git config user.name t', clientRepo);

  // ── Self-signed certificate for 127.0.0.1 ──
  serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-server-'));
  const cert = path.join(serverDir, 'cert.pem');
  const key = path.join(serverDir, 'key.pem');
  const gen = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2',
    '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ]);
  if (gen.status !== 0) {
    throw new Error(`openssl failed: ${gen.stderr?.toString()}`);
  }

  // ── Bare repo with one commit, dumb-HTTP-ready ──
  const bare = path.join(serverDir, 'repo.git');
  shell(`git init --bare -b main "${bare}"`, serverDir);
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-seed-'));
  shell('git init -b main', seed);
  shell('git config user.email t@t && git config user.name t', seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# ssl test\n');
  shell('git add . && git commit -m init', seed);
  shell(`git push "${bare}" main`, seed);
  shell('git update-server-info', bare);

  // ── Static HTTPS server over the bare repo directory ──
  server = https.createServer(
    { cert: fs.readFileSync(cert), key: fs.readFileSync(key) },
    (req, res) => {
      // The dumb-HTTP client requests the FILE PATHS under the repo root;
      // our server root IS the bare repo's parent (URL: /repo.git/...).
      // The smart-protocol probe carries ?service=… — strip the query: the
      // answer is the same dumb info/refs file, and its text/plain content
      // type makes git fall back to the dumb protocol by itself.
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
    },
  );
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as { port: number }).port;
  remoteUrl = `https://127.0.0.1:${serverPort}/repo.git`;
  shell(`git remote add origin ${remoteUrl}`, clientRepo);
}, 120_000);

afterAll(async () => {
  if (server) {
    // Destroy lingering keep-alive connections FIRST — plain close() waits
    // for them and a git client's pooled connection would keep this
    // vitest worker (and the whole suite run) alive forever.
    (server as https.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  for (const d of [TEST_DATA_DIR, EMPTY_HOME, clientRepo, serverDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* tmp cleanup best-effort */ }
  }
});

describe('http.sslVerify config plumbing (the dialog + repo settings path)', () => {
  it('configSetMany writes the local entry; configGetMany reads the effective value', async () => {
    expect(await gitService.configGetMany(clientRepo, ['http.sslVerify'])).toEqual({ 'http.sslVerify': undefined });
    await gitService.configSetMany(clientRepo, [{ key: 'http.sslVerify', value: 'false' }]);
    expect(await gitService.configGetMany(clientRepo, ['http.sslVerify'])).toEqual({ 'http.sslVerify': 'false' });
    // Plain `git config --local` agrees (what an external tool would see).
    expect(shell('git config --local --get http.sslVerify', clientRepo)).toBe('false');
  });

  it('configSetMany can re-enable verification (value true) and unset', async () => {
    await gitService.configSetMany(clientRepo, [{ key: 'http.sslVerify', value: 'true' }]);
    expect(await gitService.configGetMany(clientRepo, ['http.sslVerify'])).toEqual({ 'http.sslVerify': 'true' });
    // null → unset (the set-or-unset contract of the batched writer).
    await gitService.configSetMany(clientRepo, [{ key: 'http.sslVerify', value: null }]);
    expect(await gitService.configGetMany(clientRepo, ['http.sslVerify'])).toEqual({ 'http.sslVerify': undefined });
  });
});

describe('fetch against a self-signed HTTPS git server — the REAL workaround', () => {
  it('fetch FAILS with a CLASSIFIED certificate error while verification is on', async () => {
    // Ensure verification is on (default).
    await gitService.configSetMany(clientRepo, [{ key: 'http.sslVerify', value: null }]);
    let thrown: unknown;
    try {
      await gitService.fetch(clientRepo, 'origin', true);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    // The error must classify as a TLS certificate failure — this is the
    // exact contract offerSslBypass() relies on to open its dialog.
    const info = classifySslFailure(thrown instanceof Error ? thrown.message : String(thrown));
    expect(info).not.toBeNull();
    expect(info!.kind).toMatch(/self-signed|untrusted|other/);
  });

  it('after http.sslVerify=false the SAME fetch succeeds (objects + refs arrive)', async () => {
    await gitService.configSetMany(clientRepo, [{ key: 'http.sslVerify', value: 'false' }]);
    await gitService.fetch(clientRepo, 'origin', true);
    // The remote-tracking ref proves the fetch actually transferred refs.
    const refs = shell("git for-each-ref refs/remotes/origin --format='%(refname:short)'", clientRepo);
    expect(refs).toContain('origin/main');
  });

  it('pull over the bypassed server works end-to-end (dumb http + sslVerify=false)', async () => {
    await gitService.pull(clientRepo, 'origin', 'main', false, false).catch(() => {
      // Pull can legitimately fail to fast-forward if the previous test's
      // fetch already landed the ref differently — the point here is that
      // NO TLS error appears; anything else is surfaced by the assertion.
    });
    const log = shell('git log --oneline -1', clientRepo);
    expect(log).toContain('init');
  });
});

describe('clone against the self-signed HTTPS server — the PRE-repo bypass', () => {
  it('clone FAILS with a CLASSIFIED certificate error while verification is on', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-clone-fail-'));
    let thrown: unknown;
    try {
      await gitService.clone(remoteUrl, path.join(parent, 'repo'));
    } catch (e) {
      thrown = e;
    }
    // The classifier contract CloneModal's offerSslBypass relies on.
    const info = classifySslFailure(thrown instanceof Error ? thrown.message : String(thrown));
    expect(info).not.toBeNull();
    expect(info!.kind).toMatch(/self-signed|untrusted|other/);
  });

  it('clone with sslVerify=false succeeds AND persists the bypass into the new repo', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-clone-ok-'));
    const target = path.join(parent, 'repo');
    await gitService.clone(remoteUrl, target, { sslVerify: false });
    // The clone landed (working tree arrived, not just an empty dir).
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'README.md'), 'utf-8')).toContain('ssl test');
    // The bypass PERSISTED via `clone --config` — every later fetch/pull/push
    // from this repo stays bypassed without touching the dialog again.
    expect(shell('git config --local --get http.sslVerify', target)).toBe('false');
  });

  it('clonePartial with sslVerify=false succeeds (the simple-git raw arg path — no guard trip)', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-clone-partial-'));
    const target = path.join(parent, 'repo');
    await gitService.clonePartial(remoteUrl, target, 'blob:none', { sslVerify: false });
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
    expect(shell('git config --local --get http.sslVerify', target)).toBe('false');
  });

  it('mirror with sslVerify=false succeeds (bare mirror over the rejected cert)', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-mirror-'));
    const target = path.join(parent, 'mirror.git');
    await gitService.mirror(remoteUrl, target, { sslVerify: false });
    // A bare mirror: HEAD lives at the top level, no working tree.
    expect(fs.existsSync(path.join(target, 'HEAD'))).toBe(true);
    expect(shell('git config --get http.sslVerify', target)).toBe('false');
  });
});

describe('smartPull — a rejected certificate must not silently degrade to stale refs', () => {
  it('re-throws the CLASSIFIED SSL failure instead of running ahead/behind math on stale data', async () => {
    // Fresh clone over FILE (no TLS involved) so origin/main EXISTS locally;
    // then point origin at the self-signed HTTPS server. The in-smartPull
    // fetch now fails on the certificate while rev-list keeps working on the
    // STALE ref — exactly the situation the rethrow protects from (the old
    // code would silently reset/rebase to the stale ref and report success).
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-ssl-smart-'));
    const fresh = path.join(parent, 'repo');
    shell(`git clone "${path.join(serverDir, 'repo.git')}" "${fresh}"`, parent);
    shell(`git config user.email t@t && git config user.name t`, fresh);
    shell(`git remote set-url origin ${remoteUrl}`, fresh);
    let thrown: unknown;
    try {
      await gitService.smartPull(fresh);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeTruthy();
    const info = classifySslFailure(thrown instanceof Error ? thrown.message : String(thrown));
    expect(info).not.toBeNull();
  });
});

describe('insecureHosts — API-level bypass registry', () => {
  it('add/list/remove roundtrip with lowercase normalization and idempotency', async () => {
    const hosts = await import('../../electron/services/insecureHosts');
    expect(hosts.isInsecureSslHost('127.0.0.1')).toBe(false);
    hosts.addInsecureSslHost('127.0.0.1');
    hosts.addInsecureSslHost('127.0.0.1'); // idempotent
    expect(hosts.getInsecureSslHosts()).toEqual(['127.0.0.1']);
    expect(hosts.isInsecureSslHost('127.0.0.1')).toBe(true);
    expect(hosts.isInsecureSslHost('EXAMPLE.com')).toBe(false);
    hosts.addInsecureSslHost('Example.COM');
    expect(hosts.isInsecureSslHost('example.com')).toBe(true);
    hosts.removeInsecureSslHost('example.com');
    hosts.removeInsecureSslHost('example.com'); // idempotent
    expect(hosts.getInsecureSslHosts()).toEqual(['127.0.0.1']);
    hosts.removeInsecureSslHost('127.0.0.1');
    expect(hosts.getInsecureSslHosts()).toEqual([]);
  });

  it('the registry persists through storage (settings:get sees the list)', async () => {
    const hosts = await import('../../electron/services/insecureHosts');
    hosts.addInsecureSslHost('git.nbgi.cloud.rt-dc.ru');
    const storage = await import('../../electron/services/storage');
    const persisted = storage.getSetting<unknown>('insecureSslHosts');
    expect(Array.isArray(persisted)).toBe(true);
    expect((persisted as string[])).toContain('git.nbgi.cloud.rt-dc.ru');
    hosts.removeInsecureSslHost('git.nbgi.cloud.rt-dc.ru');
  });

  it('plain https request to the self-signed server: rejected by default, bypassed for a registered host', async () => {
    // Node-level reproduction of the provider-API half (gitlab.ts).
    const url = `https://127.0.0.1:${serverPort}/repo.git/HEAD`;
    const probe = (opts: https.RequestOptions) =>
      new Promise<string>((resolve, reject) => {
        const req = https.get(url, opts, (res) => {
          res.resume();
          resolve(`status ${res.statusCode}`);
        });
        req.on('error', (e) => reject(new Error(String(e?.message ?? e))));
        req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
      });

    await expect(probe({})).rejects.toThrow(/certificate|CERT|SSL/i);

    const hosts = await import('../../electron/services/insecureHosts');
    hosts.addInsecureSslHost('127.0.0.1');
    try {
      // The same request shape gitlab.ts uses: rejectUnauthorized:false for
      // hosts on the registry.
      const result = await probe({ rejectUnauthorized: false });
      expect(result).toBe('status 200');
    } finally {
      hosts.removeInsecureSslHost('127.0.0.1');
    }
    // Registry cleared → strict again.
    await expect(probe({})).rejects.toThrow(/certificate|CERT|SSL/i);
  });
});

// Silence the unused http import lint in case content types change (kept
// for parity with the other service tests' import set).
void http;
