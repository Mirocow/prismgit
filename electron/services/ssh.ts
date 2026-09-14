/**
 * SSH key management and per-command SSH transport for PrismGit.
 *
 * Scope (SmartGit-style):
 *  - generate Ed25519/RSA key pairs with ssh-keygen into the app-managed
 *    directory (userData/ssh-keys, dir 0700, private keys 0600)
 *  - import existing private keys (public side derived via `ssh-keygen -y`
 *    when no .pub file sits next to the source)
 *  - passphrases are stored in the encrypted vault (secrets.ts), NEVER in
 *    the settings JSON
 *  - network git commands (clone/fetch/pull/push/ls-remote) inject
 *    GIT_SSH_COMMAND with `-i <key> -o IdentitiesOnly=yes`; when the key has
 *    a passphrase an SSH_ASKPASS helper script (echo passphrase) is written
 *    to a temp file for the duration of the command and deleted afterwards
 *  - per-repository key override (Settings → sshRepoKeys), global default
 *    key (sshDefaultKeyId), StrictHostKeyChecking toggle
 *
 * When NO key is configured the env stays empty and git uses the user's own
 * ssh config/agent — the app never degrades existing CLI setups.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { getSetting, setSetting } from './storage.js';
import { getSecret, setSecret, deleteSecret } from './secrets.js';
import { NS_SSH, classifyRemoteUrl } from './credentialKeys.js';
import type { SshKeyMeta, SshTestResult, SshSystemKey, SshEnvResult } from '../types/ssh-api.js';

export type { SshEnvResult };

// ── Locations & binaries ─────────────────────────────────────────────────────

function sshKeysDir(): string {
  const base = process.env.PRISMGIT_USER_DATA || (app ? app.getPath('userData') : os.homedir());
  const dir = path.join(base, 'ssh-keys');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  }
  return dir;
}

function sshBinary(name: 'ssh' | 'ssh-keygen'): string {
  if (process.platform === 'win32') {
    const systemDir = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH');
    const candidate = path.join(systemDir, `${name}.exe`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name; // rely on PATH (macOS/Linux)
}

// ── Key registry (settings store — metadata only, non-secret) ────────────────

export function getSshKeys(): SshKeyMeta[] {
  return (getSetting('sshKeys') as SshKeyMeta[] | undefined) ?? [];
}

function saveSshKeys(keys: SshKeyMeta[]): void {
  setSetting('sshKeys', keys);
}

export function findSshKey(id: string | undefined): SshKeyMeta | undefined {
  if (!id) return undefined;
  return getSshKeys().find((k) => k.id === id);
}

/**
 * Resolve the key to use for a repository: per-repo override first, then the
 * global default. undefined → git falls back to the user's own ssh setup.
 */
export function resolveSshKeyForRepo(repoPath: string): SshKeyMeta | undefined {
  const perRepo = (getSetting('sshRepoKeys') as Record<string, string> | undefined)?.[repoPath];
  const defaultId = getSetting('sshDefaultKeyId') as string | undefined;
  return findSshKey(perRepo) ?? findSshKey(defaultId);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RunResult { code: number; stdout: string; stderr: string }

function run(cmd: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`${path.basename(cmd)} timed out after ${Math.round(opts.timeoutMs! / 1000)}s`));
        }, opts.timeoutMs)
      : null;
    if (timer) (timer as { unref?: () => void }).unref?.();
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function fingerprintOf(publicKeyPath: string): Promise<string | undefined> {
  try {
    const r = await run(sshBinary('ssh-keygen'), ['-lf', publicKeyPath], { timeoutMs: 10_000 });
    return r.stdout.trim().split('\n')[0] || undefined;
  } catch {
    return undefined;
  }
}

// ── Public API: key management ───────────────────────────────────────────────

export interface GenerateSshKeyOptions {
  label: string;
  comment?: string;
  type?: 'ed25519' | 'rsa';
  passphrase?: string;
}

export async function generateSshKey(options: GenerateSshKeyOptions): Promise<SshKeyMeta> {
  const type = options.type ?? 'ed25519';
  const label = (options.label || '').trim() || `SSH key ${new Date().toISOString().slice(0, 10)}`;
  const id = randomUUID().slice(0, 8);
  const privateKeyPath = path.join(sshKeysDir(), `id_${id}_${type}`);
  const args = ['-t', type, '-f', privateKeyPath, '-N', options.passphrase ?? '', '-C', options.comment?.trim() || label];
  if (type === 'rsa') args.push('-b', '4096');
  const r = await run(sshBinary('ssh-keygen'), args, { timeoutMs: 60_000 });
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || 'ssh-keygen failed');
  }
  restrictPermissions(privateKeyPath);
  const publicKeyPath = `${privateKeyPath}.pub`;
  const publicKey = fs.existsSync(publicKeyPath) ? fs.readFileSync(publicKeyPath, 'utf8').trim() : undefined;
  const fingerprint = publicKeyPath ? await fingerprintOf(publicKeyPath) : undefined;

  const meta: SshKeyMeta = {
    id,
    label,
    privateKeyPath,
    publicKeyPath,
    publicKey,
    fingerprint,
    comment: options.comment?.trim() || undefined,
    type,
    addedAt: Date.now(),
    hasPassphrase: !!options.passphrase,
    managed: true,
  };
  if (options.passphrase) setSecret(NS_SSH, `pass:${id}`, options.passphrase);
  const keys = getSshKeys();
  keys.push(meta);
  saveSshKeys(keys);
  return meta;
}

export interface ImportSshKeyOptions {
  label: string;
  sourcePath: string;
  passphrase?: string;
}

/**
 * Import an existing private key. The key is COPIED into the app-managed
 * directory (the original file stays untouched); when the source has no
 * .pub sidecar the public key is derived with `ssh-keygen -y` — which for a
 * passphrase-protected key needs the passphrase (passed via askpass env).
 */
export async function importSshKey(options: ImportSshKeyOptions): Promise<SshKeyMeta> {
  const sourcePath = (options.sourcePath || '').trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Private key file not found: ${sourcePath}`);
  }
  const label = (options.label || '').trim() || path.basename(sourcePath);
  const id = randomUUID().slice(0, 8);
  const privateKeyPath = path.join(sshKeysDir(), `id_${id}_imported`);
  fs.copyFileSync(sourcePath, privateKeyPath);
  restrictPermissions(privateKeyPath);

  const sourcePub = `${sourcePath}.pub`;
  const publicKeyPath = `${privateKeyPath}.pub`;
  let publicKey: string | undefined;
  if (fs.existsSync(sourcePub)) {
    fs.copyFileSync(sourcePub, publicKeyPath);
    publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
  } else {
    // Derive the public key — needs the passphrase when the key is encrypted.
    const pub = await derivePublicFromPrivateWithPassphrase(privateKeyPath, options.passphrase ?? '', label);
    fs.writeFileSync(publicKeyPath, `${pub}\n`, { mode: 0o644 });
    publicKey = pub;
  }
  const fingerprint = await fingerprintOf(publicKeyPath);

  const meta: SshKeyMeta = {
    id,
    label,
    privateKeyPath,
    publicKeyPath,
    publicKey,
    fingerprint,
    type: publicKey?.includes(' ssh-rsa ') ? 'rsa' : 'ed25519',
    addedAt: Date.now(),
    hasPassphrase: !!options.passphrase,
    managed: true,
  };
  if (options.passphrase) setSecret(NS_SSH, `pass:${id}`, options.passphrase);
  const keys = getSshKeys();
  keys.push(meta);
  saveSshKeys(keys);
  return meta;
}

async function derivePublicFromPrivateWithPassphrase(
  privateKeyPath: string,
  passphrase: string,
  comment: string
): Promise<string> {
  const env: NodeJS.ProcessEnv = passphrase ? makeAskpassEnv(passphrase).env : {};
  try {
    const r = await run(sshBinary('ssh-keygen'), ['-y', privateKeyPath], { timeoutMs: 15_000, env });
    if (r.code !== 0 || !r.stdout.trim()) {
      throw new Error(
        r.stderr.trim() ||
        (passphrase ? '' : 'Key is passphrase-protected — enter its passphrase to import.')
      );
    }
    return `${r.stdout.trim()} ${comment}`;
  } finally {
    cleanupAskpassEnv(env);
  }
}

export async function deleteSshKey(id: string): Promise<void> {
  const keys = getSshKeys();
  const meta = keys.find((k) => k.id === id);
  if (meta) {
    for (const f of [meta.privateKeyPath, meta.publicKeyPath]) {
      if (f) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
    }
    deleteSecret(NS_SSH, `pass:${id}`);
  }
  const rest = keys.filter((k) => k.id !== id);
  saveSshKeys(rest);
  // Clear references
  if ((getSetting('sshDefaultKeyId') as string | undefined) === id) setSetting('sshDefaultKeyId', undefined);
  const repoKeys = (getSetting('sshRepoKeys') as Record<string, string> | undefined) ?? {};
  if (Object.values(repoKeys).includes(id)) {
    const cleaned = Object.fromEntries(Object.entries(repoKeys).filter(([, v]) => v !== id));
    setSetting('sshRepoKeys', cleaned);
  }
}

export function getPublicKeyText(id: string): string {
  const meta = findSshKey(id);
  if (!meta) throw new Error(`SSH key not found: ${id}`);
  if (meta.publicKey) return meta.publicKey;
  if (meta.publicKeyPath && fs.existsSync(meta.publicKeyPath)) {
    return fs.readFileSync(meta.publicKeyPath, 'utf8').trim();
  }
  throw new Error('Public key file is missing');
}

export function listSystemPublicKeys(): SshSystemKey[] {
  const sshDir = path.join(os.homedir(), '.ssh');
  try {
    return fs
      .readdirSync(sshDir)
      .filter((f) => f.endsWith('.pub'))
      .map((f) => ({
        path: path.join(sshDir, f),
        label: f.replace(/\.pub$/, ''),
        privateKeyPath: path.join(sshDir, f.replace(/\.pub$/, '')),
        existsPrivate: fs.existsSync(path.join(sshDir, f.replace(/\.pub$/, ''))),
      }));
  } catch {
    return [];
  }
}

// ── Public API: connectivity test ────────────────────────────────────────────

/**
 * Try `ssh -T <user>@<host>` with the key. Most git servers answer success
 * with exit code 1 ("Hi <user>! You've successfully authenticated"), so the
 * heuristic checks the output text, not just the exit code.
 */
export async function testSshKey(
  id: string,
  opts: { host?: string; user?: string } = {}
): Promise<SshTestResult> {
  const meta = findSshKey(id);
  if (!meta) throw new Error(`SSH key not found: ${id}`);
  const host = opts.host?.trim() || 'github.com';
  const user = opts.user?.trim() || 'git';
  const passphrase = meta.hasPassphrase ? getSecret(NS_SSH, `pass:${id}`) : undefined;
  const env: NodeJS.ProcessEnv = passphrase ? makeAskpassEnv(passphrase).env : {};
  try {
    const r = await run(
      sshBinary('ssh'),
      [
        '-i', meta.privateKeyPath,
        '-o', 'IdentitiesOnly=yes',
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-T',
        `${user}@${host}`,
      ],
      { timeoutMs: 20_000, env }
    );
    const output = `${r.stderr}\n${r.stdout}`.trim();
    const ok = r.code === 0 || /successfully authenticated|Hi \S+!|Welcome to GitLab/i.test(output);
    return { ok, output };
  } finally {
    cleanupAskpassEnv(env);
  }
}

// ── Per-command environment for network git commands ─────────────────────────

const NO_SSH: SshEnvResult = { env: {}, cleanup: () => {} };

/**
 * Build the SSH environment for ONE network git command.
 *
 * Returns NO_SSH for non-SSH URLs or when the user has not picked a key —
 * in that case git keeps using the system ssh/agent untouched.
 */
export function buildSshEnv(url: string | undefined | null, repoPath: string): SshEnvResult {
  if (classifyRemoteUrl(url) !== 'ssh') return NO_SSH;
  const meta = resolveSshKeyForRepo(repoPath);
  if (!meta || !fs.existsSync(meta.privateKeyPath)) return NO_SSH;

  const strict = (getSetting('sshStrictHostKeyChecking') as boolean | undefined) === true ? 'yes' : 'accept-new';
  const sshCommand = [
    'ssh',
    '-i', quoteShell(meta.privateKeyPath),
    '-o', 'IdentitiesOnly=yes',
    '-o', `StrictHostKeyChecking=${strict}`,
  ].join(' ');

  const env: Record<string, string> = { GIT_SSH_COMMAND: sshCommand };
  const passphrase = meta.hasPassphrase ? getSecret(NS_SSH, `pass:${meta.id}`) : undefined;
  const askpass = passphrase ? makeAskpassEnv(passphrase) : null;
  if (askpass) Object.assign(env, askpass.env);

  return {
    env,
    cleanup: () => askpass?.cleanup(),
    usedKeyId: meta.id,
  };
}

// ── Askpass plumbing ─────────────────────────────────────────────────────────

interface Askpass { env: NodeJS.ProcessEnv; cleanup: () => void }

/**
 * Write a temp askpass script that echoes the passphrase. Requires
 * OpenSSH 8.4+ (`SSH_ASKPASS_REQUIRE=force`) — older ssh builds fall back
 * to prompting, which fails in non-interactive mode with a clear error.
 */
function makeAskpassEnv(passphrase: string): Askpass {
  const isWin = process.platform === 'win32';
  const file = path.join(os.tmpdir(), `prismgit-askpass-${randomUUID().slice(0, 8)}${isWin ? '.cmd' : '.sh'}`);
  const safe = passphrase.replace(/'/g, `'\\''`).replace(/[\r\n]/g, '');
  if (isWin) {
    // Win32-OpenSSH runs .cmd askpass via cmd.exe.
    fs.writeFileSync(file, `@echo off\r\necho ${passphrase.replace(/[%^&|<>]/g, '^$&')}\r\n`);
  } else {
    fs.writeFileSync(file, `#!/bin/sh\necho '${safe}'\n`, { mode: 0o700 });
    try { fs.chmodSync(file, 0o700); } catch { /* best effort */ }
  }
  return {
    env: {
      SSH_ASKPASS: file,
      SSH_ASKPASS_REQUIRE: 'force',
      // Some ssh builds only honor SSH_ASKPASS when a DISPLAY exists.
      DISPLAY: process.env.DISPLAY || 'dummy:0',
      GIT_TERMINAL_PROMPT: '0',
    },
    cleanup: () => { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } },
  };
}

function cleanupAskpassEnv(env: NodeJS.ProcessEnv): void {
  const file = env?.SSH_ASKPASS;
  if (file) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
}

function restrictPermissions(filePath: string): void {
  if (process.platform !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
  }
}
