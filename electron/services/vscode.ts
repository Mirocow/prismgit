/**
 * VSCode integration service (main process).
 * ===========================================
 *
 * Deep integration between PrismGit and Visual Studio Code:
 *
 *   1. Binary detection — platform-specific install paths + PATH lookup,
 *      verified by running `<bin> --version` (5s timeout).
 *   2. Open folder / file (optionally at a line) — prefers the `code` CLI,
 *      falls back to the official `vscode://file/...` URI scheme so opens
 *      still work when the CLI is not on PATH.
 *   3. Diff against HEAD — writes the HEAD blob to a temp file and opens
 *      `code --wait --diff <HEAD-copy> <working-tree-file>`.
 *   4. Three-way merge — materializes stages :1/:2/:3 into temp files and
 *      opens `code --wait --merge <theirs> <ours> <base> <result>` (the same
 *      command layout VS Code's own mergetool registration uses).
 *   5. Register VS Code as the repo's git difftool/mergetool — writes the
 *      [diff "vscode"] / [merge "vscode"] sections into the LOCAL git config.
 *
 * Windows note: since Node 18, `.cmd` shims cannot be spawned without a
 * shell. We build a single quoted command line and run it through
 * `cmd.exe /d /s /c` with windowsVerbatimArguments (paths are quoted by us,
 * Node must not re-quote).
 */
import { spawn, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import simpleGit, { type SimpleGit } from 'simple-git';
import { getSetting } from './storage.js';

export interface VsCodeDetection {
  available: boolean;
  /** How the binary was found (custom = user-configured path). */
  source: 'custom' | 'platform' | 'path' | 'none';
  /** Absolute path of the CLI binary (empty when not available). */
  path: string;
  /** Version reported by `code --version` (first line). */
  version: string;
}

const VERSION_TIMEOUT_MS = 5000;

/** Platform-specific CLI candidates, most likely first. */
function platformCandidates(): string[] {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        `${home}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
        '/Applications/VSCodium.app/Contents/Resources/app/bin/codium',
      ];
    case 'win32': {
      const localAppData = process.env.LOCALAPPDATA || `${home}/AppData/Local`;
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      return [
        `${localAppData}\\Programs\\Microsoft VS Code\\bin\\code.cmd`,
        `${localAppData}\\Programs\\Microsoft VS Code Insiders\\bin\\code-insiders.cmd`,
        `${localAppData}\\Programs\\VSCodium\\bin\\codium.cmd`,
        `${programFiles}\\Microsoft VS Code\\bin\\code.cmd`,
        `${programFilesX86}\\Microsoft VS Code\\bin\\code.cmd`,
      ];
    }
    default:
      return ['/usr/bin/code', '/usr/bin/code-insiders', '/snap/bin/code', '/usr/local/bin/code'];
  }
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Look the binary up in PATH (which/where) — best effort. */
function findOnPath(): Promise<string> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execFile(cmd, ['code'], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve('');
      const first = String(stdout).split(/\r?\n/).find((l) => l.trim().length > 0);
      resolve(first ? first.trim() : '');
    });
  });
}

/** Run `<bin> --version`; resolves to the first output line or ''. */
function queryVersion(bin: string): Promise<string> {
  return new Promise((resolve) => {
    const done = (v: string) => resolve(v);
    try {
      if (process.platform === 'win32') {
        // .cmd shims must go through cmd.exe (see file header).
        const cmdline = `"${bin}" --version`;
        const child = spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', cmdline], {
          windowsVerbatimArguments: true,
          windowsHide: true,
        });
        let out = '';
        const timer = setTimeout(() => { child.kill(); done(''); }, VERSION_TIMEOUT_MS);
        child.stdout.on('data', (d) => { out += String(d); });
        child.on('error', () => { clearTimeout(timer); done(''); });
        child.on('close', (code) => { clearTimeout(timer); done(code === 0 ? out.split(/\r?\n/)[0] || '' : ''); });
      } else {
        execFile(bin, ['--version'], { timeout: VERSION_TIMEOUT_MS }, (err, stdout) => {
          done(err ? '' : String(stdout).split(/\r?\n/)[0] || '');
        });
      }
    } catch {
      done('');
    }
  });
}

/** Detect VS Code: custom path (setting) → platform paths → PATH. */
export async function detectVsCode(): Promise<VsCodeDetection> {
  const custom = (getSetting<string>('vscodePath') || '').trim();
  const candidates: Array<{ p: string; source: VsCodeDetection['source'] }> = [];
  if (custom) candidates.push({ p: custom, source: 'custom' });
  for (const p of platformCandidates()) candidates.push({ p, source: 'platform' });

  for (const { p, source } of candidates) {
    if (p && isExecutable(p)) {
      const version = await queryVersion(p);
      if (version) return { available: true, source, path: p, version };
    }
  }
  const onPath = await findOnPath();
  if (onPath && isExecutable(onPath)) {
    const version = await queryVersion(onPath);
    if (version) return { available: true, source: 'path', path: onPath, version };
  }
  return { available: false, source: 'none', path: '', version: '' };
}

/** Cached detection (refreshed by vscode:detect force=true). */
let cachedDetection: VsCodeDetection | null = null;
export async function detectVsCodeCached(force = false): Promise<VsCodeDetection> {
  if (!cachedDetection || force) cachedDetection = await detectVsCode();
  return cachedDetection;
}

// ---------------------------------------------------------------- spawn ----

/** Fire-and-forget spawn of the VS Code CLI. Rejects when spawn fails. */
function spawnCli(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (process.platform === 'win32') {
        const quoted = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
        const cmdline = `"${bin}" ${quoted}`;
        const child = spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', cmdline], {
          windowsVerbatimArguments: true,
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        });
        child.on('error', reject);
        child.on('spawn', () => { child.unref(); resolve(); });
      } else {
        const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
        child.on('error', reject);
        child.on('spawn', () => { child.unref(); resolve(); });
      }
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Official vscode:// URI fallback (works whenever VS Code registered it). */
async function openViaUri(target: string): Promise<void> {
  const { shell } = await import('electron');
  await shell.openExternal(`vscode://file/${target.replace(/^\/+/, '')}`);
}

// ------------------------------------------------------------ temp files ----

/** Stable temp dir per repo (content overwritten per invocation). */
function vscodeTempDir(repoPath: string): string {
  const hash = crypto.createHash('sha1').update(repoPath).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), 'prismgit-vscode', hash);
}

/** Best-effort cleanup of stale temp copies from previous sessions. */
export function cleanupTempCopies(): void {
  try {
    fs.rmSync(path.join(os.tmpdir(), 'prismgit-vscode'), { recursive: true, force: true });
  } catch { /* ignore */ }
}

function tempCopy(repoPath: string, relFile: string, prefix: string, content: string | Buffer): string {
  const dir = vscodeTempDir(repoPath);
  fs.mkdirSync(dir, { recursive: true });
  const flat = relFile.replace(/[\\/]+/g, '__');
  const target = path.join(dir, `${prefix}__${flat}`);
  fs.writeFileSync(target, content);
  return target;
}

// -------------------------------------------------------------- opens ------

export interface OpenTarget {
  file?: string;
  line?: number;
}

/** Open the repo folder (or a file within it, optionally at a line) in VS Code. */
export async function openInVsCode(repoPath: string, target?: OpenTarget): Promise<{ ok: boolean; via: 'cli' | 'uri' | 'none' }> {
  const det = await detectVsCodeCached();
  if (det.available) {
    const args: string[] = [];
    if (target?.file) {
      const abs = path.join(repoPath, target.file);
      // `-g file:line` (goto) opens the file and focuses it.
      args.push('-g', target?.line && target.line > 0 ? `${abs}:${target.line}` : abs);
    } else {
      args.push(repoPath);
    }
    try {
      await spawnCli(det.path, args);
      return { ok: true, via: 'cli' };
    } catch {
      // fall through to URI
    }
  }
  if (target?.file) {
    const abs = path.join(repoPath, target.file);
    await openViaUri(target.line && target.line > 0 ? `${abs}:${target.line}` : abs);
  } else {
    await openViaUri(repoPath);
  }
  return { ok: true, via: 'uri' };
}

/**
 * Open a working-tree file diffed against its HEAD version in VS Code
 * (`code --wait --diff <HEAD-copy> <working-tree>`).
 */
export async function openFileDiffVsHead(
  git: SimpleGit,
  repoPath: string,
  file: string
): Promise<{ ok: boolean; detail?: string }> {
  const det = await detectVsCodeCached();
  if (!det.available) {
    return { ok: false, detail: 'VS Code CLI not found — install VS Code or set its path in Settings → External Tools' };
  }
  let headContent: Buffer;
  try {
    headContent = await git.showBuffer(`HEAD:${file}`);
  } catch {
    return { ok: false, detail: `File '${file}' has no HEAD version (untracked or new file)` };
  }
  const headCopy = tempCopy(repoPath, file, 'HEAD', headContent);
  const worktree = path.join(repoPath, file);
  try {
    await spawnCli(det.path, ['--wait', '--diff', headCopy, worktree]);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Open the three-way merge editor in VS Code for a conflicted file
 * (`code --wait --merge <theirs> <ours> <base> <result>`).
 */
export async function openMergeInVsCode(
  git: SimpleGit,
  repoPath: string,
  file: string
): Promise<{ ok: boolean; detail?: string }> {
  const det = await detectVsCodeCached();
  if (!det.available) {
    return { ok: false, detail: 'VS Code CLI not found — install VS Code or set its path in Settings → External Tools' };
  }
  const stages: Array<[string, string]> = [
    ['2', 'OURS'], ['3', 'THEIRS'], ['1', 'BASE'],
  ];
  const temps: string[] = [];
  try {
    for (const [stage, prefix] of stages) {
      const content = await git.showBuffer(`:${stage}:${file}`);
      temps.push(tempCopy(repoPath, file, prefix, content));
    }
  } catch {
    // A stage may legitimately be missing (add/add has no base) — fall back
    // to whatever we have; --merge accepts fewer inputs than 3.
    if (temps.length === 0) {
      return { ok: false, detail: `Could not read conflict stages of '${file}'` };
    }
  }
  const result = path.join(repoPath, file);
  const [ours, theirs, base] = [temps[0], temps[1], temps[2]];
  const args = ['--wait', '--merge'];
  // VS Code signature: --merge <path1=path2 base result> — theirs, ours, base, result.
  if (theirs && ours) args.push(theirs, ours);
  else if (ours) args.push(ours);
  else if (theirs) args.push(theirs);
  if (base) args.push(base);
  args.push(result);
  try {
    await spawnCli(det.path, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ------------------------------------------------- git difftool/mergetool ----

export interface DiffToolStatus {
  diffTool: string;
  mergeTool: string;
  vscodeConfigured: boolean;
}

function gitFor(repoPath: string): SimpleGit {
  return simpleGit(repoPath);
}

export async function getDiffToolStatus(repoPath: string): Promise<DiffToolStatus> {
  const git = gitFor(repoPath);
  const read = async (key: string): Promise<string> => {
    try {
      const v = await git.raw(['config', '--local', '--get', key]);
      return v.trim();
    } catch {
      return '';
    }
  };
  const diffTool = await read('diff.tool');
  const mergeTool = await read('merge.tool');
  return { diffTool, mergeTool, vscodeConfigured: diffTool === 'vscode' || mergeTool === 'vscode' };
}

export async function installVsCodeDiffMergeTool(repoPath: string): Promise<{ ok: boolean; detail?: string }> {
  const det = await detectVsCodeCached();
  if (!det.available) {
    return { ok: false, detail: 'VS Code CLI not found — install VS Code or set its path in Settings → External Tools' };
  }
  const git = gitFor(repoPath);
  const bin = det.path;
  try {
    // Quote the binary path so git's shell invocation survives spaces
    // (macOS "/Applications/Visual Studio Code.app/...", Windows .cmd paths).
    const q = process.platform === 'win32' ? (p: string) => `"${p}"` : (p: string) => `'${p}'`;
    await git.raw(['config', '--local', 'diff.tool', 'vscode']);
    await git.raw(['config', '--local', 'difftool.vscode.cmd', `${q(bin)} --wait --diff "$LOCAL" "$REMOTE"`]);
    await git.raw(['config', '--local', 'merge.tool', 'vscode']);
    await git.raw(['config', '--local', 'mergetool.vscode.cmd', `${q(bin)} --wait --merge "$REMOTE" "$LOCAL" "$BASE" "$MERGED"`]);
    await git.raw(['config', '--local', 'mergetool.vscode.trustExitCode', 'true']);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function removeVsCodeDiffMergeTool(repoPath: string): Promise<{ ok: boolean; detail?: string }> {
  const git = gitFor(repoPath);
  try {
    const unset = async (key: string) => {
      try { await git.raw(['config', '--local', '--unset', key]); } catch { /* not set */ }
    };
    await unset('diff.tool');
    await unset('merge.tool');
    try { await git.raw(['config', '--local', '--remove-section', 'difftool.vscode']); } catch { /* not set */ }
    try { await git.raw(['config', '--local', '--remove-section', 'mergetool.vscode']); } catch { /* not set */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
