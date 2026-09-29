#!/usr/bin/env node
/**
 * PrismGit cross-platform packaging wrapper.
 *
 * Why this exists (every guard below reproduces a REAL failure we hit):
 *   - Vite 8 / Electron 44 require Node >= 22.12 — on older Node `vite build`
 *     dies with a cryptic `crypto.hash is not a function`. Detected here with
 *     a plain-English (and Russian) message instead.
 *   - `electron-builder` downloads Electron dist + tooling from github.com —
 *     on throttled/blocked networks the build hangs for minutes and fails.
 *     We probe the npmmirror CDN first and export ELECTRON_MIRROR /
 *     ELECTRON_BUILDER_BINARIES_MIRROR when it is reachable (user-set env
 *     always wins).
 *   - Building the Windows NSIS INSTALLER from Linux needs wine. The portable
 *     ZIP target does not. When wine is missing we loudly fall back to `zip`
 *     (explicit `nsis` still hard-fails so CI can't silently change shape).
 *
 * Usage (normally via package.json scripts):
 *   node scripts/run-pkg.mjs --check        # preflight only, builds nothing
 *   node scripts/run-pkg.mjs --linux        # AppImage + deb
 *   node scripts/run-pkg.mjs --win zip      # portable zip (no wine needed)
 *   node scripts/run-pkg.mjs --win nsis     # installer (wine on non-Windows)
 * Anything it does not understand is passed through to electron-builder.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON_BUILDER_CLI = resolve(ROOT, 'node_modules/electron-builder/cli.js');
const NPMMIRROR_ELECTRON = 'https://npmmirror.com/mirrors/electron/';
const NPMMIRROR_BUILDER = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const buildArgs = args.filter((a) => a !== '--check');

const log = (msg) => console.log(`[pkg] ${msg}`);
const warn = (msg) => console.warn(`[pkg] WARNING: ${msg}`);
const fail = (msg) => {
  console.error(`\n[pkg] ERROR: ${msg}\n`);
  process.exit(1);
};

// ---------------------------------------------------------------- 1. Node >= 22.12
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const nodeOk = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12);
if (!nodeOk) {
  fail(
    `Node.js >= 22.12.0 is required (Vite 8 + Electron 44), current: ${process.versions.node}.\n` +
      '       Fix: install Node 22 LTS or newer (https://nodejs.org), then re-run.\n' +
      '       (Node.js >= 22.12 обязателен — установите Node 22 LTS или новее и повторите.)'
  );
}

// ---------------------------------------------------------------- 2. build artifacts
const requiredFiles = [
  'dist/index.html',
  'dist-electron/main.js',
  'dist-electron/preload.js',
  'dist-electron/gitPollWorker.js',
  'build/icon.ico',
  'build/icons/256x256.png',
];
const missing = requiredFiles.filter((f) => !existsSync(resolve(ROOT, f)));
if (!CHECK_ONLY && missing.length > 0) {
  fail(
    `build output missing: ${missing.join(', ')}\n` +
      '       Run "npm run build" first (the package* scripts do it automatically).\n' +
      '       (Нет собранных файлов — сначала выполните "npm run build".)'
  );
}
if (!existsSync(ELECTRON_BUILDER_CLI)) {
  fail(
    'node_modules/electron-builder not found.\n' +
      '       Run "npm ci" (or "npm install") before packaging.\n' +
      '       (Не установлен electron-builder — сначала "npm ci".)'
  );
}

// ---------------------------------------------------------------- 3. target detection
const flag = (re) => buildArgs.some((a) => re.test(a));
const wantsWin = flag(/^-{1,2}win$|^-[wW]$/) || (!flag(/^-{1,2}(linux|mac)$|^-[lLmM]$/) && process.platform === 'win32');
const explicitTargets = buildArgs.filter((a) => /^(nsis|zip|dir|portable|appimage|deb|dmg)$/i.test(a));
const wantsInstaller = explicitTargets.some((t) => /^nsis$/i.test(t));
const wantsNoWineTarget = explicitTargets.some((t) => /^(zip|dir|portable)$/i.test(t));

// ---------------------------------------------------------------- 4. wine (win installer from non-Windows)
let finalArgs = buildArgs;
if (wantsWin && process.platform !== 'win32' && wantsInstaller === false && !wantsNoWineTarget) {
  // `--win` with no explicit target => electron-builder defaults to NSIS.
  const wineOk = spawnSync('wine', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!wineOk) {
    warn(
      'wine not found — the Windows NSIS INSTALLER cannot be built on Linux/macOS without it.\n' +
      '       Falling back to the portable ZIP target (same app, no installer wizard).\n' +
      '       Options: [1] keep the zip  [2] sudo apt install wine64  [3] build on a Windows machine.\n' +
      '       (Wine не найден — собираю портативный ZIP вместо NSIS-инсталлятора; для инсталлятора поставьте wine64.)'
    );
    finalArgs = [...buildArgs, 'zip'];
  }
} else if (wantsWin && process.platform !== 'win32' && wantsInstaller) {
  const wineOk = spawnSync('wine', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!wineOk) {
    fail(
      'target "nsis" on Linux/macOS requires wine (not found).\n' +
        '       Fix: sudo apt install wine64 — or use the no-wine portable zip: npm run package:win:zip\n' +
        '       (Для NSIS из Linux нужен wine; либо npm run package:win:zip — без wine.)'
    );
  }
}

// ---------------------------------------------------------------- 5. download mirrors
async function probe(url, timeoutMs = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: ac.signal });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const env = { ...process.env };
if (CHECK_ONLY || !process.env.ELECTRON_MIRROR) {
  const mirrorReachable = await probe(NPMMIRROR_ELECTRON);
  if (mirrorReachable) {
    env.ELECTRON_MIRROR ??= NPMMIRROR_ELECTRON;
    env.ELECTRON_BUILDER_BINARIES_MIRROR ??= NPMMIRROR_BUILDER;
    log(`download mirror: npmmirror (electron dist + builder tooling)`);
  } else {
    const ghReachable = await probe('https://github.com');
    if (!ghReachable) {
      warn(
        'neither npmmirror nor github.com is reachable — electron-builder will likely fail\n' +
          '       to download Electron. Check your network / proxy, or set ELECTRON_MIRROR manually.\n' +
          '(Нет доступа к источникам загрузки Electron — проверьте сеть или задайте ELECTRON_MIRROR.)'
      );
    } else {
      log('download mirror: github.com (default)');
    }
  }
}

// ---------------------------------------------------------------- 6. go / or stop at --check
if (CHECK_ONLY) {
  log(`preflight OK — node ${process.versions.node}, artifacts present, mirror probed`);
  process.exit(0);
}

log(`electron-builder ${finalArgs.join(' ') || '(host defaults)'}`);
const child = spawn(process.execPath, [ELECTRON_BUILDER_CLI, ...finalArgs], {
  stdio: 'inherit',
  env,
});
child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => fail(`failed to start electron-builder: ${err.message}`));
