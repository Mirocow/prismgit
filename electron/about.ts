/**
 * About window — a rich, informative replacement for the old plain
 * dialog.showMessageBox About popup.
 *
 * Shows: logo, app version, build date, Electron/Chromium/Node/V8 versions,
 * OS/platform info, locale, first-launch date, feature list, project links
 * and a one-click "Copy System Info" button.
 */

import { app, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import {
  ABOUT_LICENSE,
  ABOUT_REPOSITORY_URL,
  buildAboutHtml,
  type AboutInfo,
} from './aboutInfo.js';
import { resolveResourceIcon } from './appIcons.js';
import { SimpleStore } from './services/simpleStore.js';
// Baked into the main bundle at build time. app.getName()/getVersion() are
// unreliable: when Electron is launched against a bare main.js (e2e, some
// dev flows) it cannot find package.json and reports "Electron" / the
// Electron runtime version instead of the app's identity.
import pkg from '../package.json';

// Baked at build time by vite define (see vite.config.ts → main.vite.define).
declare const __BUILD_DATE__: string;

let aboutWindow: BrowserWindow | null = null;
let metaStore: SimpleStore | null = null;

/**
 * Keep-alive: closing the About window hides it instead of destroying it, so
 * reopening is instant (no window creation, HTML build, data: URL load or
 * first paint — all of which the user previously waited for on EVERY open).
 * The flag below lets real app shutdown close it for good.
 */
let appQuitting = false;
app.on('before-quit', () => {
  appQuitting = true;
});

/**
 * True while the keep-alive window is hidden after an explicit close.
 * Guards against a late 'ready-to-show' racing with keep-alive hide: if the
 * user closes the About window before the first paint finished, the pending
 * ready-to-show callback must NOT re-show it (it would un-hide a window the
 * user just closed).
 */
let aboutKeepAliveHidden = false;

function getMetaStore(): SimpleStore {
  if (!metaStore) {
    metaStore = new SimpleStore({ name: 'prismgit-app-meta', defaults: {} });
  }
  return metaStore;
}

/** ISO date of the very first launch — persisted once, shown in About. */
function getFirstLaunchAt(): string {
  const store = getMetaStore();
  const existing = store.get<string>('firstLaunchAt');
  if (existing) return existing;
  const now = new Date().toISOString();
  store.set('firstLaunchAt', now);
  return now;
}

function collectAboutInfo(): AboutInfo {
  const versions = process.versions;
  return {
    name: pkg.productName || pkg.name || 'PrismGit',
    version: pkg.version,
    buildDate: typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : new Date().toISOString(),
    electron: versions.electron || 'unknown',
    chrome: versions.chrome || 'unknown',
    node: versions.node || 'unknown',
    v8: versions.v8 || 'unknown',
    osType: os.type(),
    osRelease: os.release(),
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    firstLaunch: getFirstLaunchAt(),
    repositoryUrl: ABOUT_REPOSITORY_URL,
    license: ABOUT_LICENSE,
  };
}

/** Read the bundled 256px logo as a data: URI for embedding into the page. */
function readLogoDataUri(): string {
  try {
    const logoPath = resolveResourceIcon('logo-256.png');
    const buf = fs.readFileSync(logoPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * Open the About window (singleton — focusing the existing instance instead
 * of spawning duplicates). Safe to call from menu items on any platform.
 */
export function openAboutWindow(): BrowserWindow {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutKeepAliveHidden = false; // rearm the late ready-to-show guard
    aboutWindow.show();
    aboutWindow.focus();
    return aboutWindow;
  }

  const info = collectAboutInfo();
  const html = buildAboutHtml(info, { logoSrc: readLogoDataUri() });

  const win = new BrowserWindow({
    width: 540,
    height: 620,
    minWidth: 460,
    minHeight: 640,
    title: 'About PrismGit',
    backgroundColor: '#1f2430',
    autoHideMenuBar: true,
    resizable: true,
    icon: resolveResourceIcon('icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });
  aboutWindow = win;

  // Links in the page open in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The About page is static — block any in-window navigation as a safety net.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => {
    if (!aboutKeepAliveHidden) win.show();
  });
  // Keep-alive: intercept close — hide instead of destroy so the next
  // openAboutWindow() call just shows the cached window (near-instant).
  win.on('close', (e) => {
    if (!appQuitting && !win.isDestroyed()) {
      e.preventDefault();
      aboutKeepAliveHidden = true;
      win.hide();
    }
  });
  win.on('closed', () => {
    if (aboutWindow === win) aboutWindow = null;
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return win;
}

/** Exported for tests / graceful shutdown. Force-destroys the cached window. */
export function closeAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.destroy();
  aboutWindow = null;
}
