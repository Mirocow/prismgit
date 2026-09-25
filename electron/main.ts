import { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage } from 'electron';
import * as path from 'path';
import { registerGitIpc } from './ipc/git.js';
import { registerFsIpc } from './ipc/fs.js';
import { registerGithubIpc } from './ipc/github.js';
import { registerGitlabIpc } from './ipc/gitlab.js';
import { registerAiIpc } from './ipc/ai.js';
import { registerWindowIpc } from './ipc/window.js';
import { registerSettingsIpc } from './ipc/settings.js';
import { registerCommandLogIpc } from './ipc/commandLog.js';
import { registerVscodeIpc } from './ipc/vscode.js';
import { registerSshIpc } from './ipc/ssh.js';
import { registerAvatarIpc } from './ipc/avatar.js';
import { cleanupTempCopies } from './services/vscode.js';
import { installGitCommandLogger } from './services/commandLog.js';
import { registerWatcherIpc, stopAllWatchers } from './services/watcher.js';
import { SimpleStore } from './services/simpleStore.js';
import { migratePlaintextSecrets, flushSettings, getSetting } from './services/storage.js';
import { windowBackgroundForTheme } from './services/themeDark.js';
import { migrateLegacyGithubToken, flushGithubStore } from './services/github.js';
import { migrateLegacyGitLabToken, flushGitlabStore } from './services/gitlab.js';
import { flushSecrets } from './services/secrets.js';
import { disposeGitPollWorkerAsync, hardKillGitPollWorkerNow } from './services/gitPollProcess.js';
import { buildAppMenu } from './menu.js';
import { setMenuLocale, normalizeMenuLocale } from './i18n-menu.js';
import { resolveResourceIcon } from './appIcons.js';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// Memory optimizations — applied BEFORE app.whenReady() so they take
// effect during Chromium init.
//
// `--max-old-space-size=512` caps the V8 old-generation heap to 512MB. Without
// this, the heap can balloon to several GB on long sessions (large diffs,
// multi-thousand-commit histories) before GC kicks in. 512MB is well above
// the steady-state working set (~150MB) but caps the worst-case spike.
// `--expose-gc` exposes `global.gc()` so we can force a collection after
// big operations (e.g. closing a repo, dropping a large diff) to return
// memory to the OS sooner rather than waiting for the next idle GC.
//
// Note: We do NOT add `disable-background-timer-throttling` — Chromium's
// default throttling of background tabs (~1Hz) is fine for a git client
// whose background work is mostly a 2-minute remote poll. Allowing the
// throttling saves CPU and battery when the user switches away.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512 --expose-gc');

// ── Suppress Chromium/Electron console errors ────────────────────────────
//
// PrismGit is a plain 2D UI (no WebGL, no GPU, no Autofill). The following
// switches eliminate ALL known Chromium noise that clutters stderr during
// `make dev` and production:
//
// 1. disableHardwareAcceleration() — kills EGL/GL driver errors:
//      "EGL Driver message (Error) eglQueryDeviceAttribEXT: Bad attribute."
//    (observed on Linux/NVIDIA and macOS/ANGLE)
//
// 2. --disable-features=AutofillServerCommunication — kills:
//      "Request Autofill.enable failed. 'Autofill.enable' wasn't found"
//      "Request Autofill.setAddresses failed. 'Autofill.setAddresses' wasn't found"
//    These appear when DevTools is open — Chromium DevTools tries to enable
//    the Autofill CDP domain, but Electron doesn't implement it. Disabling
//    the feature entirely prevents DevTools from even trying.
//
// 3. --disable-gpu / --disable-software-rasterizer — kills:
//      "SharedImageManager::ProduceMemory: Trying to Produce a Memory
//       representation from a non-existent mailbox."
//    These GPU compositing errors appear when DevTools opens/closes or
//    when a BrowserWindow is recreated. Disabling GPU compositing entirely
//    (we already use software rendering) prevents SharedImageManager from
//    being involved.
//
// 3b. --disable-gpu-compositing — Electron 32 (Chromium 128) STILL runs
//     the Viz display compositor's SharedImageManager for SOFTWARE frames,
//     so the mailbox message can leak through --disable-gpu alone (observed
//     2026-09 on window recreate / panel resize). The switch forces plain
//     software compositing end-to-end. Zero cost here: hardware
//     acceleration is already off, so no GPU-composited path existed.
//
// 4. --disable-dev-shm-usage — prevents /dev/shm exhaustion warnings on
//    Linux containers (Docker/CI). Forces Chromium to use /tmp instead.
//
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Translate,MediaRouter');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');

// Window state persistence
interface WindowState {
  bounds?: { x: number; y: number; width: number; height: number };
  isMaximized?: boolean;
  isFullScreen?: boolean;
}

const windowStateStore = new SimpleStore({
  name: 'prismgit-window-state',
  defaults: {},
});

// ── Quit-phase telemetry (PRISMGIT_QUIT_LOG=1) ────────────────────────────
// Wedged quits are reported as "при закрытии зависает" — this log pinpoints
// the phase that stalls. Timestamped ms since process start, one line per
// phase, zero cost when disabled.
const QUIT_LOG = !!process.env.PRISMGIT_QUIT_LOG;
export function qlog(msg: string): void {
  if (QUIT_LOG) console.log(`[quit +${Math.round(process.uptime() * 1000)}ms] ${msg}`);
}

// ── Main-loop lag telemetry (PRISMGIT_LOOP_LOG=1) ────────────────────────
// Samples the event loop every 5ms; any >25ms gap means the MAIN loop was
// blocked (repo-switch freeze triage — cross-reference with the switch
// timeline from scripts/repo-switch-profile.mjs). Zero cost when disabled.
if (process.env.PRISMGIT_LOOP_LOG) {
  let loopPrev = Date.now();
  setInterval(() => {
    const now = Date.now();
    const lag = now - loopPrev - 5;
    if (lag > 25) {
      console.log(`[loop ${now}] +${lag}ms block on main`);
    }
    loopPrev = now;
  }, 5);
}

let mainWindow: BrowserWindow | null = null;

// Command-log batch buffer (see installGitCommandLogger below).
// Module-scoped so `before-quit` can flush the pending batch.
let batchTimer: NodeJS.Timeout | null = null;
let batchedEntries: unknown[] = [];

function flushCommandLogBatch(): void {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (batchedEntries.length === 0) return;
  const batch = batchedEntries;
  batchedEntries = [];
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('command-log:batch', batch);
  }
}

function getWindowState(): WindowState {
  // Guard: mainWindow may be null OR already destroyed by the time the
  // 'close' / 'before-quit' event fires. Calling getBounds() on a
  // destroyed window throws "TypeError: Object has been destroyed".
  if (!mainWindow || mainWindow.isDestroyed()) return {};
  try {
    const bounds = mainWindow.getBounds();
    return {
      bounds,
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  } catch {
    // Window was destroyed between the isDestroyed() check and the
    // getBounds() call — return empty state (use defaults next launch).
    return {};
  }
}

function saveWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    windowStateStore.set('windowState', getWindowState());
  } catch {
    // Window destroyed between checks — ignore.
  }
}

function createWindow(): BrowserWindow {
  const savedState = (windowStateStore.get('windowState') || {}) as WindowState;
  const bounds = savedState.bounds || { width: 1440, height: 900, x: undefined, y: undefined };

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1024,
    minHeight: 640,
    // BUGFIX "тёмные темы не адаптированы": match the persisted theme so a
    // dark theme doesn't flash a white native window before the renderer
    // paints (the renderer keeps it in sync afterwards via
    // window:setBackgroundColor whenever the theme changes).
    backgroundColor: windowBackgroundForTheme(getSetting('theme') as string | undefined),
    frame: false,
    title: 'PrismGit',
    icon: resolveResourceIcon('icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
    show: false,
  });
  let shown = false;

  // Restore maximized/fullscreen state
  if (savedState.isMaximized) {
    win.maximize();
  }
  if (savedState.isFullScreen) {
    win.setFullScreen(true);
  }

  win.once('ready-to-show', () => {
    shown = true;
    win.show();
  });
  // Safety net: on some platforms/GPU paths 'ready-to-show' can be delayed
  // long after the page is actually usable (or never fire), leaving the user
  // with a running app but NO visible window — perceived as "the app opens
  // very slowly". Never wait more than 3s to become visible.
  setTimeout(() => {
    if (!shown && !win.isDestroyed()) {
      shown = true;
      win.show();
    }
  }, 3000);

  // Save window state on changes
  const saveDebounced = (() => {
    let timer: NodeJS.Timeout | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveWindowState();
        timer = null;
      }, 500);
    };
  })();

  win.on('resize', saveDebounced);
  win.on('move', saveDebounced);
  win.on('maximize', saveDebounced);
  win.on('unmaximize', saveDebounced);
  win.on('enter-full-screen', saveDebounced);
  win.on('leave-full-screen', saveDebounced);
  // ── Close deadline ──────────────────────────────────────────────────────
  // Chromium's graceful window close must handshake with the RENDERER's JS
  // thread (beforeunload handlers — e.g. the AI-chat history flush). When the
  // renderer is mid-longtask (a poll-burst re-render), that handshake stalls
  // for the WHOLE task — measured 5.9 s with a 6 s task, and user-reported as
  // "при закрытии приложение намертво зависает". Give the graceful path
  // CLOSE_DEADLINE_MS; if the window is still alive past it, destroy() it —
  // destroy bypasses the handshake. The flush only ever ran when the renderer
  // was responsive anyway, so nothing is lost in the pathological case.
  const CLOSE_DEADLINE_MS = 800;
  let closeDeadlineTimer: NodeJS.Timeout | null = null;

  win.on('close', () => {
    // Arm the ABSOLUTE quit bound FIRST — nothing below may leave it unarmed.
    // darwin: closing the window does NOT quit the app (it lives in the dock) —
    // the watchdog is only for real quits (before-quit covers menu/Cmd+Q).
    if (process.platform !== 'darwin') armQuitWatchdog('window close');
    qlog('main window close');
    try {
      saveWindowState();
    } catch {
      // Belt: saveWindowState is internally guarded, but a throw here would
      // historically have disarmed the close deadline below (the timer is
      // armed later in this handler) → unbounded renderer handshake.
      qlog('saveWindowState threw on close — ignored');
    }
    if (closeDeadlineTimer == null) {
      closeDeadlineTimer = setTimeout(() => {
        closeDeadlineTimer = null;
        if (!win.isDestroyed()) {
          qlog(`close deadline (${CLOSE_DEADLINE_MS}ms) hit — destroying window (renderer handshake stalled)`);
          win.destroy();
        }
      }, CLOSE_DEADLINE_MS);
      // The deadline timer must never keep the process alive on its own.
      closeDeadlineTimer.unref?.();
    }
  });
  win.on('closed', () => {
    if (closeDeadlineTimer != null) {
      clearTimeout(closeDeadlineTimer);
      closeDeadlineTimer = null;
    }
    qlog('main window closed');
    mainWindow = null;
    // The keep-alive About window can outlive the main window — on Windows /
    // Linux 'window-all-closed' would then never fire and the app would keep
    // running with no visible window. Quit explicitly, as before.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    // PERF (dev UX): do NOT auto-open DevTools on every `make dev`.
    // An attached DevTools window instruments the WHOLE renderer —
    // every event dispatch, style recalc and console message pays the
    // inspector tax, which was a large part of "интерфейс тупит" reports
    // from dev sessions. Use `make dev-debug` (DEBUG=1) or set
    // PRISMGIT_DEVTOOLS=1 when the DevTools window is actually needed.
    if (process.env.DEBUG || process.env.PRISMGIT_DEVTOOLS) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  return win;
}

// Context menu IPC
function registerContextMenuIpc() {
  ipcMain.handle('context-menu:show', async (_e, items: Array<{ label?: string; type?: 'separator' | 'normal' | 'checkbox' | 'radio'; checked?: boolean; enabled?: boolean; accelerator?: string; clickId?: string; title?: string; submenu?: any[] }>) => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const buildItem = (item: any): Electron.MenuItemConstructorOptions => ({
      label: item.label,
      type: item.type,
      checked: item.checked,
      enabled: item.enabled !== false,
      accelerator: item.accelerator,
      // Electron's Menu doesn't expose per-item tooltips on the renderer side,
      // so we fold `title` into the label as a subtle suffix when present.
      submenu: item.submenu ? item.submenu.map(buildItem) : undefined,
      click: () => {
        mainWindow?.webContents.send('context-menu:click', item.clickId);
      },
    });
    const menu = Menu.buildFromTemplate(items.map(buildItem));
    if (mainWindow && !mainWindow.isDestroyed()) {
      menu.popup({ window: mainWindow });
    }
    return true;
  });
}

app.whenReady().then(() => {
  // Menu language: OS locale until the renderer reports the user's choice
  // via 'app:setLocale' (Settings → Language). Rebuilds the menu on change.
  setMenuLocale(app.getLocale());
  ipcMain.on('app:setLocale', (_e, locale: string) => {
    const next = normalizeMenuLocale(locale);
    setMenuLocale(next);
    Menu.setApplicationMenu(buildAppMenu(() => mainWindow));
  });

  // Raw git command logger — MUST be installed before any IPC registration:
  // it wraps child_process.spawn so every git process spawned afterwards
  // (simple-git, push/pull helpers, background polls) is captured with its
  // full stdout/stderr and exit code for the Output panel's Commands tab.
  //
  // PERFORMANCE: on a busy repo (auto-fetch + watcher refresh + IDE auto-
  // save triggering watcher) we can see 50+ git spawns per second. Sending
  // an IPC broadcast per entry saturates the renderer's IPC queue. We now
  // batch entries 100 ms — the renderer still sees them appear in real-time
  // (100 ms is below human perception), but IPC traffic drops by ~10×.
  installGitCommandLogger({
    onEntry: (entry) => {
      batchedEntries.push(entry);
      if (batchTimer === null) {
        batchTimer = setTimeout(flushCommandLogBatch, 100);
      }
    },
  });

  // Register IPC handlers
  // Legacy secret migration FIRST — before any IPC handler can read or
  // write settings: plaintext tokens/passwords from old installs move into
  // the encrypted vault (OS keychain via safeStorage) and are stripped
  // from the JSON files. Both calls are idempotent.
  migratePlaintextSecrets();
  migrateLegacyGithubToken();
  migrateLegacyGitLabToken();

  registerGitIpc();
  registerFsIpc();
  registerGithubIpc();
  registerGitlabIpc();
  registerAiIpc();
  registerWindowIpc();
  registerSettingsIpc();
  registerCommandLogIpc();
  registerWatcherIpc();
  registerContextMenuIpc();
  registerVscodeIpc();
  registerSshIpc();
  registerAvatarIpc();
  // Stale VS Code temp copies (HEAD/stage snapshots for --diff/--merge) from
  // previous sessions — new ones are written on demand.
  cleanupTempCopies();

  // Build app menu
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow));

  mainWindow = createWindow();

  // ── Filter benign Chromium console messages ─────────────────────────────
  // Even with --disable-features and --disable-gpu, some Chromium internals
  // still log to the renderer console. These are caught here and suppressed
  // before they reach the DevTools console output.
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    // Suppress known-benign Chromium noise:
    //   - Autofill CDP errors (already disabled via --disable-features, but
    //     some Electron versions still log them)
    //   - SharedImageManager GPU errors (already disabled via --disable-gpu,
    //     but some Chromium versions still log them)
    //   - Deprecation warnings from Chromium internals
    //   - react-dom's dev-build "Download the React DevTools" banner — it
    //     prints on EVERY `make dev` session (React dev mode is inherent to
    //     the Vite dev server); suppressing it keeps the DevTools console
    //     signal-only. The banner is dev-only noise, never an app problem.
    const benign = /Autofill\.|SharedImageManager|ProduceMemory|non-existent mailbox|deprecated|Download the React DevTools/i;
    if (benign.test(message)) {
      _event.preventDefault();
    }
  });

  // SmartGit Manual: Command-Line Options
  // Parse process.argv for --open, --log, --blame, --anchor-commit, etc.
  handleCliArgs(process.argv.slice(1));

  app.on('activate', () => {
    // The keep-alive About window may keep getAllWindows() non-empty even
    // when the main window is gone — track the main window explicitly.
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Dock icon clicked: restore/focus the existing window.
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
    } else {
      mainWindow = createWindow();
    }
  });
});

/**
 * SmartGit Manual: Command-Line Options
 * Supported flags:
 *   --open <path>             Open repository at path
 *   --cwd <path>              Set current working directory (affects --log/--blame path resolution)
 *   --log <path>              Open History view for repository/file
 *   --blame <path>            Open Blame view for file (append :lineNumber to scroll)
 *   --anchor-commit=<sha>     Preselect commit in History/Blame view
 *   --investigate <path>      Open DeepGit-style investigation (History view with file filter)
 *
 * These flags send IPC events to the renderer, which handles navigation.
 */
function handleCliArgs(args: string[]) {
  if (!mainWindow) return;
  let cwd = '';
  let anchorCommit: string | undefined;
  // Parse all args first to find anchor-commit + cwd before navigation
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cwd' && args[i + 1]) {
      cwd = args[i + 1];
      i++;
    } else if (arg.startsWith('--anchor-commit=')) {
      anchorCommit = arg.substring('--anchor-commit='.length);
    }
  }

  // After the window is ready, send navigation commands
  mainWindow.webContents.once('did-finish-load', () => {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--open' && args[i + 1]) {
        const repoPath = args[i + 1];
        i++;
        mainWindow?.webContents.send('cli:open', { path: repoPath });
      } else if (arg === '--log' && args[i + 1]) {
        const target = args[i + 1];
        i++;
        // Resolve relative to --cwd if given
        const fullPath = cwd && !target.startsWith('/') ? `${cwd}/${target}`.replace(/\/+/g, '/') : target;
        mainWindow?.webContents.send('cli:log', { path: fullPath, anchorCommit });
      } else if (arg === '--blame' && args[i + 1]) {
        const target = args[i + 1];
        i++;
        // Optional :lineNumber suffix
        let line: number | undefined;
        let filePath = target;
        const colonIdx = target.lastIndexOf(':');
        if (colonIdx > 0) {
          const maybeLine = parseInt(target.substring(colonIdx + 1), 10);
          if (!isNaN(maybeLine) && maybeLine > 0) {
            line = maybeLine;
            filePath = target.substring(0, colonIdx);
          }
        }
        const fullPath = cwd && !filePath.startsWith('/') ? `${cwd}/${filePath}`.replace(/\/+/g, '/') : filePath;
        mainWindow?.webContents.send('cli:blame', { path: fullPath, line, anchorCommit });
      } else if (arg === '--investigate' && args[i + 1]) {
        const target = args[i + 1];
        i++;
        const fullPath = cwd && !target.startsWith('/') ? `${cwd}/${target}`.replace(/\/+/g, '/') : target;
        mainWindow?.webContents.send('cli:investigate', { path: fullPath, anchorCommit });
      }
    }
  });
}

app.on('window-all-closed', () => {
  qlog('window-all-closed');
  stopAllWatchers();
  if (process.platform !== 'darwin') {
    armQuitWatchdog('window-all-closed');
    qlog('window-all-closed → app.quit()');
    app.quit();
  }
});

app.on('will-quit', () => {
  qlog('will-quit');
});

app.on('quit', () => {
  qlog('quit (app lifecycle complete — process teardown next)');
});

process.on('exit', () => { qlog('process exit'); });
// beforeExit fires only if the loop drained without an explicit exit —
// for a wedged app this line NEVER appears, which is itself the diagnosis.
process.on('beforeExit', (code) => { qlog(`process beforeExit code=${code} (event loop drained)`); });

let quitDisposalComplete = false;

// ── Quit watchdog (v3.7) ───────────────────────────────────────────────────
// The user's «при закрытии приложения намертво зависает» could not be
// reproduced on any in-house fixture (prod/dev × repo open × hung fetch ×
// 24k files — every measured quit: 50–100 ms), which means their machine
// stalls somewhere our guards don't reach: an OS-level window-teardown stall,
// a store flush on a slow/AV-scanned disk, an exotic driver, or an older
// build. A bounded chain is only as strong as its weakest future regression,
// so the quit is now ABSOLUTELY bounded: the moment ANY quit/close is
// requested, a one-shot watchdog arms; if the whole graceful chain (renderer
// handshake ≤800 ms + worker disposal ≤530 ms + synchronous flushes) hasn't
// finished by QUIT_WATCHDOG_MS, it hard-kills the git worker and its
// reported children, best-effort-flushes the stores, and calls app.exit(0)
// — which bypasses EVERY remaining lifecycle handler and tears the process
// down immediately. Normal quits finish in ~100 ms and never see it fire.
const QUIT_WATCHDOG_MS = 3_000;
let quitWatchdogArmed = false;
function armQuitWatchdog(reason: string): void {
  if (quitWatchdogArmed) return;
  quitWatchdogArmed = true;
  qlog(`quit watchdog armed (${reason}) — hard exit in ≤${QUIT_WATCHDOG_MS} ms whatever happens`);
  const timer = setTimeout(() => {
    qlog('quit watchdog FIRED — the bounded quit chain failed somewhere; forcing app.exit(0)');
    try { hardKillGitPollWorkerNow(); } catch { /* already gone */ }
    try { stopAllWatchers(); } catch { /* ignore */ }
    try { flushCommandLogBatch(); } catch { /* ignore */ }
    try { flushSecrets(); } catch { /* ignore */ }
    try { flushSettings(); } catch { /* ignore */ }
    try { flushGithubStore(); } catch { /* ignore */ }
    try { flushGitlabStore(); } catch { /* ignore */ }
    try { windowStateStore.flush(); } catch { /* ignore */ }
    app.exit(0);
  }, QUIT_WATCHDOG_MS);
  // Never keep the process alive on its own — only the quit flow does that.
  timer.unref?.();
}

app.on('before-quit', (event) => {
  armQuitWatchdog('before-quit');

  // TEST HOOK (scripts/verify-quit-watchdog.mjs): park the quit FOREVER —
  // never re-quit, never flush. Reproduces a fully wedged quit chain; the
  // watchdog is the only way out. Must NEVER be set in production.
  if (process.env.PRISMGIT_QUIT_SIMULATE_WEDGE) {
    event.preventDefault();
    qlog('before-quit → SIMULATED WEDGE (test hook): quit parked forever, watchdog must fire');
    return;
  }

  // First pass: PARK the quit until the git worker is verifiably dead.
  // The old fire-and-forget dispose raced Electron's teardown: 'quit'
  // completed ~50 ms later, the utilityProcess died WITHOUT running its
  // kill-children handler, and in-flight `git fetch` chains were orphaned
  // (verified: hung remote-http helpers, ppid=1, alive for minutes after
  // the app closed — "после закрытия машина тормозит"). Parking costs at
  // most WORKER_SHUTDOWN_GRACE_MS (500 ms) and closes the race completely.
  if (quitDisposalComplete) return; // second (real) pass — let the quit run
  quitDisposalComplete = true;
  event.preventDefault();
  qlog('before-quit → parking quit for worker disposal');
  const t0 = Date.now();
  void disposeGitPollWorkerAsync()
    .catch(() => { /* disposal is best-effort; never block the quit */ })
    .finally(() => {
      qlog(`worker disposal complete (${Date.now() - t0} ms) — flushing and re-quitting`);
      stopAllWatchers();
      // Flush any pending command-log batch — otherwise the last 100 ms of
      // git commands would never reach the renderer's Output panel.
      flushCommandLogBatch();
      // Flush the debounced store writes — otherwise a quit within 100 ms of
      // any settings/repo/auth/secrets change could lose it. Each store's
      // writeNow() is synchronous (tmp-write + rename), so the app is
      // guaranteed to have flushed before the process exits.
      flushSecrets();
      flushSettings();
      flushGithubStore();
      flushGitlabStore();
      // The window-state store lives in this module — flush it too, even
      // though saveWindowState() schedules a debounced write above.
      windowStateStore.flush();
      qlog('before-quit flushes complete → app.quit() (second pass)');
      app.quit();
    });
});

// Expose dialog for renderer
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openRepository', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Repository',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:showSaveDialog', async (_event, opts: Electron.SaveDialogOptions) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, opts);
  if (result.canceled) return null;
  return result.filePath;
});

// Clipboard
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('app:getVersion', () => app.getVersion());
// Full version info for the About panel (Settings → About) — replaces the
// previously hardcoded "2.0.1" string that drifted from package.json.
ipcMain.handle('app:versions', () => ({
  app: app.getVersion(),
  electron: process.versions.electron || '',
  node: process.versions.node || '',
}));
ipcMain.handle('app:getPlatform', () => process.platform);
