/**
 * About-window information model + HTML renderer (PURE module — no Electron
 * imports, so it is unit-testable without a running Electron).
 *
 * The actual wiring (app versions, locale, first-launch date) lives in
 * electron/about.ts; this module only formats what it is given.
 */

export interface AboutInfo {
  /** Application display name, e.g. "PrismGit" */
  name: string;
  /** App version from package.json, e.g. "2.0.0" */
  version: string;
  /** Build timestamp (ISO) baked at build time via vite define __BUILD_DATE__ */
  buildDate: string;
  /** Runtime versions */
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  /** OS / machine info */
  osType: string;
  osRelease: string;
  platform: string;
  arch: string;
  /** App locale, e.g. "en-US" */
  locale: string;
  /** ISO date of the very first app launch (persisted in SimpleStore) */
  firstLaunch: string;
  /** Human-browsable project URL */
  repositoryUrl: string;
  /** License identifier */
  license: string;
}

/** Constant shown in the About window (kept in sync with the app). */
export const ABOUT_REPOSITORY_URL = 'http://178.140.10.58:8082/web/git/gitclient';
export const ABOUT_LICENSE = 'MIT';

/** Short marketing tagline shown under the app name. */
export const ABOUT_TAGLINE =
  'A modern, SmartGit-inspired Git client for desktop — visual history, smart merges and a clean Ayu palette.';

/** Feature chips shown in the About window. */
export const ABOUT_FEATURES = [
  'Changes',
  'History',
  'Journal',
  'Reflog',
  'Bisect',
  'Branches',
  'Tags',
  'Stashes',
  'Remotes',
  'LFS',
  'Submodules',
  'GitFlow',
  'Worktrees',
  'Notes',
  'Blame',
  'Investigate',
  'Deep Links',
];

/** Escape a value for safe interpolation into HTML. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an ISO timestamp as a human-readable local date. */
export function formatBuildDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || 'unknown';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/**
 * Plain-text system summary (used by the "Copy System Info" button).
 */
export function buildSystemSummary(info: AboutInfo): string {
  const lines = [
    `${info.name} ${info.version}`,
    `Build date:   ${formatBuildDate(info.buildDate)}`,
    `Electron:     ${info.electron} (Chromium ${info.chrome}, Node.js ${info.node}, V8 ${info.v8})`,
    `OS:           ${info.osType} ${info.osRelease} (${info.platform}-${info.arch})`,
    `Locale:       ${info.locale}`,
    `First launch: ${formatBuildDate(info.firstLaunch)}`,
    `License:      ${info.license}`,
    `Repository:   ${info.repositoryUrl}`,
  ];
  return lines.join('\n');
}

interface AboutHtmlDeps {
  /** data: URI of the app logo; may be empty — a CSS fallback is used */
  logoSrc: string;
}

/**
 * Render the full self-contained HTML page for the About window.
 * Dark Ayu-inspired styling, no external resources (logo is a data: URI).
 */
export function buildAboutHtml(info: AboutInfo, deps: AboutHtmlDeps): string {
  const featureChips = ABOUT_FEATURES.map((f) => `<span class="chip">${esc(f)}</span>`).join('');

  const rows: Array<[string, string]> = [
    ['Version', esc(info.version)],
    ['Build date', esc(formatBuildDate(info.buildDate))],
    ['Electron', esc(info.electron)],
    //['Chromium', esc(info.chrome)],
    //['Node.js', esc(info.node)],
    //['V8', esc(info.v8)],
    //['OS', esc(`${info.osType} ${info.osRelease}`)],
    //['Platform', esc(`${info.platform} · ${info.arch}`)],
    ['Locale', esc(info.locale)],
    ['First launch', esc(formatBuildDate(info.firstLaunch))],
    ['License', esc(info.license)],
  ];
  const infoRows = rows
    .map(
      ([k, v]) =>
        `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`
    )
    .join('');

  const logo = deps.logoSrc
    ? `<img class="logo" src="${deps.logoSrc}" alt="PrismGit logo" />`
    : `<div class="logo logo-fallback">◆</div>`;

  // Embed the summary payload safely inside the <script> block: escape "<"
  // as \u003C so a value like "</script>" or "<img ...>" can never break out
  // of the script context (standard JSON-in-HTML practice).
  const summaryJson = JSON.stringify(buildSystemSummary(info)).replace(/</g, '\\u003C');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>About PrismGit</title>
<style>
  :root {
    --bg: #1f2430; --bg2: #262b38; --line: #33384a;
    --text: #d5d7de; --muted: #8b90a0; --accent: #ffb454; --link: #73d0ff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; justify-content: center; padding: 24px 24px 18px;
  }
  .wrap { width: 440px; max-width: 100%; }
  header { display: flex; align-items: center; gap: 16px; }
  .logo { width: 84px; height: 84px; border-radius: 18px; flex: none; }
  .logo-fallback {
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, #4ee0ff, #8b7bff, #ff7ac0);
    color: #14172b; font-size: 40px;
  }
  h1 { margin: 0; font-size: 26px; letter-spacing: 0.2px; display: flex; align-items: center; gap: 10px; }
  .version {
    background: linear-gradient(135deg, #4ee0ff33, #8b7bff33, #ff7ac033);
    border: 1px solid #8b7bff55; color: #c9c1ff;
    border-radius: 999px; padding: 1px 10px; font-size: 12px; font-weight: 600;
  }
  .tagline { margin: 10px 0 0; color: var(--muted); font-size: 12.5px; }
  h2 {
    margin: 18px 0 8px; font-size: 11px; letter-spacing: 1.4px;
    text-transform: uppercase; color: var(--accent);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 999px;
    padding: 2px 9px; font-size: 11.5px; color: #aeb3c2;
  }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 4px 0; vertical-align: top; }
  td.k { color: var(--muted); width: 108px; font-size: 12.5px; }
  td.v { font-variant-numeric: tabular-nums; font-size: 13px; word-break: break-all; }
  .links { display: flex; flex-direction: column; gap: 7px; }
  .link {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 12px; color: var(--link); cursor: pointer; font-size: 13px;
    text-align: left; width: 100%;
  }
  .link:hover { border-color: #4a5170; background: #2b3040; }
  .link .url { color: var(--muted); font-size: 11.5px; margin-left: auto; user-select: none; }
  .actions { display: flex; gap: 10px; margin-top: 16px; }
  .btn {
    flex: 1; border-radius: 8px; border: 1px solid var(--line);
    background: var(--bg2); color: var(--text); padding: 9px 0;
    font-size: 13px; cursor: pointer;
  }
  .btn:hover { border-color: #4a5170; background: #2b3040; }
  .btn.primary { background: linear-gradient(135deg, #8b7bff, #6d5fd0); border-color: transparent; color: #fff; }
  .btn.primary:hover { filter: brightness(1.08); }
  footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line);
           color: var(--muted); font-size: 11.5px; text-align: center; }
  .copied { color: #7fd88f; font-size: 12px; margin-top: 8px; height: 16px; opacity: 0; transition: opacity .25s; }
  .copied.show { opacity: 1; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      ${logo}
      <div>
        <h1>${esc(info.name)} <span class="version">v${esc(info.version)}</span></h1>
        <p class="tagline">${esc(ABOUT_TAGLINE)}</p>
      </div>
    </header>

    <h2>Tools</h2>
    <div class="chips">${featureChips}</div>

    <h2>System Information</h2>
    <table>${infoRows}</table>

    <div class="actions">
      <button class="btn" id="close-btn">Close</button>
    </div>

    <footer>${esc(info.name)} — ${esc(info.license)} License · Built with Electron, React &amp; TypeScript</footer>
  </div>
  <script>
    document.getElementById('close-btn').addEventListener('click', function () { window.close(); });
  </script>
</body>
</html>`;
}
